import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../tutorial/tutorial_controller.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';
import 'booking_detail_screen.dart';

class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  int _selectedFilterIndex = 0;
  String _query = '';
  String _sort = 'date';
  int _page = 0;
  static const int _pageSize = 10;

  final List<String> _filters = [
    'All',
    'Needs action',
    'Pending',
    'Reserved',
    'Active Stay',
    'Completed',
    'Cancelled',
  ];

  /// Bookings waiting on the Admin, not the Guest.
  static bool needsAdminAction(BookingModel b) {
    switch (b.rawStatus) {
      case BookingStatuses.kycSubmitted:
      case BookingStatuses.checkedOut:
        return true;
      case BookingStatuses.paymentPending:
        return b.paymentProofUrl != null && b.paymentProofUrl!.isNotEmpty;
      case BookingStatuses.cancelled:
        return b.refundStatus == 'initiated';
      default:
        return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Booking Management',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          Tooltip(
            message: 'Refresh bookings',
            child: IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => ref.invalidate(bookingsStreamProvider),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Tabs
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: List.generate(_filters.length, (index) {
                  final isSelected = _selectedFilterIndex == index;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      key: index == 1 ? TourKeys.needsActionChip : null,
                      label: Text(
                        _filters[index],
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                          color: isSelected ? Colors.white : AppColors.textDark,
                        ),
                      ),
                      selected: isSelected,
                      selectedColor: AppColors.primaryForest,
                      backgroundColor: AppColors.surfaceLight,
                      side: BorderSide(
                        color: isSelected ? AppColors.primaryForest : AppColors.cardBorder,
                      ),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                      onSelected: (val) {
                        if (val) {
                          setState(() => _selectedFilterIndex = index);
                          TourBus.event('filter-changed');
                        }
                      },
                    ),
                  );
                }),
              ),
            ),
          ),
          const Divider(height: 1, color: AppColors.cardBorder),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: TextField(
              key: TourKeys.searchField,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search name, email, ref, stay…',
                isDense: true,
              ),
              onChanged: (v) {
                setState(() {
                  _query = v;
                  _page = 0;
                });
                TourBus.input('search-typed', v);
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: DropdownButton<String>(
              value: _sort,
              isExpanded: true,
              items: const [
                DropdownMenuItem(value: 'date', child: Text('Sort by booking date')),
                DropdownMenuItem(value: 'name', child: Text('Sort by guest name')),
                DropdownMenuItem(value: 'status', child: Text('Sort by status')),
              ],
              onChanged: (v) => setState(() => _sort = v ?? 'date'),
            ),
          ),

          // Live Stream List
          Expanded(
            child: bookingsAsync.when(
              data: (allBookings) {
                final q = _query.trim().toLowerCase();
                final filtered = allBookings.where((b) {
                  switch (_selectedFilterIndex) {
                    case 1:
                      return needsAdminAction(b);
                    case 2:
                      return b.status == BookingStatus.pending;
                    case 3:
                      return b.status == BookingStatus.confirmed;
                    case 4:
                      return b.status == BookingStatus.checkedIn;
                    case 5:
                      return b.status == BookingStatus.completed;
                    case 6:
                      return b.status == BookingStatus.cancelled;
                    case 0:
                    default:
                      return true;
                  }
                }).where((b) {
                  if (q.isEmpty) return true;
                  if (q.length > 80) return false;
                  final blob = '${b.guestName} ${b.guestEmail} ${b.accommodation} ${b.refId} ${b.rawStatus}'.toLowerCase();
                  return blob.contains(q);
                }).toList();
                filtered.sort((a, b) {
                  switch (_sort) {
                    case 'name':
                      return a.guestName.compareTo(b.guestName);
                    case 'status':
                      return a.rawStatus.compareTo(b.rawStatus);
                    default:
                      return b.checkIn.compareTo(a.checkIn);
                  }
                });
                final totalPages = (filtered.length / _pageSize).ceil().clamp(1, 9999);
                final page = _page.clamp(0, totalPages - 1);
                final slice = filtered.skip(page * _pageSize).take(_pageSize).toList();

                if (filtered.isEmpty) {
                  return const EmptyState(
                    icon: Icons.event_busy,
                    title: 'No bookings found',
                    subtitle: 'No reservations match the selected filter category.',
                  );
                }

                return Column(
                  children: [
                    Expanded(
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: slice.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 14),
                        itemBuilder: (context, i) {
                          final booking = slice[i];
                          return _buildBookingCard(
                            booking,
                            key: i == 0 ? TourKeys.firstBookingCard : null,
                          );
                        },
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: Row(
                        children: [
                          TextButton(
                            onPressed: page > 0 ? () => setState(() => _page = page - 1) : null,
                            child: const Text('Previous'),
                          ),
                          Expanded(
                            child: Text(
                              'Page ${page + 1} of $totalPages · ${filtered.length}',
                              textAlign: TextAlign.center,
                            ),
                          ),
                          TextButton(
                            onPressed: page < totalPages - 1 ? () => setState(() => _page = page + 1) : null,
                            child: const Text('Next'),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(child: Text('Error loading bookings: $err')),
            ),
          ),
        ],
      ),
    );
  }

  void _openDetail(BookingModel booking) {
    TourBus.event('open-detail');
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => BookingDetailScreen(bookingId: booking.id),
    ));
  }

  /// The one-tap step for this card, when the lifecycle offers one that
  /// needs no further input. Everything else goes through the detail screen.
  AdminAction? _quickAction(BookingModel booking) {
    final offered = adminActionsFor(booking.rawStatus);
    for (final a in const [
      AdminAction.approve,
      AdminAction.checkIn,
      AdminAction.beginStay,
      AdminAction.checkOut,
      AdminAction.complete,
    ]) {
      if (offered.contains(a)) return a;
    }
    return null;
  }

  Future<void> _runQuick(BookingModel booking, AdminAction action) async {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    final actor = Actor.admin(
      auth.uid ?? auth.sessionEmail ?? 'admin',
      auth.displayName ?? auth.sessionEmail,
    );
    final result = await ref
        .read(firestoreServiceProvider)
        .applyBookingAction(booking, action, actor);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      backgroundColor: result.ok ? null : AppColors.statusAlert,
      content: Text(result.ok
          ? '${booking.guestName}: ${result.patch['status']}'
          : (result.reason ?? 'Refused.')),
      duration: Duration(seconds: result.ok ? 3 : 6),
    ));
  }

  Widget _buildBookingCard(BookingModel booking, {Key? key}) {
    Color statusColor;
    switch (booking.status) {
      case BookingStatus.pending:
        statusColor = AppColors.statusWarning;
        break;
      case BookingStatus.confirmed:
        statusColor = AppColors.statusSuccess;
        break;
      case BookingStatus.checkedIn:
        statusColor = const Color(0xFF1D3557);
        break;
      case BookingStatus.completed:
        statusColor = AppColors.textMuted;
        break;
      case BookingStatus.cancelled:
        statusColor = AppColors.statusAlert;
        break;
    }

    final needsAction = needsAdminAction(booking);
    final quick = _quickAction(booking);
    final hold = holdRemaining(booking.toLifecycleDoc(), DateTime.now());

    return PressableBookingCard(
      key: key,
      onTap: () => _openDetail(booking),
      child: HaciendaCard(
        padding: EdgeInsets.zero,
        borderColor: needsAction
            ? AppColors.statusWarning.withOpacity(0.4)
            : AppColors.cardBorder,
        borderWidth: needsAction ? 1.5 : 1.0,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header Row
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: AppColors.primaryForest.withOpacity(0.1),
                    child: Text(
                      booking.guestName.isNotEmpty
                          ? booking.guestName[0].toUpperCase()
                          : 'G',
                      style: GoogleFonts.cinzel(
                        fontWeight: FontWeight.bold,
                        color: AppColors.primaryForest,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          booking.guestName,
                          style: GoogleFonts.inter(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textDark,
                          ),
                        ),
                        Text(
                          '${booking.guestPhone} · ${booking.guestEmail}',
                          style: GoogleFonts.inter(
                              fontSize: 11, color: AppColors.textMuted),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  StatusPill(
                    label: booking.rawStatus,
                    color: statusColor,
                    radius: 20,
                  ),
                ],
              ),
            ),

            // Stay Details & Badges
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: HaciendaCard(
                color: AppColors.surfaceLight,
                borderColor: null,
                shadows: const [],
                borderRadius: BorderRadius.circular(14),
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            booking.accommodation,
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textDark,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.cardBorder),
                          ),
                          child: Text(
                            DateFormatter.formatStayDuration(
                                booking.checkInDate, booking.checkOutDate),
                            style: GoogleFonts.inter(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: AppColors.primaryForest,
                            ),
                            maxLines: 1,
                            softWrap: false,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(Icons.calendar_today,
                            size: 12, color: AppColors.textMuted),
                        const SizedBox(width: 5),
                        Text(
                          DateFormatter.formatStayRange(
                              booking.checkInDate, booking.checkOutDate),
                          style: GoogleFonts.inter(
                              fontSize: 11, color: AppColors.textMuted),
                        ),
                        const Spacer(),
                        const Icon(Icons.people_outline,
                            size: 13, color: AppColors.textMuted),
                        const SizedBox(width: 4),
                        Text(
                          '${booking.guestCount} Guests',
                          style: GoogleFonts.inter(
                              fontSize: 11, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      booking.nextStep,
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: needsAction
                            ? AppColors.statusWarning
                            : AppColors.primaryForest,
                      ),
                    ),
                    if (isHoldExpirable(booking.rawStatus) &&
                        booking.holdExpiresAt != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Date hold: ${formatHoldCountdown(hold)}',
                        style: GoogleFonts.inter(
                            fontSize: 11, color: AppColors.textMuted),
                      ),
                    ],
                    if (booking.specialRequests != null &&
                        booking.specialRequests!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Notes: ${booking.specialRequests!}',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                          color: AppColors.textDark.withOpacity(0.8),
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
            ),

            // Action Buttons Row
            Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                spacing: 8,
                runSpacing: 6,
                alignment: WrapAlignment.end,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.phone_outlined,
                        size: 18, color: AppColors.primaryForest),
                    tooltip: 'Call Guest',
                    onPressed: () => _launchUrl(
                        'tel:${booking.guestPhone.replaceAll(' ', '')}'),
                  ),
                  IconButton(
                    icon: const Icon(Icons.sms_outlined,
                        size: 18, color: AppColors.primaryForest),
                    tooltip: 'Message Guest',
                    onPressed: () => _launchUrl(
                        'sms:${booking.guestPhone.replaceAll(' ', '')}'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _openDetail(booking),
                    icon: const Icon(Icons.fact_check_outlined, size: 15),
                    label: const Text('Review'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                    ),
                  ),
                  if (quick != null)
                    ElevatedButton.icon(
                      onPressed: () => _runQuick(booking, quick),
                      icon: const Icon(Icons.check, size: 15),
                      label: Text(quick.label),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: quick == AdminAction.approve
                            ? AppColors.statusSuccess
                            : const Color(0xFF1D3557),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 8),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {}
  }
}

/// A tap target around a booking card that keeps the card's own buttons
/// tappable (InkWell under the card, not over it).
class PressableBookingCard extends StatelessWidget {
  final Widget child;
  final VoidCallback onTap;
  const PressableBookingCard(
      {super.key, required this.child, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.deferToChild,
      onTap: onTap,
      child: child,
    );
  }
}
