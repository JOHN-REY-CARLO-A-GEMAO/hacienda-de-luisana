import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart' as legacy;
import 'package:url_launcher/url_launcher.dart';

import '../../core/constants/app_constants.dart';
import '../../core/theme/status_style.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../models/guest_crm_model.dart';
import '../../providers/app_providers.dart';
import '../../services/accommodations.dart';
import '../../services/auth_store.dart';
import '../../services/chat_attachment_service.dart';
import '../../services/chat_retention.dart';
import '../../services/live_location_service.dart';
import '../../tutorial/tutorial_controller.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';
import '../bookings/booking_detail_screen.dart';
import '../security/secure_action_sheet.dart';
import 'live_location_panel.dart';
import 'private_chat_image.dart';

/// Canonical display fallback when published rates have not loaded yet, so raw
/// accommodation slugs (`main-house`, `house-a-camping`) never surface in UI.
String _friendlyPropertyLabel(
  String? rawProperty,
  BookingModel? booking,
  List<Accommodation> accommodations,
) {
  if (rawProperty != null && rawProperty.trim().isNotEmpty) {
    final trimmed = rawProperty.trim();
    final mapped = _canonicalAccommodationName(trimmed);
    if (mapped != null) return mapped;
    return trimmed;
  }
  if (booking != null && booking.accommodation.trim().isNotEmpty) {
    final fromPublished = BookingModel.accommodationLabel(
      booking.accommodation,
      accommodations,
    );
    return _canonicalAccommodationName(fromPublished) ?? fromPublished;
  }
  return 'General Inquiry';
}

String? _canonicalAccommodationName(String slugOrName) {
  switch (slugOrName.trim().toLowerCase()) {
    case 'main-house':
      return 'The Main House';
    case 'annex':
      return 'HDL Annex';
    case 'house-a-camping':
    case 'a-house':
      return 'A-House';
    default:
      return null;
  }
}

/// Formats a human-readable booking reference (`HDL-…`) without ever slicing or
/// exposing raw Firestore document IDs or UIDs.
String _friendlyBookingReference(
  String? storedRef,
  BookingModel? booking, {
  required bool isLegacy,
}) {
  final candidate = (booking?.refId ?? storedRef ?? '').trim();
  if (candidate.isNotEmpty && candidate.toUpperCase().startsWith('HDL-')) {
    return candidate.toUpperCase();
  }
  if (booking != null) return 'Pending reference';
  return isLegacy ? 'Earlier inquiry' : 'Pre-stay inquiry';
}

String _initialsOf(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.isEmpty) return 'G';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

String _relativeTimestamp(DateTime? at) {
  if (at == null) return '';
  final local = at.toLocal();
  final now = DateTime.now();
  final diff = now.difference(local);
  if (diff.inSeconds < 45) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (local.year == now.year &&
      local.month == now.month &&
      local.day == now.day) {
    return DateFormat('h:mm a').format(local);
  }
  final yesterday = now.subtract(const Duration(days: 1));
  if (local.year == yesterday.year &&
      local.month == yesterday.month &&
      local.day == yesterday.day) {
    return 'Yesterday';
  }
  if (local.year == now.year) {
    return DateFormat('MMM d').format(local);
  }
  return DateFormat('MMM d, y').format(local);
}

DateTime? _toDateTime(Object? raw) {
  if (raw is Timestamp) return raw.toDate();
  if (raw is DateTime) return raw;
  if (raw is String && raw.isNotEmpty) {
    return DateTime.tryParse(raw);
  }
  return null;
}

class _ResolvedConversation {
  const _ResolvedConversation({
    required this.id,
    required this.guestUid,
    required this.guestName,
    required this.avatarUrl,
    required this.propertyLabel,
    required this.referenceLabel,
    required this.previewText,
    required this.updatedAt,
    required this.unreadAdmin,
    required this.unreadGuest,
    required this.retentionStamp,
    required this.booking,
    required this.isLegacy,
  });

  final String id;
  final String guestUid;
  final String guestName;
  final String? avatarUrl;
  final String propertyLabel;
  final String referenceLabel;
  final String previewText;
  final DateTime? updatedAt;
  final int unreadAdmin;
  final int unreadGuest;
  final Timestamp? retentionStamp;
  final BookingModel? booking;
  final bool isLegacy;

  bool matchesQuery(String rawQuery) {
    final q = rawQuery.trim().toLowerCase();
    if (q.isEmpty) return true;
    return guestName.toLowerCase().contains(q) ||
        referenceLabel.toLowerCase().contains(q) ||
        propertyLabel.toLowerCase().contains(q);
  }
}

BookingModel? _matchBookingForConversation(
  String convoId,
  Map<String, dynamic> data,
  List<BookingModel> bookings,
) {
  final explicitId = data['booking_id']?.toString().trim() ?? '';
  final derivedId = convoId.startsWith('booking-')
      ? convoId.substring('booking-'.length)
      : '';
  final targetBookingId = explicitId.isNotEmpty ? explicitId : derivedId;

  if (targetBookingId.isNotEmpty) {
    for (final b in bookings) {
      if (b.id == targetBookingId) return b;
    }
  }

  final guestUid = data['guest_uid']?.toString().trim() ?? '';
  if (guestUid.isNotEmpty) {
    BookingModel? best;
    for (final b in bookings) {
      if (b.uid == guestUid) {
        if (best == null || b.createdAt.isAfter(best.createdAt)) {
          best = b;
        }
      }
    }
    return best;
  }
  return null;
}

GuestCrmModel? _matchProfile(String guestUid, List<GuestCrmModel> profiles) {
  if (guestUid.isEmpty) return null;
  for (final p in profiles) {
    if (p.id == guestUid) return p;
  }
  return null;
}

_ResolvedConversation _resolveConversation({
  required String convoId,
  required Map<String, dynamic> data,
  required List<BookingModel> bookings,
  required List<GuestCrmModel> profiles,
  required List<Accommodation> accommodations,
}) {
  final guestUid = data['guest_uid']?.toString().trim() ?? '';
  final booking = _matchBookingForConversation(convoId, data, bookings);
  final profile = _matchProfile(guestUid, profiles);
  final isLegacy = convoId.startsWith('inquiry-');

  final storedName = data['guest_name']?.toString().trim() ?? '';
  final bookingName = booking?.guestName.trim() ?? '';
  final profileName = profile?.name.trim() ?? '';
  final guestName = bookingName.isNotEmpty && bookingName != 'Guest'
      ? bookingName
      : storedName.isNotEmpty && storedName != 'Guest'
          ? storedName
          : profileName.isNotEmpty
              ? profileName
              : (bookingName.isNotEmpty ? bookingName : 'Guest');

  final propertyLabel = _friendlyPropertyLabel(
    data['property_name']?.toString(),
    booking,
    accommodations,
  );
  final referenceLabel = _friendlyBookingReference(
    data['booking_reference']?.toString(),
    booking,
    isLegacy: isLegacy,
  );

  final rawPreview = data['last_message']?.toString().trim() ?? '';
  final previewText =
      rawPreview.isNotEmpty ? rawPreview : 'Conversation opened · No messages yet';

  final unreadAdminRaw = data['unread_admin'];
  final unreadGuestRaw = data['unread_guest'];
  final unreadAdmin = unreadAdminRaw is num ? unreadAdminRaw.toInt() : 0;
  final unreadGuest = unreadGuestRaw is num ? unreadGuestRaw.toInt() : 0;

  return _ResolvedConversation(
    id: convoId,
    guestUid: guestUid,
    guestName: guestName,
    avatarUrl: null,
    propertyLabel: propertyLabel,
    referenceLabel: referenceLabel,
    previewText: previewText,
    updatedAt: _toDateTime(data['updated_at']) ?? _toDateTime(data['created_at']),
    unreadAdmin: unreadAdmin > 0 ? unreadAdmin : 0,
    unreadGuest: unreadGuest > 0 ? unreadGuest : 0,
    retentionStamp: data[kRetentionField] is Timestamp
        ? data[kRetentionField] as Timestamp
        : null,
    booking: booking,
    isLegacy: isLegacy,
  );
}

/// Admin Guest Messages Inbox (`conversations/*`).
///
/// Displays one unified conversation per booking (plus non-destructive access
/// to any legacy threads), with Guest avatar/initials, full name, assigned
/// property, human-readable booking reference, 1-line preview, relative local
/// timestamp, accurate `unread_admin` badge, search, and responsive split view.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  /// "kept 89 more days" / "clearing soon" — preserved for Admin retention badges.
  static Widget? retentionLabel(Object? stamp) {
    if (stamp is! Timestamp) return null;
    final days = retentionDaysLeft(stamp.toDate()) ?? 0;
    final text =
        days == 0 ? 'Clearing soon' : 'Kept $days more day${days == 1 ? '' : 's'}';
    return Text(
      text,
      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
    );
  }

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  int _retryEpoch = 0;
  String? _selectedConvoId;

  bool get _cloud {
    try {
      return Firebase.apps.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _refresh() {
    ref.invalidate(bookingsStreamProvider);
    ref.invalidate(guestProfilesStreamProvider);
    setState(() => _retryEpoch += 1);
  }

  void _openConversation(
    BuildContext context,
    _ResolvedConversation item, {
    required bool wideLayout,
  }) {
    TourBus.event('open-thread');
    setState(() => _selectedConvoId = item.id);
    if (wideLayout) return;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ThreadScreen(
          convoId: item.id,
          guestUid: item.guestUid,
          guestName: item.guestName,
          bookingId: item.booking?.id,
          bookingReference: item.booking?.refId ??
              (item.referenceLabel.startsWith('HDL-') ? item.referenceLabel : null),
          propertyName: item.propertyLabel,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bookings = ref.watch(bookingsStreamProvider).when(
          data: (list) => list,
          loading: () => const <BookingModel>[],
          error: (_, __) => const <BookingModel>[],
        );
    final profiles = ref.watch(guestProfilesStreamProvider).when(
          data: (list) => list,
          loading: () => const <GuestCrmModel>[],
          error: (_, __) => const <GuestCrmModel>[],
        );
    final accommodations = ref.watch(accommodationsProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Guest Messages',
              style: GoogleFonts.cinzel(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.6,
                color: Colors.white,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              'Direct booking conversations',
              style: GoogleFonts.inter(
                fontSize: 11,
                color: AppColors.accentGoldLight.withOpacity(0.92),
                fontWeight: FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          Semantics(
            button: true,
            label: 'Refresh guest messages',
            child: IconButton(
              tooltip: 'Refresh guest messages',
              onPressed: _refresh,
              icon: const Icon(Icons.refresh, color: Colors.white),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: !_cloud
          ? const EmptyState(
              icon: Icons.chat_bubble_outline,
              title: 'Demo Mode',
              subtitle:
                  'Connect Firebase to receive and reply to Guest messages in real time.',
            )
          : StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              key: ValueKey('inbox-stream-$_retryEpoch'),
              stream: FirebaseFirestore.instance
                  .collection(AppConstants.colConversations)
                  .orderBy('updated_at', descending: true)
                  .limit(50)
                  .snapshots(),
              builder: (context, snap) {
                if (snap.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.error_outline,
                            size: 42,
                            color: AppColors.statusAlert,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'Could not load guest conversations',
                            style: GoogleFonts.cinzel(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textDark,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Check your connection and try again.',
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              color: AppColors.textMuted,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: _refresh,
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.primaryForest,
                            ),
                            icon: const Icon(Icons.refresh, size: 18),
                            label: const Text('Retry'),
                          ),
                        ],
                      ),
                    ),
                  );
                }

                if (!snap.hasData) {
                  return const Center(
                    child: CircularProgressIndicator(
                      color: AppColors.primaryForest,
                    ),
                  );
                }

                final allItems = snap.data!.docs
                    .map(
                      (doc) => _resolveConversation(
                        convoId: doc.id,
                        data: doc.data(),
                        bookings: bookings,
                        profiles: profiles,
                        accommodations: accommodations,
                      ),
                    )
                    .toList()
                  ..sort((a, b) {
                    final at = a.updatedAt;
                    final bt = b.updatedAt;
                    if (at == null && bt == null) return 0;
                    if (at == null) return 1;
                    if (bt == null) return -1;
                    return bt.compareTo(at);
                  });

                final filtered = allItems
                    .where((item) => item.matchesQuery(_query))
                    .toList();

                return LayoutBuilder(
                  builder: (context, constraints) {
                    final wideLayout = constraints.maxWidth >= 760;
                    _ResolvedConversation? activeItem;
                    if (wideLayout && filtered.isNotEmpty) {
                      for (final item in filtered) {
                        if (item.id == _selectedConvoId) {
                          activeItem = item;
                          break;
                        }
                      }
                      activeItem ??= filtered.first;
                    }

                    final listPane = Column(
                      children: [
                        // Search bar
                        Container(
                          color: Colors.white,
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                          child: Semantics(
                            textField: true,
                            label: 'Search guest messages by guest name or booking reference',
                            child: TextField(
                              controller: _searchController,
                              onChanged: (value) => setState(() => _query = value),
                              style: GoogleFonts.inter(
                                fontSize: 14,
                                color: AppColors.textDark,
                              ),
                              decoration: InputDecoration(
                                hintText: 'Search guest name or booking ref (e.g. HDL-7821)…',
                                hintStyle: GoogleFonts.inter(
                                  fontSize: 13,
                                  color: AppColors.textMuted,
                                ),
                                prefixIcon: const Icon(
                                  Icons.search,
                                  size: 20,
                                  color: AppColors.textMuted,
                                ),
                                suffixIcon: _query.isEmpty
                                    ? null
                                    : IconButton(
                                        tooltip: 'Clear search',
                                        onPressed: () {
                                          _searchController.clear();
                                          setState(() => _query = '');
                                        },
                                        icon: const Icon(Icons.close, size: 18),
                                      ),
                                filled: true,
                                fillColor: AppColors.surfaceLight,
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 10,
                                ),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: const BorderSide(
                                    color: AppColors.cardBorder,
                                  ),
                                ),
                                enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: const BorderSide(
                                    color: AppColors.cardBorder,
                                  ),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: const BorderSide(
                                    color: AppColors.primaryForest,
                                    width: 1.5,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        const Divider(height: 1, color: AppColors.cardBorder),
                        Expanded(
                          child: allItems.isEmpty
                              ? const EmptyState(
                                  icon: Icons.chat_bubble_outline,
                                  title: 'No guest conversations yet',
                                  subtitle:
                                      'When a Guest messages from the website, their booking conversation appears here.',
                                )
                              : filtered.isEmpty
                                  ? EmptyState(
                                      icon: Icons.search_off_outlined,
                                      title: 'No matching conversations',
                                      subtitle:
                                          'No guest name or booking reference matched "${_query.trim()}".',
                                    )
                                  : ListView.separated(
                                      padding: const EdgeInsets.all(14),
                                      itemCount: filtered.length,
                                      separatorBuilder: (_, __) =>
                                          const SizedBox(height: 10),
                                      itemBuilder: (context, index) {
                                        final item = filtered[index];
                                        final isSelected = wideLayout
                                            ? activeItem?.id == item.id
                                            : _selectedConvoId == item.id;
                                        return _ConversationInboxCard(
                                          key: index == 0
                                              ? TourKeys.firstThread
                                              : ValueKey('convo-card-${item.id}'),
                                          item: item,
                                          selected: isSelected,
                                          onTap: () => _openConversation(
                                            context,
                                            item,
                                            wideLayout: wideLayout,
                                          ),
                                        );
                                      },
                                    ),
                        ),
                      ],
                    );

                    if (!wideLayout) return listPane;

                    return Row(
                      children: [
                        SizedBox(
                          width: 360,
                          child: DecoratedBox(
                            decoration: const BoxDecoration(
                              border: Border(
                                right: BorderSide(color: AppColors.cardBorder),
                              ),
                            ),
                            child: listPane,
                          ),
                        ),
                        Expanded(
                          child: activeItem == null
                              ? const EmptyState(
                                  icon: Icons.forum_outlined,
                                  title: 'Select a conversation',
                                  subtitle:
                                      'Choose a guest conversation on the left to read messages and reply.',
                                )
                              : ThreadScreen(
                                  key: ValueKey('embedded-thread-${activeItem.id}'),
                                  convoId: activeItem.id,
                                  guestUid: activeItem.guestUid,
                                  guestName: activeItem.guestName,
                                  bookingId: activeItem.booking?.id,
                                  bookingReference: activeItem.booking?.refId ??
                                      (activeItem.referenceLabel.startsWith('HDL-')
                                          ? activeItem.referenceLabel
                                          : null),
                                  propertyName: activeItem.propertyLabel,
                                  embedded: true,
                                ),
                        ),
                      ],
                    );
                  },
                );
              },
            ),
    );
  }
}

class _ConversationInboxCard extends StatelessWidget {
  const _ConversationInboxCard({
    super.key,
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final _ResolvedConversation item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = item.unreadAdmin > 0;
    final retention = InboxScreen.retentionLabel(item.retentionStamp);
    final timeLabel = _relativeTimestamp(item.updatedAt);
    final semanticSummary =
        '${item.guestName}, ${item.propertyLabel}, ${item.referenceLabel}'
        '${unread ? ', ${item.unreadAdmin} unread' : ''}. '
        'Latest message: ${item.previewText}';

    return Semantics(
      button: true,
      selected: selected,
      label: semanticSummary,
      excludeSemantics: true,
      child: Material(
        color: selected ? const Color(0xFFF1F5F2) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: selected
                    ? AppColors.primaryForest
                    : unread
                        ? AppColors.accentGold
                        : AppColors.cardBorder,
                width: selected || unread ? 1.5 : 1,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.03),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _GuestAvatarBadge(
                  name: item.guestName,
                  avatarUrl: item.avatarUrl,
                  highlighted: unread || selected,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.guestName,
                              style: GoogleFonts.inter(
                                fontSize: 15,
                                fontWeight:
                                    unread ? FontWeight.w700 : FontWeight.w600,
                                color: AppColors.textDark,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (timeLabel.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Text(
                              timeLabel,
                              style: GoogleFonts.inter(
                                fontSize: 11,
                                fontWeight:
                                    unread ? FontWeight.w600 : FontWeight.normal,
                                color: unread
                                    ? AppColors.primaryForest
                                    : AppColors.textMuted,
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${item.propertyLabel} · ${item.referenceLabel}',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: AppColors.primaryForestLight,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.previewText,
                              style: GoogleFonts.inter(
                                fontSize: 13,
                                fontWeight:
                                    unread ? FontWeight.w600 : FontWeight.normal,
                                color: unread
                                    ? AppColors.textDark
                                    : AppColors.textMuted,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (unread) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: AppColors.primaryForest,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                item.unreadAdmin > 99
                                    ? '99+'
                                    : '${item.unreadAdmin}',
                                style: GoogleFonts.inter(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      if (retention != null) ...[
                        const SizedBox(height: 6),
                        retention,
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _GuestAvatarBadge extends StatelessWidget {
  const _GuestAvatarBadge({
    required this.name,
    this.avatarUrl,
    this.size = 44,
    this.highlighted = false,
  });

  final String name;
  final String? avatarUrl;
  final double size;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final initials = _initialsOf(name);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: highlighted ? AppColors.primaryForest : const Color(0xFFE7EFEA),
        border: Border.all(
          color: highlighted
              ? AppColors.accentGold.withOpacity(0.8)
              : AppColors.cardBorder,
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        initials,
        style: GoogleFonts.cinzel(
          fontSize: size * 0.34,
          fontWeight: FontWeight.bold,
          color: highlighted ? Colors.white : AppColors.primaryForest,
        ),
      ),
    );
  }
}

/// Unified Admin Conversation Screen (`ThreadScreen`).
///
/// Supports both standalone pushed route (`embedded == false`) and tablet
/// split-view detail pane (`embedded == true`).
class ThreadScreen extends ConsumerStatefulWidget {
  const ThreadScreen({
    super.key,
    required this.convoId,
    required this.guestUid,
    this.guestName = 'Guest',
    this.bookingId,
    this.bookingReference,
    this.propertyName,
    this.embedded = false,
  });

  final String convoId;
  final String guestUid;
  final String guestName;
  final String? bookingId;
  final String? bookingReference;
  final String? propertyName;
  final bool embedded;

  @override
  ConsumerState<ThreadScreen> createState() => ThreadScreenState();
}

class ThreadScreenState extends ConsumerState<ThreadScreen> {
  final TextEditingController _text = TextEditingController();
  final ChatAttachmentService _attachments = ChatAttachmentService();

  ChatImage? _selectedImage;
  String? _imageMessageId;
  String _sendStage = 'idle';
  String? _composerError;

  bool _showLiveLocationPanel = false;
  bool _liveBannerDismissed = false;
  bool _showBookingDetails = false;
  bool _markingRead = false;

  LiveLocationService? _liveLocation;
  Timer? _countdownTimer;

  /// Cursor pagination state: older pages fetched via "Load earlier messages".
  final List<QueryDocumentSnapshot<Map<String, dynamic>>> _olderDocs = [];
  DocumentSnapshot<Map<String, dynamic>>? _oldest;
  bool _hasMore = false;
  bool _loadingOlder = false;
  int _streamEpoch = 0;

  bool get _sending => _sendStage != 'idle';

  CollectionReference<Map<String, dynamic>> get _messages =>
      FirebaseFirestore.instance
          .collection(AppConstants.colConversations)
          .doc(widget.convoId)
          .collection(AppConstants.subMessages);

  DocumentReference<Map<String, dynamic>> get _convoRef =>
      FirebaseFirestore.instance
          .collection(AppConstants.colConversations)
          .doc(widget.convoId);

  @override
  void initState() {
    super.initState();
    _markAdminRead();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didUpdateWidget(covariant ThreadScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.convoId != widget.convoId) {
      _olderDocs.clear();
      _oldest = null;
      _hasMore = false;
      _loadingOlder = false;
      _selectedImage = null;
      _imageMessageId = null;
      _composerError = null;
      _showLiveLocationPanel = false;
      _liveBannerDismissed = false;
      _markAdminRead();
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _text.dispose();
    super.dispose();
  }

  Future<void> _markAdminRead() async {
    if (_markingRead) return;
    _markingRead = true;
    try {
      await _convoRef.update({
        'unread_admin': 0,
        'admin_last_read_at': FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // Best-effort: never block opening a conversation if offline.
    } finally {
      _markingRead = false;
    }
  }

  Future<void> _toggleLiveLocationPanel({bool skipConfirmIfOpen = false}) async {
    if (_showLiveLocationPanel) {
      setState(() => _showLiveLocationPanel = false);
      return;
    }
    if (!skipConfirmIfOpen) {
      final ok = await showSecureConfirm(
        context,
        title: 'View live location?',
        body:
            'You will view this Guest\'s position only while their sharing session remains active (up to 60 minutes). Nothing is stored in message history, and the Guest can stop sharing at any moment.',
        confirm: 'Open map reader',
      );
      if (!ok || !mounted) return;
    }

    final service = _liveLocation ??= LiveLocationService();
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    final uid = auth.uid;
    if (uid != null && uid.isNotEmpty) {
      await service.registerReader(
        uid: uid,
        allowlisted: AuthStore.isAllowlisted(auth.sessionEmail),
      );
    }
    if (!mounted) return;
    setState(() {
      _showLiveLocationPanel = true;
      _liveBannerDismissed = false;
    });
  }

  Future<void> _callGuest(String? phone, String guestName) async {
    final cleaned = (phone ?? '').replaceAll(RegExp(r'[^\d+]'), '');
    if (cleaned.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('No verified phone number is on file for $guestName.'),
        ),
      );
      return;
    }
    final uri = Uri(scheme: 'tel', path: cleaned);
    final launched = await launchUrl(uri);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open the phone dialer for $cleaned.')),
      );
    }
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || !_hasMore) return;
    setState(() => _loadingOlder = true);
    try {
      Query<Map<String, dynamic>> query = _messages
          .orderBy('created_at', descending: true)
          .limit(AppConstants.olderPageSize + 1);
      final cursor = _oldest;
      if (cursor != null) query = query.startAfterDocument(cursor);
      final snap = await query.get();
      final docs = snap.docs.take(AppConstants.olderPageSize).toList();
      if (!mounted) return;
      setState(() {
        final existingIds = _olderDocs.map((d) => d.id).toSet();
        for (final doc in docs) {
          if (!existingIds.contains(doc.id)) {
            _olderDocs.add(doc);
          }
        }
        if (docs.isNotEmpty) _oldest = docs.last;
        _hasMore = snap.docs.length > AppConstants.olderPageSize;
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not load earlier messages. Check your connection and try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  Future<void> _pickImage() async {
    if (_sending) return;
    try {
      final image = await ChatImagePicker.pick();
      if (image != null && mounted) {
        setState(() {
          _selectedImage = image;
          _imageMessageId = null;
          _composerError = null;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() => _composerError = chatAttachmentFailure(error));
      }
    }
  }

  Future<void> _send([String? overrideText]) async {
    final v = (overrideText ?? _text.text).trim();
    final image = overrideText != null ? null : _selectedImage;
    if ((v.isEmpty && image == null) ||
        v.length > AppConstants.messageMax ||
        _sending) {
      return;
    }

    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    final uid = auth.uid;
    if (uid == null || uid.isEmpty) {
      setState(() => _composerError = 'Sign in as an Admin before sending a message.');
      return;
    }

    setState(() {
      _sendStage = image == null ? 'sending' : 'uploading';
      _composerError = null;
    });

    try {
      if (image != null) {
        final messageId = _imageMessageId ??= _messages.doc().id;
        final attachment = await _attachments.upload(
          conversationId: widget.convoId,
          messageId: messageId,
          image: image,
        );
        if (mounted) setState(() => _sendStage = 'sending');
        final reference = _messages.doc(messageId);
        final existing = await reference.get();
        if (existing.exists) {
          final data = existing.data();
          final prior = data == null ? null : ChatAttachment.fromMessage(data);
          if (data?['sender_uid'] != uid ||
              data?['sender_role'] != 'admin' ||
              data?['text'] != v ||
              prior?.path != attachment.path) {
            throw StateError(
              'This message draft is already in use. Start a new draft.',
            );
          }
        } else {
          await reference.set({
            'sender_uid': uid,
            'sender_role': 'admin',
            'text': v,
            'created_at': FieldValue.serverTimestamp(),
            'attachment': attachment.toMap(),
          });
        }
      } else {
        await _messages.add({
          'sender_uid': uid,
          'sender_role': 'admin',
          'text': v,
          'created_at': FieldValue.serverTimestamp(),
        });
      }

      final preview = v.isEmpty
          ? 'Sent a photo'
          : (v.length > 140 ? v.substring(0, 140) : v);

      await _convoRef.update({
        'last_message': preview,
        'updated_at': FieldValue.serverTimestamp(),
        'unread_guest': FieldValue.increment(1),
        'unread_admin': 0,
      });

      if (overrideText == null) {
        _text.clear();
      }
      if (mounted) {
        setState(() {
          if (overrideText == null) {
            _selectedImage = null;
            _imageMessageId = null;
          }
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _composerError = image == null
              ? 'Message could not be sent. Check your connection and retry.'
              : chatAttachmentFailure(error);
        });
      }
    } finally {
      if (mounted) setState(() => _sendStage = 'idle');
    }
  }

  void _applyQuickReply(String kind) {
    switch (kind) {
      case 'on_the_way':
        _text.text = 'Thank you! Let us know when you are approaching the gate.';
        break;
      case 'arrived_gate':
        _text.text = 'Welcome to Hacienda de LuisAna! Staff is opening the gate now.';
        break;
      case 'send_directions':
        _text.text =
            'Directions to ${AppConstants.appName} (${AppConstants.resortFullAddress}): ${AppConstants.resortDirectionsUrl}';
        break;
    }
    _text.selection = TextSelection.fromPosition(
      TextPosition(offset: _text.text.length),
    );
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final bookings = ref.watch(bookingsStreamProvider).when(
          data: (list) => list,
          loading: () => const <BookingModel>[],
          error: (_, __) => const <BookingModel>[],
        );
    final profiles = ref.watch(guestProfilesStreamProvider).when(
          data: (list) => list,
          loading: () => const <GuestCrmModel>[],
          error: (_, __) => const <GuestCrmModel>[],
        );
    final accommodations = ref.watch(accommodationsProvider);

    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: _convoRef.snapshots(),
      builder: (context, convoSnap) {
        final convoData = convoSnap.data?.data() ??
            <String, dynamic>{
              'guest_uid': widget.guestUid,
              'guest_name': widget.guestName,
              if (widget.bookingId != null) 'booking_id': widget.bookingId,
              if (widget.bookingReference != null)
                'booking_reference': widget.bookingReference,
              if (widget.propertyName != null) 'property_name': widget.propertyName,
            };

        final resolved = _resolveConversation(
          convoId: widget.convoId,
          data: convoData,
          bookings: bookings,
          profiles: profiles,
          accommodations: accommodations,
        );

        if (resolved.unreadAdmin > 0) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _markAdminRead());
        }

        final booking = resolved.booking;
        final guestPhone = booking?.guestPhone.trim() ?? '';
        final lastActiveLabel = resolved.updatedAt != null
            ? 'Last activity ${_relativeTimestamp(resolved.updatedAt)}'
            : 'Private Guest–Admin conversation';

        final content = Column(
          children: [
            if (widget.embedded)
              _EmbeddedThreadHeader(
                resolved: resolved,
                lastActiveLabel: lastActiveLabel,
                hasPhone: guestPhone.isNotEmpty,
                showBookingDetails: _showBookingDetails,
                showLiveLocation: _showLiveLocationPanel,
                onCall: () => _callGuest(guestPhone, resolved.guestName),
                onToggleBookingDetails: () =>
                    setState(() => _showBookingDetails = !_showBookingDetails),
                onToggleLiveLocation: () => _toggleLiveLocationPanel(),
              ),

            // Live location active consent banner (real session status, no fake ETA)
            StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance
                  .collection(AppConstants.colLocationSessions)
                  .doc(widget.convoId)
                  .snapshots(),
              builder: (context, sessionSnap) {
                final doc = sessionSnap.data;
                final session =
                    (doc != null && doc.exists) ? LiveLocationSession.fromDoc(doc) : null;
                final isLive = session != null && session.isLive;
                if (!isLive) return const SizedBox.shrink();

                if (_liveBannerDismissed && !_showLiveLocationPanel) {
                  return Container(
                    width: double.infinity,
                    color: const Color(0xFFECFDF5),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: ActionChip(
                        avatar: const Icon(
                          Icons.location_on,
                          size: 15,
                          color: AppColors.statusSuccess,
                        ),
                        label: Text(
                          'Live Location Active · ${session.countdown}',
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.primaryDark,
                          ),
                        ),
                        backgroundColor: Colors.white,
                        side: BorderSide(
                          color: AppColors.statusSuccess.withOpacity(0.45),
                        ),
                        onPressed: () => setState(() => _liveBannerDismissed = false),
                      ),
                    ),
                  );
                }

                return Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFECFDF5),
                    border: Border(
                      bottom: BorderSide(
                        color: AppColors.statusSuccess.withOpacity(0.3),
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Text('📍', style: TextStyle(fontSize: 14)),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Live Location Active · ${session.countdown} remaining',
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.primaryDark,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      TextButton(
                        onPressed: () =>
                            _toggleLiveLocationPanel(skipConfirmIfOpen: true),
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          foregroundColor: AppColors.primaryForest,
                        ),
                        child: Text(
                          _showLiveLocationPanel ? 'Hide Map' : 'Open Map',
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Minimize live location bar',
                        visualDensity: VisualDensity.compact,
                        onPressed: () => setState(() {
                          _liveBannerDismissed = true;
                          _showLiveLocationPanel = false;
                        }),
                        icon: const Icon(
                          Icons.close,
                          size: 16,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),

            // Real OpenStreetMap live-location reader panel
            if (_showLiveLocationPanel)
              LiveLocationPanel(
                conversationId: widget.convoId,
                guestUid: widget.guestUid.isEmpty ? null : widget.guestUid,
                service: _liveLocation,
                onClose: () => setState(() => _showLiveLocationPanel = false),
              ),

            // Toggleable Booking Details collapsible card
            if (_showBookingDetails)
              _BookingContextCard(
                resolved: resolved,
                onClose: () => setState(() => _showBookingDetails = false),
              ),

            // Message timeline
            Expanded(
              child: _buildMessagesTimeline(resolved),
            ),

            // Quick replies + Multiline Composer
            _buildComposerSection(),
          ],
        );

        if (widget.embedded) {
          return ColoredBox(color: AppColors.surfaceLight, child: content);
        }

        return Scaffold(
          backgroundColor: AppColors.surfaceLight,
          appBar: AppBar(
            titleSpacing: 4,
            title: Row(
              children: [
                _GuestAvatarBadge(
                  name: resolved.guestName,
                  size: 36,
                  highlighted: true,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        resolved.guestName,
                        style: GoogleFonts.inter(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        '${resolved.propertyLabel} · ${resolved.referenceLabel}',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          color: AppColors.accentGoldLight.withOpacity(0.92),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                tooltip: guestPhone.isNotEmpty
                    ? 'Call ${resolved.guestName}'
                    : 'No verified phone on file',
                onPressed: () => _callGuest(guestPhone, resolved.guestName),
                icon: Icon(
                  Icons.phone_outlined,
                  color: guestPhone.isNotEmpty ? Colors.white : Colors.white54,
                ),
              ),
              IconButton(
                tooltip: _showLiveLocationPanel
                    ? 'Close live location map'
                    : 'Open live location map',
                onPressed: () => _toggleLiveLocationPanel(),
                icon: Icon(
                  _showLiveLocationPanel
                      ? Icons.location_off_outlined
                      : Icons.location_on_outlined,
                  color: Colors.white,
                ),
              ),
              IconButton(
                tooltip: _showBookingDetails
                    ? 'Hide booking details'
                    : 'Show booking details',
                onPressed: () =>
                    setState(() => _showBookingDetails = !_showBookingDetails),
                icon: Icon(
                  _showBookingDetails ? Icons.info : Icons.info_outline,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          body: content,
        );
      },
    );
  }

  Widget _buildMessagesTimeline(_ResolvedConversation resolved) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      key: ValueKey('thread-messages-${widget.convoId}-$_streamEpoch'),
      stream: _messages
          .orderBy('created_at', descending: true)
          .limit(AppConstants.threadPageSize + 1)
          .snapshots(),
      builder: (context, snap) {
        if (snap.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 36,
                    color: AppColors.statusAlert,
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Could not load message history.',
                    style: GoogleFonts.inter(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textDark,
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => setState(() => _streamEpoch += 1),
                    icon: const Icon(Icons.refresh, size: 16),
                    label: const Text('Retry'),
                  ),
                ],
              ),
            ),
          );
        }

        if (!snap.hasData) {
          return const Center(
            child: CircularProgressIndicator(color: AppColors.primaryForest),
          );
        }

        final rawDocs = snap.data!.docs;
        final livePage = rawDocs.take(AppConstants.threadPageSize).toList();
        if (_oldest == null && livePage.isNotEmpty) {
          _oldest = livePage.last;
          _hasMore = rawDocs.length > AppConstants.threadPageSize;
        }

        // Combine newest page + older paginated pages without duplicates (descending).
        final seenIds = <String>{};
        final combinedDesc = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
        for (final doc in livePage) {
          if (seenIds.add(doc.id)) combinedDesc.add(doc);
        }
        for (final doc in _olderDocs) {
          if (seenIds.add(doc.id)) combinedDesc.add(doc);
        }

        if (combinedDesc.isEmpty) {
          return EmptyState(
            icon: Icons.chat_outlined,
            title: 'No messages yet',
            subtitle:
                'Send directions, check-in details, or a welcome note to ${resolved.guestName}.',
          );
        }

        final extraLoader = _hasMore ? 1 : 0;

        return ListView.builder(
          reverse: true,
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
          itemCount: combinedDesc.length + extraLoader,
          itemBuilder: (context, index) {
            if (index >= combinedDesc.length) {
              return _buildLoadOlderButton();
            }

            final doc = combinedDesc[index];
            final m = doc.data();
            final isAdminSender = m['sender_role'] == 'admin';
            final text = m['text']?.toString() ?? '';
            final attachment = ChatAttachment.fromMessage(m);
            final createdAt = _toDateTime(m['created_at']);
            final pendingWrite = doc.metadata.hasPendingWrites;

            // Date separator above the first message of each calendar day.
            DateTime? olderNeighborDate;
            if (index + 1 < combinedDesc.length) {
              olderNeighborDate =
                  _toDateTime(combinedDesc[index + 1].data()['created_at']);
            }
            final showDateHeader = createdAt != null &&
                (olderNeighborDate == null ||
                    createdAt.toLocal().year != olderNeighborDate.toLocal().year ||
                    createdAt.toLocal().month != olderNeighborDate.toLocal().month ||
                    createdAt.toLocal().day != olderNeighborDate.toLocal().day);

            // Honest delivery status on the newest outgoing Admin message.
            String? deliveryLabel;
            if (isAdminSender && index == 0) {
              if (pendingWrite) {
                deliveryLabel = 'Sending…';
              } else if (resolved.unreadGuest == 0) {
                deliveryLabel = 'Seen';
              } else {
                deliveryLabel = 'Sent';
              }
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (showDateHeader) _DateDivider(date: createdAt),
                Align(
                  alignment: isAdminSender
                      ? Alignment.centerRight
                      : Alignment.centerLeft,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: EdgeInsets.all(attachment == null ? 12 : 6),
                      decoration: BoxDecoration(
                        color: isAdminSender
                            ? AppColors.primaryForest
                            : Colors.white,
                        borderRadius: BorderRadius.only(
                          topLeft: const Radius.circular(16),
                          topRight: const Radius.circular(16),
                          bottomLeft: Radius.circular(isAdminSender ? 16 : 4),
                          bottomRight: Radius.circular(isAdminSender ? 4 : 16),
                        ),
                        border: isAdminSender
                            ? null
                            : Border.all(color: AppColors.cardBorder),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.03),
                            blurRadius: 4,
                            offset: const Offset(0, 1),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (attachment != null)
                            PrivateChatImage(
                              key: ValueKey(attachment.path),
                              attachment: attachment,
                              caption: text.isEmpty ? null : text,
                              service: _attachments,
                            ),
                          if (text.isNotEmpty)
                            Padding(
                              padding: EdgeInsets.fromLTRB(
                                attachment == null ? 0 : 8,
                                attachment == null ? 0 : 8,
                                attachment == null ? 0 : 8,
                                attachment == null ? 0 : 4,
                              ),
                              child: SelectableText(
                                text,
                                style: GoogleFonts.inter(
                                  fontSize: 14,
                                  height: 1.45,
                                  color: isAdminSender
                                      ? Colors.white
                                      : AppColors.textDark,
                                ),
                              ),
                            ),
                          Padding(
                            padding: EdgeInsets.fromLTRB(
                              attachment == null ? 0 : 8,
                              4,
                              attachment == null ? 0 : 8,
                              0,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  createdAt != null
                                      ? DateFormat('h:mm a')
                                          .format(createdAt.toLocal())
                                      : 'Sending…',
                                  style: GoogleFonts.inter(
                                    fontSize: 10.5,
                                    color: isAdminSender
                                        ? Colors.white.withOpacity(0.75)
                                        : AppColors.textMuted,
                                  ),
                                ),
                                if (deliveryLabel != null) ...[
                                  const SizedBox(width: 6),
                                  Text(
                                    '· $deliveryLabel',
                                    style: GoogleFonts.inter(
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w600,
                                      color: isAdminSender
                                          ? AppColors.accentGoldLight
                                          : AppColors.textMuted,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget _buildLoadOlderButton() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12, top: 4),
      child: Center(
        child: OutlinedButton.icon(
          onPressed: _loadingOlder ? null : _loadOlder,
          icon: _loadingOlder
              ? const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.expand_less, size: 16),
          label: Text(_loadingOlder ? 'Loading…' : 'Load earlier messages'),
        ),
      ),
    );
  }

  Widget _buildComposerSection() {
    final selectedImage = _selectedImage;
    final currentLength = _text.text.length;
    final canSend = !_sending &&
        ((_text.text.trim().isNotEmpty || selectedImage != null) &&
            currentLength <= AppConstants.messageMax);

    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.cardBorder)),
        ),
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Quick replies (verified directions + gate coordination)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _QuickReplyChip(
                    label: 'Send Directions',
                    icon: Icons.directions_outlined,
                    onTap: _sending
                        ? null
                        : () => _applyQuickReply('send_directions'),
                  ),
                  const SizedBox(width: 8),
                  _QuickReplyChip(
                    label: 'Arrived at gate',
                    icon: Icons.door_sliding_outlined,
                    onTap: _sending
                        ? null
                        : () => _applyQuickReply('arrived_gate'),
                  ),
                  const SizedBox(width: 8),
                  _QuickReplyChip(
                    label: 'On the way',
                    icon: Icons.schedule_outlined,
                    onTap:
                        _sending ? null : () => _applyQuickReply('on_the_way'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),

            // Error banner + retry
            if (_composerError != null)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.alertDangerSurface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.alertDangerBorder),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.error_outline,
                      size: 16,
                      color: AppColors.alertDangerText,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _composerError!,
                        style: GoogleFonts.inter(
                          color: AppColors.alertDangerText,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _sending ? null : () => _send(),
                      icon: const Icon(Icons.refresh, size: 15),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),

            // Attached private image preview
            if (selectedImage != null)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.cardBorder),
                ),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.memory(
                        selectedImage.bytes,
                        width: 52,
                        height: 52,
                        fit: BoxFit.cover,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            selectedImage.name,
                            style: GoogleFonts.inter(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textDark,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _sendStage == 'uploading'
                                ? 'Uploading privately…'
                                : _sendStage == 'sending'
                                    ? 'Sending message…'
                                    : '${(selectedImage.bytes.length / 1024).ceil()} KB · ready to send',
                            style: GoogleFonts.inter(
                              fontSize: 11,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Replace attached image',
                      onPressed: _sending ? null : _pickImage,
                      icon: const Icon(Icons.swap_horiz, size: 20),
                    ),
                    IconButton(
                      tooltip: 'Remove attached image',
                      onPressed: _sending
                          ? null
                          : () => setState(() {
                                _selectedImage = null;
                                _imageMessageId = null;
                                _composerError = null;
                              }),
                      icon: const Icon(Icons.close, size: 20),
                    ),
                  ],
                ),
              ),

            // Multiline input + attach + send
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  tooltip: selectedImage == null
                      ? 'Attach JPEG, PNG, or WebP (5 MB max)'
                      : 'Replace image (JPEG, PNG, or WebP, 5 MB max)',
                  onPressed: _sending ? null : _pickImage,
                  icon: const Icon(
                    Icons.attach_file,
                    color: AppColors.primaryForest,
                  ),
                ),
                Expanded(
                  child: TextField(
                    key: TourKeys.threadComposer,
                    controller: _text,
                    enabled: !_sending,
                    minLines: 1,
                    maxLines: 4,
                    maxLength: AppConstants.messageMax,
                    textInputAction: TextInputAction.newline,
                    onChanged: (_) => setState(() {}),
                    style: GoogleFonts.inter(
                      fontSize: 14,
                      color: AppColors.textDark,
                    ),
                    decoration: InputDecoration(
                      hintText: selectedImage == null
                          ? 'Write a message to Guest…'
                          : 'Add an optional caption…',
                      hintStyle: GoogleFonts.inter(
                        fontSize: 13.5,
                        color: AppColors.textMuted,
                      ),
                      counterText:
                          '${_text.text.length}/${AppConstants.messageMax}',
                      counterStyle: GoogleFonts.inter(
                        fontSize: 10.5,
                        color: AppColors.textMuted,
                      ),
                      filled: true,
                      fillColor: AppColors.surfaceLight,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide:
                            const BorderSide(color: AppColors.cardBorder),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide:
                            const BorderSide(color: AppColors.cardBorder),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(
                          color: AppColors.primaryForest,
                          width: 1.5,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Semantics(
                  button: true,
                  label: _sendStage == 'uploading'
                      ? 'Uploading image'
                      : 'Send message',
                  child: IconButton.filled(
                    tooltip: _sendStage == 'uploading'
                        ? 'Uploading image…'
                        : 'Send message',
                    onPressed: canSend ? () => _send() : null,
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.primaryForest,
                      disabledBackgroundColor: AppColors.cardBorder,
                      minimumSize: const Size(44, 44),
                    ),
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.send_rounded, color: Colors.white),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EmbeddedThreadHeader extends StatelessWidget {
  const _EmbeddedThreadHeader({
    required this.resolved,
    required this.lastActiveLabel,
    required this.hasPhone,
    required this.showBookingDetails,
    required this.showLiveLocation,
    required this.onCall,
    required this.onToggleBookingDetails,
    required this.onToggleLiveLocation,
  });

  final _ResolvedConversation resolved;
  final String lastActiveLabel;
  final bool hasPhone;
  final bool showBookingDetails;
  final bool showLiveLocation;
  final VoidCallback onCall;
  final VoidCallback onToggleBookingDetails;
  final VoidCallback onToggleLiveLocation;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Row(
        children: [
          _GuestAvatarBadge(
            name: resolved.guestName,
            size: 40,
            highlighted: true,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  resolved.guestName,
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textDark,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  '${resolved.propertyLabel} · ${resolved.referenceLabel} · $lastActiveLabel',
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    color: AppColors.textMuted,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: hasPhone
                ? 'Call ${resolved.guestName}'
                : 'No verified phone on file',
            onPressed: onCall,
            icon: Icon(
              Icons.phone_outlined,
              color: hasPhone ? AppColors.primaryForest : AppColors.textMuted,
            ),
          ),
          IconButton(
            tooltip: showLiveLocation
                ? 'Close live location map'
                : 'Open live location map',
            onPressed: onToggleLiveLocation,
            icon: Icon(
              showLiveLocation
                  ? Icons.location_off_outlined
                  : Icons.location_on_outlined,
              color: AppColors.primaryForest,
            ),
          ),
          IconButton(
            tooltip:
                showBookingDetails ? 'Hide booking details' : 'Booking details',
            onPressed: onToggleBookingDetails,
            icon: Icon(
              showBookingDetails ? Icons.info : Icons.info_outline,
              color: AppColors.primaryForest,
            ),
          ),
        ],
      ),
    );
  }
}

class _BookingContextCard extends StatelessWidget {
  const _BookingContextCard({
    required this.resolved,
    required this.onClose,
  });

  final _ResolvedConversation resolved;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final booking = resolved.booking;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
      child: HaciendaCard(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.home_work_outlined,
                  size: 18,
                  color: AppColors.primaryForest,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Booking Details · ${resolved.referenceLabel}',
                    style: GoogleFonts.cinzel(
                      fontSize: 13.5,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textDark,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (booking != null)
                  StatusPill(
                    label: booking.rawStatus,
                    color: StatusStyle.color(booking.rawStatus),
                  ),
                IconButton(
                  tooltip: 'Close booking details',
                  visualDensity: VisualDensity.compact,
                  onPressed: onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (booking == null)
              Text(
                'No linked reservation record was found for this conversation yet.',
                style: GoogleFonts.inter(
                  fontSize: 12.5,
                  color: AppColors.textMuted,
                ),
              )
            else ...[
              Wrap(
                spacing: 16,
                runSpacing: 8,
                children: [
                  _BookingFactChip(
                    label: 'Accommodation',
                    value: resolved.propertyLabel,
                  ),
                  _BookingFactChip(
                    label: 'Stay Dates',
                    value:
                        '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)} (${booking.totalNights}N)',
                  ),
                  _BookingFactChip(
                    label: 'Guests',
                    value: '${booking.guestCount} guest${booking.guestCount == 1 ? '' : 's'}',
                  ),
                  if (booking.guestPhone.trim().isNotEmpty)
                    _BookingFactChip(
                      label: 'Verified Phone',
                      value: booking.guestPhone.trim(),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            BookingDetailScreen(bookingId: booking.id),
                      ),
                    );
                  },
                  icon: const Icon(Icons.open_in_new, size: 15),
                  label: const Text('Open Full Booking Record'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BookingFactChip extends StatelessWidget {
  const _BookingFactChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 10.5,
            fontWeight: FontWeight.w600,
            color: AppColors.textMuted,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: GoogleFonts.inter(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: AppColors.textDark,
          ),
        ),
      ],
    );
  }
}

class _DateDivider extends StatelessWidget {
  const _DateDivider({required this.date});

  final DateTime date;

  @override
  Widget build(BuildContext context) {
    final local = date.toLocal();
    final now = DateTime.now();
    String label;
    if (local.year == now.year &&
        local.month == now.month &&
        local.day == now.day) {
      label = 'Today';
    } else if (local.year == now.year) {
      label = DateFormat('EEEE, MMM d').format(local);
    } else {
      label = DateFormat('MMM d, y').format(local);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          const Expanded(child: Divider(color: AppColors.cardBorder)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
              ),
            ),
          ),
          const Expanded(child: Divider(color: AppColors.cardBorder)),
        ],
      ),
    );
  }
}

class _QuickReplyChip extends StatelessWidget {
  const _QuickReplyChip({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      avatar: Icon(icon, size: 15, color: AppColors.primaryForest),
      label: Text(
        label,
        style: GoogleFonts.inter(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppColors.primaryForest,
        ),
      ),
      backgroundColor: AppColors.surfaceLight,
      side: const BorderSide(color: AppColors.cardBorder),
      onPressed: onTap,
    );
  }
}
