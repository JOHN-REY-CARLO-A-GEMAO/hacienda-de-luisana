import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../services/auth_store.dart';
import '../security/secure_action_sheet.dart';
import '../../tutorial/tutorial_controller.dart';
import '../../widgets/empty_state.dart';

/// Guest → Admin messages from `conversations/*`.
///
/// Redesigned inbox: one continuous conversation per guest booking.
/// Each card shows the guest's name, assigned property and booking reference,
/// the latest message preview, and an unread indicator. Raw database
/// identifiers are never shown.
///
/// The same `conversations/*` collection and `conversations/{id}/messages/*`
/// subcollection the website uses — both apps share one Firestore project.
class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key});

  bool get _cloud {
    try {
      return Firebase.apps.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: _InboxAppBar(),
      body: !_cloud
          ? const EmptyState(
              icon: Icons.chat_bubble_outline,
              title: 'No Firebase on this device',
              subtitle: 'Connect the Admin app to the same Firebase project as the website to see Guest threads.',
            )
          : StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance
                  .collection(AppConstants.colConversations)
                  .orderBy('updated_at', descending: true)
                  .limit(50)
                  .snapshots(),
              builder: (context, snap) {
                if (snap.hasError) {
                  return EmptyState(
                    icon: Icons.error_outline,
                    title: 'Could not load messages',
                    subtitle: '${snap.error}',
                  );
                }
                if (!snap.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final docs = snap.data!.docs;
                if (docs.isEmpty) {
                  return const EmptyState(
                    icon: Icons.chat_bubble_outline,
                    title: 'No open conversations',
                    subtitle:
                        'When a Guest messages from the website, the thread appears here.',
                  );
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemCount: docs.length,
                  itemBuilder: (context, i) {
                    final d = docs[i].data();
                    return ConversationCard(
                      key: ValueKey(docs[i].id),
                      conversationId: docs[i].id,
                      data: d,
                    );
                  },
                );
              },
            ),
    );
  }
}

/// The header: separate logo region and title region, so the brand mark can
/// never collide with the title at any viewport width.
class _InboxAppBar extends StatelessWidget implements PreferredSizeWidget {
  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleSpacing: 0,
      title: Row(
        children: [
          // Logo region — fixed size, never overlaps the title.
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primaryForest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Center(
              child: Text(
                'HDL',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                  letterSpacing: 1,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          // Title region — flexible, ellipses if needed.
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Guest Messages',
                  style: GoogleFonts.cinzel(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textDark,
                  ),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
                const SizedBox(height: 2),
                Text(
                  'One conversation per booking',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: AppColors.textMuted,
                  ),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Refresh',
          onPressed: () {},
          icon: const Icon(Icons.refresh, size: 20),
        ),
      ],
    );
  }
}

/// One conversation card: guest avatar, name, property + booking reference,
/// latest message preview, relative timestamp, unread indicator.
///
/// No raw database identifiers appear anywhere in the card.
class ConversationCard extends StatelessWidget {
  final String conversationId;
  final Map<String, dynamic> data;

  const ConversationCard({
    super.key,
    required this.conversationId,
    required this.data,
  });

  String _guestName(Map<String, dynamic> d) {
    final name = d['guest_name'];
    if (name is String && name.isNotEmpty) return name;
    return 'Guest';
  }

  String _subtitle(Map<String, dynamic> d) {
    final property = d['property_name'];
    final ref = d['booking_reference'];
    if (property != null && property is String && property.isNotEmpty) {
      if (ref != null && ref is String && ref.isNotEmpty) {
        return '$property · Ref #$ref';
      }
      return property;
    }
    if (ref != null && ref is String && ref.isNotEmpty) {
      return 'Ref #$ref';
    }
    return 'Booking details unavailable';
  }

  String _preview(Map<String, dynamic> d) {
    final preview = d['last_message'];
    if (preview is String && preview.isNotEmpty) return preview;
    return 'No messages yet — start the conversation.';
  }

  int _unreadCount(Map<String, dynamic> d) {
    final v = d['unread_guest'];
    if (v is int) return v;
    if (v is num) return v.toInt();
    return 0;
  }

  String _relativeTime(Object? stamp) {
    if (stamp is! Timestamp) return '';
    final date = stamp.toDate();
    final now = DateTime.now();
    final diff = now.difference(date).inMinutes;
    if (diff < 1) return 'just now';
    if (diff < 60) return '${diff}m ago';
    final hours = diff ~/ 60;
    if (hours < 24) return '${hours}h ago';
    final days = diff ~/ (60 * 24);
    if (days == 1) return 'Yesterday';
    return '${days}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final guestName = _guestName(data);
    final hasUnread = _unreadCount(data) > 0;
    final initials = guestName
        .split(' ')
        .where((p) => p.isNotEmpty)
        .map((p) => p[0].toUpperCase())
        .take(2)
        .join();

    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        TourBus.event('open-thread');
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => ThreadScreen(
              convoId: conversationId,
              guestUid: data['guest_uid']?.toString() ?? '',
              guestName: guestName,
              bookingReference: data['booking_reference']?.toString(),
              propertyName: data['property_name']?.toString(),
            ),
          ),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Guest avatar
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryForestLight,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Center(
                  child: Text(
                    initials.isNotEmpty ? initials : 'G',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primaryForest,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Main content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      guestName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: AppColors.textDark,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _subtitle(data),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textMuted,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _preview(data),
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.textMuted,
                        height: 1.2,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ],
                ),
              ),
              // Right metadata
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _relativeTime(data['updated_at']),
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
                  ),
                  if (hasUnread) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.primaryForest.withOpacity(0.10),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: AppColors.primaryForest.withOpacity(0.30),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const SizedBox(
                            width: 6,
                            height: 6,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                color: AppColors.primaryForest,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '${_unreadCount(data)}',
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: AppColors.primaryForest,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// ---------------------------------------------------------------------------
/// The single chat screen: one continuous conversation per guest booking.
//
// Context header (guest name/status, property + booking ref, call action,
// booking-details toggle), message timeline with delivery states, compact
// live-location chip, quick-reply chips, and the message composer.
//
// Human-readable identity only — the guest's name, booking reference, and
// property name appear everywhere a raw database identifier once did.
// ---------------------------------------------------------------------------
class ThreadScreen extends StatefulWidget {
  final String convoId;
  final String guestUid;
  final String guestName;
  final String? bookingReference;
  final String? propertyName;

  const ThreadScreen({
    super.key,
    required this.convoId,
    required this.guestUid,
    required this.guestName,
    this.bookingReference,
    this.propertyName,
  });

  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  final _text = TextEditingController();
  bool _sending = false;
  String? _composerError;
  bool _showBookingDetails = false;
  bool _showLiveLocation = false;

  CollectionReference<Map<String, dynamic>> get _messages =>
      FirebaseFirestore.instance
          .collection(AppConstants.colConversations)
          .doc(widget.convoId)
          .collection(AppConstants.subMessages);

  Future<void> _toggleBookingDetails() =>
      setState(() => _showBookingDetails = !_showBookingDetails);

  Future<void> _toggleLiveLocation() async {
    if (_showLiveLocation) {
      setState(() => _showLiveLocation = false);
      return;
    }
    final ok = await showSecureConfirm(
      context,
      title: 'Read their live location?',
      body:
          'You will see this Guest\'s position for as long as they keep sharing it — up to the 60 minutes they chose. Nothing is written to Firestore, and they can stop at any moment.',
      confirm: 'Open the reader',
    );
    if (!ok || !mounted) return;
    setState(() => _showLiveLocation = true);
  }

  Future<void> _send() async {
    final v = _text.text.trim();
    if (v.isEmpty || v.length > AppConstants.messageMax || _sending) return;
    final auth = context.read<AuthStore>();
    final uid = auth.uid;
    if (uid == null || uid.isEmpty) return;
    setState(() {
      _sending = true;
      _composerError = null;
    });
    try {
      await _messages.add({
        'sender_uid': uid,
        'sender_role': 'admin',
        'text': v,
        'created_at': FieldValue.serverTimestamp(),
      });
      await FirebaseFirestore.instance
          .collection(AppConstants.colConversations)
          .doc(widget.convoId)
          .update({
        'updated_at': FieldValue.serverTimestamp(),
        'last_message':
            v.length > 140 ? '${v.substring(0, 140)}…' : v,
        'unread_guest': 1,
      });
      _text.clear();
    } catch (error) {
      if (mounted) {
        setState(() => _composerError =
            'Message could not be sent. Check the connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _deliveryState(Map<String, dynamic> m) {
    final seenBy = m['seen_by'];
    if (seenBy is List && seenBy.isNotEmpty) return 'seen';
    final deliveredAt = m['delivered_at'];
    if (deliveredAt != null) return 'delivered';
    return 'sent';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _ThreadAppBar(),
      body: Column(
        children: [
          if (_showBookingDetails)
            BookingDetailsPanel(
              bookingReference: widget.bookingReference ?? '',
              propertyName: widget.propertyName ?? '',
              guestName: widget.guestName,
              onClose: _toggleBookingDetails,
            ),
          if (_showLiveLocation)
            const LiveLocationReaderPanel(),
          Expanded(
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: _messages
                  .orderBy('created_at', descending: true)
                  .limit(AppConstants.threadPageSize + 1)
                  .snapshots(),
              builder: (context, snap) {
                final docs = snap.data?.docs ?? [];
                if (docs.isEmpty) {
                  return const EmptyState(
                    title: 'No messages yet',
                    subtitle: 'Say hello below.',
                  );
                }
                final page = docs.take(AppConstants.threadPageSize).toList();
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  itemCount: page.length,
                  itemBuilder: (context, i) {
                    final m = page[i].data();
                    final admin = m['sender_role'] == 'admin';
                    final text = m['text']?.toString() ?? '';
                    final state = _deliveryState(m);
                    return Align(
                      alignment:
                          admin ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color:
                              admin ? AppColors.primaryForest : Colors.white,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              text,
                              style: TextStyle(
                                color: admin ? Colors.white : AppColors.textDark,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              state.toUpperCase(),
                              style: const TextStyle(
                                fontSize: 9,
                                color: AppColors.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                if (_composerError != null)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(10),
                    color: AppColors.alertDangerSurface,
                    child: Text(
                      _composerError!,
                      style: const TextStyle(color: AppColors.alertDangerText),
                    ),
                  ),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _text,
                        enabled: !_sending,
                        maxLength: AppConstants.messageMax,
                        minLines: 1,
                        maxLines: 5,
                        decoration: const InputDecoration(
                          hintText: 'Write a message…',
                          border: OutlineInputBorder(),
                          counterText: '',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      onPressed: _sending ? null : _send,
                      icon: const Icon(Icons.send),
                      tooltip: 'Send',
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Text(
                      '${_text.text.length}/${AppConstants.messageMax}',
                      style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                    ),
                    const Spacer(),
                    QuickReplyChip(
                      label: 'On the way',
                      onTap: () =>
                          setState(() => _text.text = 'On the way'),
                    ),
                    QuickReplyChip(
                      label: 'Arrived at gate',
                      onTap: () =>
                          setState(() => _text.text = 'Arrived at gate'),
                    ),
                    QuickReplyChip(
                      label: 'Send Directions',
                      onTap: () =>
                          setState(() => _text.text = 'Send Directions'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Context header: guest identity, property + booking ref, call action,
/// booking-details toggle, live-location toggle. No raw identifiers.
class _ThreadAppBar extends StatelessWidget implements PreferredSizeWidget {
  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight + 24);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleSpacing: 0,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Guest Messages',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.primaryForest.withOpacity(0.10),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text(
                  'Active',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primaryForest,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'Booking details',
          icon: const Icon(Icons.info_outline, size: 20),
          onPressed: () {},
        ),
        IconButton(
          tooltip: 'Call guest',
          icon: const Icon(Icons.call, size: 20),
          onPressed: () {},
        ),
      ],
    );
  }
}

/// Compact live-location reader panel (placeholder — the full reader lives in
/// `live_location_panel.dart`; this is the toggle target).
class LiveLocationReaderPanel extends StatelessWidget {
  const LiveLocationReaderPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      color: AppColors.accentGoldLight,
      child: Row(
        children: [
          const Icon(Icons.location_on, color: AppColors.accentGoldDark, size: 18),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'Live location shared',
              style: TextStyle(fontSize: 12, color: AppColors.accentGoldDark),
            ),
          ),
          TextButton(
            onPressed: () {},
            child: const Text('Stop sharing'),
          ),
        ],
      ),
    );
  }
}

/// Booking details panel (expands below the header).
class BookingDetailsPanel extends StatelessWidget {
  final String bookingReference;
  final String propertyName;
  final String guestName;
  final VoidCallback onClose;

  const BookingDetailsPanel({
    super.key,
    required this.bookingReference,
    required this.propertyName,
    required this.guestName,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      color: AppColors.surfaceLight,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'Booking Details',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textDark,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close, size: 20),
                onPressed: onClose,
              ),
            ],
          ),
          const SizedBox(height: 10),
          _DetailRow(label: 'Guest', value: guestName),
          _DetailRow(label: 'Booking Reference', value: bookingReference),
          _DetailRow(label: 'Property', value: propertyName),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textMuted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? 'Booking details unavailable' : value,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textDark,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Quick-reply chip that pre-fills the composer.
class QuickReplyChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const QuickReplyChip({super.key, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      label: Text(label, style: const TextStyle(fontSize: 11)),
      onPressed: onTap,
    );
  }
}
