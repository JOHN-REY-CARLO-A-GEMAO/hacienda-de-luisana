import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/status_style.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/booking_lifecycle.dart';
import '../../services/booking_queue.dart';
import '../../services/guest_conversation_lookup.dart';
import '../../services/pin_store.dart';
import '../../services/security_gate.dart';
import '../inbox/inbox_screen.dart';
import '../security/secure_action_sheet.dart';
import '../security/security_pin_sheet.dart';
import '../../tutorial/tutorial_controller.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/status_pill.dart';
import 'booking_detail_screen.dart';
import 'payment_verification_queue_screen.dart';

class BookingsScreen extends ConsumerStatefulWidget {
  /// Optional queue selected on the dashboard. It only chooses a view; all
  /// actions still use the same booking details and lifecycle gates.
  final String? initialFilter;
  /// The main tab owns the guided-tour GlobalKeys. Dashboard queue routes are
  /// additional mounted lists, so they deliberately do not duplicate them.
  final bool tourAnchors;

  const BookingsScreen({super.key, this.initialFilter, this.tourAnchors = true});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

/// One line of consequence for a quick action, in the gate's own words —
/// the sheet names what the tap will do before the tap does it (ADR-0015).
String quickConsequence(BookingModel booking, AdminAction action) {
  switch (action) {
    case AdminAction.approve:
      final amount = booking.amountClaimed;
      if (amount == null || amount <= 0) {
        return 'Suriin ang payment proof at naitalang downpayment bago aprubahan ang booking.';
      }
      return 'Be-verify nito ang ₱${amount.toStringAsFixed(0)} at ifi-firm ang petsang '
          '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)}. '
          'Hindi ito maibabalik.';
    case AdminAction.checkIn:
      return 'Magiging Checked-In ang booking para sa naitalang stay.';
    case AdminAction.beginStay:
      return 'Magiging Staying — nasa property na ang Guest.';
    case AdminAction.checkOut:
      return 'Magiging Checked-Out at magbubukas ang Review window.';
    case AdminAction.complete:
      return 'Magiging Completed — ito na ang huling status.';
    default:
      return 'Magbabago ang status ng Booking sa Activity log.';
  }
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  int _selectedFilterIndex = 0;
  String _selectedAccommodation = 'All';
  String _query = '';
  String _sort = 'date';
  int _page = 0;
  bool _quickActionInFlight = false;
  static const int _pageSize = 10;

  static const List<String> _filters = [
    BookingListFilter.all,
    BookingListFilter.needsAction,
    BookingListFilter.paymentQueue,
    BookingListFilter.pendingVerification,
    BookingListFilter.confirmed,
    BookingListFilter.activeStay,
    BookingListFilter.completed,
    BookingListFilter.closed,
    BookingListFilter.arrivalsToday,
  ];

  @override
  void initState() {
    super.initState();
    final requested = _filters.indexOf(widget.initialFilter ?? '');
    if (requested >= 0) _selectedFilterIndex = requested;
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          _selectedFilterIndex == 0
              ? 'Mga Booking'
              : bookingFilterLabel(_filters[_selectedFilterIndex]),
          style: GoogleFonts.cinzel(fontSize: 20, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.pending_actions),
            tooltip: 'Mga Bayad na Susuriin',
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const PaymentVerificationQueueScreen(),
              ));
            },
          ),
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
                      key: widget.tourAnchors && index == 1 ? TourKeys.needsActionChip : null,
                      label: Text(
                        bookingFilterLabel(_filters[index]),
                        style: GoogleFonts.inter(
                          fontSize: 16,
                          fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                          color: isSelected ? Colors.white : AppColors.textDark,
                        ),
                      ),
                      selected: isSelected,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      selectedColor: AppColors.primaryForest,
                      backgroundColor: AppColors.surfaceLight,
                      side: BorderSide(
                        color: isSelected ? AppColors.primaryForest : AppColors.cardBorder,
                      ),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                      onSelected: (val) {
                        if (val) {
                          setState(() {
                            _selectedFilterIndex = index;
                            _page = 0;
                          });
                          if (widget.tourAnchors) TourBus.event('filter-changed');
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
              key: widget.tourAnchors ? TourKeys.searchField : null,
              style: const TextStyle(fontSize: 18),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                labelText: 'Hanapin ang booking',
                hintText: 'Pangalan, email, reference o matutuluyan',
              ),
              onChanged: (v) {
                setState(() {
                  _query = v;
                  _page = 0;
                });
                if (widget.tourAnchors) TourBus.input('search-typed', v);
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: DropdownButton<String>(
                    value: _selectedAccommodation,
                    isExpanded: true,
                    underline: const SizedBox(),
                    items: const [
                      DropdownMenuItem(value: 'All', child: Text('All Accommodations')),
                      DropdownMenuItem(value: 'main-house', child: Text('Main House')),
                      DropdownMenuItem(value: 'annex', child: Text('Annex')),
                      DropdownMenuItem(value: 'house-a-camping', child: Text('A-House')),
                    ],
                    onChanged: (v) => setState(() => _selectedAccommodation = v ?? 'All'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButton<String>(
                    value: _sort,
                    isExpanded: true,
                    underline: const SizedBox(),
                    items: const [
                      DropdownMenuItem(value: 'date', child: Text('Sort: Newest First')),
                      DropdownMenuItem(value: 'date_asc', child: Text('Sort: Oldest First')),
                      DropdownMenuItem(value: 'checkin_near', child: Text('Sort: Nearest Check-In')),
                      DropdownMenuItem(value: 'name', child: Text('Sort: Guest Name')),
                      DropdownMenuItem(value: 'total_desc', child: Text('Sort: Highest Total')),
                      DropdownMenuItem(value: 'status', child: Text('Sort: Status')),
                    ],
                    onChanged: (v) => setState(() => _sort = v ?? 'date'),
                  ),
                ),
              ],
            ),
          ),

          // Live Stream List
          Expanded(
            child: bookingsAsync.when(
              data: (allBookings) {
                final q = _query.trim().toLowerCase();
                final filterNow = DateTime.now();
                final filtered = allBookings.where((b) {
                  if (_selectedAccommodation != 'All' &&
                      b.accommodation != _selectedAccommodation) {
                    return false;
                  }
                  return bookingMatchesFilter(
                    b,
                    _filters[_selectedFilterIndex],
                    filterNow,
                  );
                }).where((b) {
                  if (q.isEmpty) return true;
                  if (q.length > 80) return false;
                  final blob = '${b.guestName} ${b.guestEmail} ${b.guestPhone} ${b.accommodation} ${b.refId} ${b.rawStatus}'.toLowerCase();
                  return blob.contains(q);
                }).toList();

                filtered.sort((a, b) {
                  switch (_sort) {
                    case 'name':
                      return a.guestName.compareTo(b.guestName);
                    case 'status':
                      return a.rawStatus.compareTo(b.rawStatus);
                    case 'date_asc':
                      return a.createdAt.compareTo(b.createdAt);
                    case 'checkin_near':
                      return a.checkInDate.compareTo(b.checkInDate);
                    case 'total_desc':
                      return b.totalAmount.compareTo(a.totalAmount);
                    case 'date':
                    default:
                      return b.createdAt.compareTo(a.createdAt);
                  }
                });
                final totalPages = (filtered.length / _pageSize).ceil().clamp(1, 9999);
                final page = _page.clamp(0, totalPages - 1);
                final slice = filtered.skip(page * _pageSize).take(_pageSize).toList();

                if (filtered.isEmpty) {
                  return EmptyState(
                    icon: Icons.event_busy,
                    title: q.isNotEmpty ? 'Walang tumugma sa hinahanap' : 'Walang booking sa queue na ito',
                    subtitle: q.isNotEmpty
                        ? 'Subukan ang ibang pangalan, email o reference. Walang booking na binura o binago.'
                        : 'Tapos ang grupong ito. Pumili ng ibang filter upang makita ang iba pang booking.',
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
                            key: widget.tourAnchors && i == 0 ? TourKeys.firstBookingCard : null,
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
                            child: const Text('Nakaraan'),
                          ),
                          Expanded(
                            child: Text(
                              'Pahina ${page + 1} ng $totalPages · ${filtered.length} booking',
                              textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 16),
                            ),
                          ),
                          TextButton(
                            onPressed: page < totalPages - 1 ? () => setState(() => _page = page + 1) : null,
                            child: const Text('Susunod'),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
              loading: () => const LoadingState(
                label: 'Binabasa ang mga booking…',
                detail: 'Kinukuha ang pinakabagong status at payment records.',
              ),
              error: (err, _) => EmptyState(
                icon: Icons.cloud_off_outlined,
                title: 'Hindi mabasa ang mga booking',
                subtitle: 'Suriin ang koneksyon. Walang aksyong itinuturing na tapos. ${err.toString().split('\n').first}',
                action: ElevatedButton.icon(
                  onPressed: () => ref.invalidate(bookingsStreamProvider),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Subukan Muli'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openDetail(BookingModel booking) {
    if (widget.tourAnchors) TourBus.event('open-detail');
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => BookingDetailScreen(bookingId: booking.id),
    ));
  }

  /// Open the conversation this Guest and the Admin already have.
  ///
  /// The message button used to hand the phone to the SMS app, which asks the
  /// Admin to start a *second* conversation in a *different* app and then keep
  /// two threads in step by hand. The conversation already lives in Firestore
  /// and the Admin can read it, so this opens that one — the thread the Guest
  /// sees on the website.
  ///
  /// A Guest who has never written leaves nothing to open, and the Admin cannot
  /// create the thread either: `firestore.rules` makes the creator the Guest
  /// (`guest_uid == request.auth.uid`). So that case says so instead of opening
  /// an empty screen that could never be sent from.
  Future<void> _openConversation(BookingModel booking) async {
    final uid = booking.uid;
    final name = booking.guestName;

    if (uid == null || uid.isEmpty) {
      _say('This Booking carries no Guest identity, so there is no thread to open. Ask them to write from the website first.');
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(const SnackBar(
      content: Text('Looking for their conversation…'),
      duration: Duration(milliseconds: 1200),
    ));

    GuestConversation? thread;
    Object? failure;
    try {
      thread = await threadForBooking(
        uid,
        bookingId: booking.id,
        fallbackGuestName: name,
      );
    } catch (error) {
      failure = error;
    }

    if (!mounted) return;
    messenger.hideCurrentSnackBar();
    if (failure != null) {
      _say('Could not reach the inbox. Please check your connection and try again.');
      return;
    }
    if (thread == null) {
      _say('$name has not written to us yet. Ask them to start a conversation from the website, and it will appear here.');
      return;
    }

    final openThread = thread;
    final accommodations = ref.read(accommodationsProvider);
    final propertyLabel = BookingModel.accommodationLabel(
      booking.accommodation,
      accommodations,
    );
    if (widget.tourAnchors) TourBus.event('open-thread');
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ThreadScreen(
        convoId: openThread.id,
        guestUid: openThread.guestUid,
        guestName: openThread.guestName.isNotEmpty ? openThread.guestName : name,
        bookingId: booking.id,
        bookingReference: booking.refId ?? openThread.bookingReference,
        propertyName: openThread.propertyName ?? propertyLabel,
      ),
    ));
  }

  void _say(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// The one-tap step for this card, when the lifecycle offers one that
  /// needs no further input. Everything else goes through the detail screen.
  AdminAction? _quickAction(BookingModel booking) {
    final offered = adminActionsFor(booking.rawStatus);
    final doc = booking.toLifecycleDoc();
    for (final a in const [
      AdminAction.approve,
      AdminAction.checkIn,
      AdminAction.beginStay,
      AdminAction.checkOut,
      AdminAction.complete,
    ]) {
      if (offered.contains(a) && adminActionBlockedReason(doc, a) == null) return a;
    }
    return null;
  }

  /// The gate (ADR-0015) sits in front of the quick tap: Approve asks for
  /// the Security PIN, the stay transitions ask for a confirm — neither is
  /// ever one bare tap on a card any more.
  Future<void> _runQuick(BookingModel booking, AdminAction action) async {
    // Lock before the PIN/confirmation sheet as well as before the write. Two
    // rapid taps must not open two sheets or apply the same transition twice.
    if (_quickActionInFlight) return;
    setState(() => _quickActionInFlight = true);
    try {
      SecurityTicket? ticket;
      if (gateForBookingAction(action, proofRejectionCancels: false) ==
          GateLevel.pin) {
        ticket = await requirePinTicket(
          context,
          ref: ref,
          title: '${action.label} — ${booking.guestName}',
          consequence: quickConsequence(booking, action),
        );
        if (ticket == null) return;
      } else {
        final ok = await showSecureConfirm(
          context,
          title: '${action.label} — ${booking.guestName}?',
          body: quickConsequence(booking, action),
        );
        if (!ok) return;
      }
      if (!mounted) return;
      final auth = legacy.Provider.of<AuthStore>(context, listen: false);
      final actor = Actor.admin(
        auth.uid ?? auth.sessionEmail ?? 'admin',
        auth.displayName ?? auth.sessionEmail,
      );
      final result = await ref
          .read(firestoreServiceProvider)
          .applyBookingAction(booking, action, actor, ticket: ticket);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: result.ok ? null : AppColors.statusAlert,
        content: Text(result.ok
            ? 'Naitala: ${booking.guestName} — ${result.patch['status']}'
            : 'Hindi naisagawa: ${result.reason ?? 'Tinanggihan ng serbisyo.'}'),
        duration: Duration(seconds: result.ok ? 4 : 7),
      ));
    } catch (error) {
      if (!mounted) return;
      _say('Hindi naisagawa ang aksyon. Suriin ang koneksyon at subukan muli. ${error.toString().split('\n').first}');
    } finally {
      if (mounted) setState(() => _quickActionInFlight = false);
    }
  }

  Widget _buildBookingCard(BookingModel booking, {Key? key}) {
    final statusColor = StatusStyle.colorForEnum(booking.status);
    final needsAction = bookingNeedsAdminAction(booking);
    final quick = _quickAction(booking);
    final hold = holdRemaining(booking.toLifecycleDoc(), DateTime.now());
    final paymentStatus = (booking.paymentStatus ?? 'unpaid').toLowerCase();
    final total = booking.stayTotal ?? booking.totalAmount;

    return PressableBookingCard(
      key: key,
      onTap: () {
        if (!_quickActionInFlight) _openDetail(booking);
      },
      child: HaciendaCard(
        padding: const EdgeInsets.all(20),
        borderColor: needsAction
            ? AppColors.statusWarning.withOpacity(0.55)
            : AppColors.cardBorder,
        borderWidth: needsAction ? 1.5 : 1.0,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 25,
                  backgroundColor: AppColors.primaryForest.withOpacity(0.1),
                  child: Text(
                    booking.guestName.isNotEmpty
                        ? booking.guestName[0].toUpperCase()
                        : 'G',
                    style: GoogleFonts.cinzel(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primaryForest,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        booking.guestName,
                        style: GoogleFonts.inter(
                          fontSize: 21,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textDark,
                          height: 1.25,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${booking.guestPhone}\n${booking.guestEmail}',
                        style: GoogleFonts.inter(
                          fontSize: 16,
                          color: AppColors.textMuted,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                StatusPill(label: booking.rawStatus, color: statusColor, fontSize: 14),
                StatusPill(
                  label: 'Bayad: $paymentStatus',
                  color: StatusStyle.payment(paymentStatus),
                  fontSize: 14,
                ),
                if (booking.refId != null)
                  StatusPill(
                    label: booking.refId!,
                    color: AppColors.primaryForest,
                    fontSize: 14,
                  ),
              ],
            ),
            const Divider(height: 28),
            Text(
              BookingModel.accommodationLabel(
                booking.accommodation,
                ref.watch(accommodationsProvider),
              ),
              style: GoogleFonts.inter(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.textDark,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.calendar_today, size: 22, color: AppColors.primaryForest),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)}\n'
                    '${DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate)}',
                    style: GoogleFonts.inter(fontSize: 18, color: AppColors.textDark, height: 1.4),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              '${booking.guestCount} bisita · Kabuuan: ₱${total.toStringAsFixed(2)}',
              style: GoogleFonts.inter(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: AppColors.textDark,
              ),
            ),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: needsAction
                    ? AppColors.statusWarning.withOpacity(0.09)
                    : AppColors.primaryForest.withOpacity(0.06),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                'Susunod na hakbang: ${booking.nextStep}',
                style: GoogleFonts.inter(
                  fontSize: 18,
                  height: 1.4,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textDark,
                ),
              ),
            ),
            if (isHoldExpirable(booking.rawStatus) && booking.holdExpiresAt != null) ...[
              const SizedBox(height: 10),
              Text(
                'Date hold: ${formatHoldCountdown(hold)}',
                style: GoogleFonts.inter(fontSize: 16, color: AppColors.textMuted),
              ),
            ],
            if (booking.specialRequests != null && booking.specialRequests!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'Notes: ${booking.specialRequests!}',
                style: GoogleFonts.inter(fontSize: 16, color: AppColors.textDark, height: 1.35),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 18),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _launchUrl('tel:${booking.guestPhone.replaceAll(' ', '')}'),
                  icon: const Icon(Icons.phone_outlined, size: 22),
                  label: const Text('Tawagan'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _openConversation(booking),
                  icon: const Icon(Icons.chat_bubble_outline, size: 22),
                  label: const Text('Mensahe'),
                ),
                OutlinedButton.icon(
                  onPressed: _quickActionInFlight ? null : () => _openDetail(booking),
                  icon: const Icon(Icons.fact_check_outlined, size: 22),
                  label: const Text('Suriin'),
                ),
              ],
            ),
            if (quick != null) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _quickActionInFlight ? null : () => _runQuick(booking, quick),
                  icon: _quickActionInFlight
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.check, size: 22),
                  label: Text(_quickActionInFlight ? 'Isinasagawa… huwag pindutin muli' : quick.label),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: quick == AdminAction.approve
                        ? AppColors.statusSuccess
                        : const Color(0xFF1D3557),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) _say('Hindi mabuksan ang tawag sa device na ito.');
    } catch (_) {
      if (mounted) _say('Hindi mabuksan ang tawag. Subukan muli o gamitin ang mensahe.');
    }
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
