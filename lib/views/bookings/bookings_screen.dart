import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:provider/provider.dart' as legacy;
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
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
import '../../tutorial/tutorial_controller.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/status_pill.dart';
import '../inbox/inbox_screen.dart';
import '../security/secure_action_sheet.dart';
import '../security/security_pin_sheet.dart';
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
        return 'Check the payment proof and recorded downpayment before approving this booking.';
      }
      return 'This verifies ₱${amount.toStringAsFixed(0)} and confirms the dates '
          '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)}. '
          'It cannot be undone.';
    case AdminAction.checkIn:
      return 'The booking becomes Checked-In for the recorded stay.';
    case AdminAction.beginStay:
      return 'The booking becomes Staying — the guest is at the property.';
    case AdminAction.checkOut:
      return 'The booking becomes Checked-Out and opens the review window.';
    case AdminAction.complete:
      return 'The booking becomes Completed — this is the final status.';
    default:
      return 'The booking status will change in the Activity log.';
  }
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
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

  final TextEditingController _searchController = TextEditingController();
  int _selectedFilterIndex = 0;
  String _selectedAccommodation = 'All';
  String _query = '';
  String _sort = 'date';
  int _page = 0;
  bool _quickActionInFlight = false;
  /// Recomputes `now` so a hold that runs out while this screen is open flips
  /// pending cards to `Expired` without the Admin having to pull to refresh.
  Timer? _holdTicker;

  @override
  void initState() {
    super.initState();
    final requested = _filters.indexOf(widget.initialFilter ?? '');
    if (requested >= 0) _selectedFilterIndex = requested;
    _holdTicker = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _holdTicker?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _selectFilter(int index) {
    setState(() {
      _selectedFilterIndex = index;
      _page = 0;
    });
    if (widget.tourAnchors) TourBus.event('filter-changed');
  }

  void _clearAll() {
    setState(() {
      _searchController.clear();
      _query = '';
      _selectedFilterIndex = 0;
      _selectedAccommodation = 'All';
      _sort = 'date';
      _page = 0;
    });
  }

  Future<void> _openAdvancedFilters() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        var accommodation = _selectedAccommodation;
        var sort = _sort;
        return StatefulBuilder(
          builder: (context, setSheetState) => SafeArea(
            child: Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 8,
                bottom: 20 + MediaQuery.of(context).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Refine the list', style: AppTheme.display(fontSize: 21)),
                    const SizedBox(height: 4),
                    Text(
                      'These controls narrow the same live booking stream.',
                      style: AppTheme.body(fontSize: 13, color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 18),
                    DropdownButtonFormField<String>(
                      value: accommodation,
                      decoration: const InputDecoration(
                        labelText: 'Accommodation',
                        prefixIcon: Icon(Icons.hotel_outlined),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'All', child: Text('All accommodations')),
                        DropdownMenuItem(value: 'main-house', child: Text('Main House')),
                        DropdownMenuItem(value: 'annex', child: Text('Annex')),
                        DropdownMenuItem(value: 'house-a-camping', child: Text('A-House')),
                      ],
                      onChanged: (value) =>
                          setSheetState(() => accommodation = value ?? 'All'),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      value: sort,
                      decoration: const InputDecoration(
                        labelText: 'Sort by',
                        prefixIcon: Icon(Icons.swap_vert),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'date', child: Text('Newest first')),
                        DropdownMenuItem(value: 'date_asc', child: Text('Oldest first')),
                        DropdownMenuItem(value: 'checkin_near', child: Text('Nearest check-in')),
                        DropdownMenuItem(value: 'name', child: Text('Guest name')),
                        DropdownMenuItem(value: 'total_desc', child: Text('Highest total')),
                        DropdownMenuItem(value: 'status', child: Text('Status')),
                      ],
                      onChanged: (value) => setSheetState(() => sort = value ?? 'date'),
                    ),
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: () {
                        setState(() {
                          _selectedAccommodation = accommodation;
                          _sort = sort;
                          _page = 0;
                        });
                        Navigator.of(sheetContext).pop();
                      },
                      child: const Text('Apply filters'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () {
                        _clearAll();
                        Navigator.of(sheetContext).pop();
                      },
                      child: const Text('Clear all filters'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AdminPageHeader(
        title: _selectedFilterIndex == 0
            ? 'Bookings'
            : bookingFilterLabel(_filters[_selectedFilterIndex]),
        subtitle: 'Triage, contact and progress real stays',
        actions: [
          Tooltip(
            message: 'Payments to verify',
            child: IconButton(
              icon: const Icon(Icons.pending_actions_outlined, color: Colors.white),
              onPressed: () {
                Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => const PaymentVerificationQueueScreen(),
                ));
              },
            ),
          ),
          Tooltip(
            message: 'Refresh bookings',
            child: IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white),
              onPressed: () => ref.invalidate(bookingsStreamProvider),
            ),
          ),
        ],
      ),
      body: bookingsAsync.when(
        data: (allBookings) {
          final now = DateTime.now();
          final scoped = _scopedBookings(allBookings);
          final filterCounts = <String, int>{
            for (final filter in _filters)
              filter: scoped
                  .where((booking) => bookingMatchesFilter(booking, filter, now))
                  .length,
          };
          final filtered = _filteredBookings(allBookings, now);
          final totalPages = (filtered.length / _pageSize).ceil().clamp(1, 9999);
          final page = _page.clamp(0, totalPages - 1);
          final slice = filtered.skip(page * _pageSize).take(_pageSize).toList();

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildToolbar(filterCounts, filtered.length),
              Expanded(
                child: filtered.isEmpty
                    ? EmptyState(
                        icon: Icons.event_busy_outlined,
                        title: _query.isNotEmpty
                            ? 'No bookings match'
                            : 'This queue is clear',
                        subtitle: _query.isNotEmpty
                            ? 'Try a different name, reference or email. Nothing was deleted.'
                            : 'Nothing in this view needs attention. Choose another filter to continue.',
                        action: OutlinedButton.icon(
                          onPressed: _clearAll,
                          icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
                          label: const Text('Clear filters'),
                        ),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                        itemCount: slice.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, i) {
                          final booking = slice[i];
                          return _buildBookingCard(
                            booking,
                            key: widget.tourAnchors && i == 0
                                ? TourKeys.firstBookingCard
                                : null,
                          );
                        },
                      ),
              ),
              if (filtered.isNotEmpty)
                _buildPagination(page, totalPages, filtered.length),
            ],
          );
        },
        loading: () => const LoadingState(
          label: 'Reading bookings…',
          detail: 'Fetching the latest status and payment records.',
        ),
        error: (err, _) => EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Bookings could not be read',
          subtitle:
              'Check the connection. No action is treated as complete. ${err.toString().split('\n').first}',
          action: ElevatedButton.icon(
            onPressed: () => ref.invalidate(bookingsStreamProvider),
            icon: const Icon(Icons.refresh),
            label: const Text('Try again'),
          ),
        ),
      ),
    );
  }

  List<BookingModel> _scopedBookings(List<BookingModel> allBookings) {
    final q = _query.trim().toLowerCase();
    return allBookings.where((booking) {
      if (_selectedAccommodation != 'All' &&
          booking.accommodation != _selectedAccommodation) {
        return false;
      }
      if (q.isEmpty) return true;
      if (q.length > 80) return false;
      final blob = '${booking.guestName} ${booking.guestEmail} ${booking.guestPhone} '
              '${booking.accommodation} ${booking.refId} ${booking.rawStatus}'
          .toLowerCase();
      return blob.contains(q);
    }).toList();
  }

  List<BookingModel> _filteredBookings(
    List<BookingModel> allBookings,
    DateTime now,
  ) {
    final scoped = _scopedBookings(allBookings)
        .where((booking) => bookingMatchesFilter(
              booking,
              _filters[_selectedFilterIndex],
              now,
            ))
        .toList();

    scoped.sort((a, b) {
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
    return scoped;
  }

  Widget _buildToolbar(Map<String, int> filterCounts, int resultCount) {
    final hasAdvancedFilters = _selectedAccommodation != 'All' || _sort != 'date';
    return HaciendaCard(
      borderRadius: const BorderRadius.vertical(
        bottom: Radius.circular(AppTheme.radiusPanel),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Semantics(
                  textField: true,
                  label: 'Search bookings',
                  child: TextField(
                    key: widget.tourAnchors ? TourKeys.searchField : null,
                    controller: _searchController,
                    maxLength: 80,
                    textInputAction: TextInputAction.search,
                    style: AppTheme.body(fontSize: 14),
                    decoration: InputDecoration(
                      isDense: true,
                      prefixIcon: const Icon(Icons.search, size: 20),
                      labelText: 'Search bookings',
                      hintText: 'Guest, reference, email or status',
                      counterText: '',
                      suffixIcon: _query.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear search',
                              icon: const Icon(Icons.close, size: 18),
                              onPressed: () {
                                setState(() {
                                  _searchController.clear();
                                  _query = '';
                                  _page = 0;
                                });
                              },
                            ),
                    ),
                    onChanged: (value) {
                      setState(() {
                        _query = value;
                        _page = 0;
                      });
                      if (widget.tourAnchors) TourBus.input('search-typed', value);
                    },
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Semantics(
                button: true,
                label: hasAdvancedFilters
                    ? 'Filter and sort, active filters'
                    : 'Filter and sort',
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    IconButton.filledTonal(
                      tooltip: 'Filter and sort',
                      onPressed: _openAdvancedFilters,
                      icon: const Icon(Icons.tune),
                    ),
                    if (hasAdvancedFilters)
                      const Positioned(
                        top: 7,
                        right: 7,
                        child: CircleAvatar(
                          radius: 4,
                          backgroundColor: AppColors.accentGold,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          AdminFilterStrip(
            items: [
              for (final filter in _filters)
                AdminFilterItem(
                  label: bookingFilterLabel(filter),
                  count: filterCounts[filter],
                ),
            ],
            selectedIndex: _selectedFilterIndex,
            keyFor: (index) => widget.tourAnchors && index == 1
                ? TourKeys.needsActionChip
                : null,
            onSelected: _selectFilter,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(Icons.format_list_bulleted, size: 15, color: AppColors.textMuted),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '$resultCount ${resultCount == 1 ? 'booking' : 'bookings'} in this view',
                  style: AppTheme.label(fontSize: 12),
                ),
              ),
              if (_query.isNotEmpty || hasAdvancedFilters || _selectedFilterIndex != 0)
                TextButton(
                  onPressed: _clearAll,
                  child: const Text('Clear all'),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPagination(int page, int totalPages, int resultCount) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.cardSurface,
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(bottom: 4),
        child: Row(
          children: [
            IconButton(
              tooltip: 'Previous page',
              onPressed: page > 0 ? () => setState(() => _page = page - 1) : null,
              icon: const Icon(Icons.chevron_left),
            ),
            Expanded(
              child: Semantics(
                liveRegion: true,
                child: Text(
                  'Page ${page + 1} of $totalPages, $resultCount bookings',
                  textAlign: TextAlign.center,
                  style: AppTheme.label(fontSize: 12, color: AppColors.textDark),
                ),
              ),
            ),
            IconButton(
              tooltip: 'Next page',
              onPressed:
                  page < totalPages - 1 ? () => setState(() => _page = page + 1) : null,
              icon: const Icon(Icons.chevron_right),
            ),
          ],
        ),
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
            ? 'Recorded: ${booking.guestName} — ${result.patch['status']}'
            : 'Not completed: ${result.reason ?? 'The service refused the action.'}'),
        duration: Duration(seconds: result.ok ? 4 : 7),
      ));
    } catch (error) {
      if (!mounted) return;
      _say('The action was not completed. Check the connection and try again. ${error.toString().split('\n').first}');
    } finally {
      if (mounted) setState(() => _quickActionInFlight = false);
    }
  }

  Widget _buildBookingCard(BookingModel booking, {Key? key}) {
    final now = DateTime.now();
    final doc = booking.toLifecycleDoc();
    final effective = effectiveStatus(doc, now);
    // A pending Booking whose 24-hour Date hold ran out reads as Expired on
    // every surface, even though the document still says Pending until the
    // Admin records the expiry.
    final expiredPending =
        booking.rawStatus == BookingStatuses.pending &&
        effective == BookingStatuses.expired;
    final statusColor = StatusStyle.colorForEnum(booking.status);
    final needsAction = bookingNeedsAdminAction(booking);
    final quick = _quickAction(booking);
    final hold = holdRemaining(doc, now);
    final paymentStatus = (booking.paymentStatus ?? 'unpaid').toLowerCase();
    final total = booking.stayTotal ?? booking.totalAmount;
    final accommodations = ref.watch(accommodationsProvider);

    return PressableBookingCard(
      key: key,
      onTap: () {
        if (!_quickActionInFlight) _openDetail(booking);
      },
      semanticLabel: 'Open booking for ${booking.guestName}, ${booking.rawStatus}',
      child: HaciendaCard(
        padding: const EdgeInsets.all(16),
        borderColor: needsAction
            ? AppColors.statusWarning.withValues(alpha: 0.5)
            : AppColors.cardBorder,
        borderWidth: needsAction ? 1.4 : 1.0,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 21,
                  backgroundColor: AppColors.primaryForest.withValues(alpha: 0.10),
                  child: Text(
                    booking.guestName.isNotEmpty
                        ? booking.guestName[0].toUpperCase()
                        : 'G',
                    style: AppTheme.serif(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primaryForest,
                    ),
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        booking.guestName,
                        style: AppTheme.title(fontSize: 16),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        booking.refId ?? 'No reference on file',
                        style: AppTheme.label(fontSize: 11),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        booking.guestPhone,
                        style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                StatusPill(
                  label: expiredPending ? 'Expired' : booking.rawStatus,
                  color: expiredPending ? AppColors.statusNeutral : statusColor,
                  icon: Icons.schedule_outlined,
                ),
                StatusPill(
                  label: 'Payment: $paymentStatus',
                  color: StatusStyle.payment(paymentStatus),
                  icon: Icons.receipt_long_outlined,
                ),
              ],
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 14),
              child: Divider(height: 1),
            ),
            AdminInfoRow(
              icon: Icons.holiday_village_outlined,
              label: 'Stay',
              value: BookingModel.accommodationLabel(
                booking.accommodation,
                accommodations,
              ),
            ),
            AdminInfoRow(
              icon: Icons.calendar_month_outlined,
              label: 'Dates',
              value: DateFormatter.formatStayRange(
                booking.checkInDate,
                booking.checkOutDate,
              ),
            ),
            AdminInfoRow(
              icon: Icons.groups_outlined,
              label: 'Party',
              value:
                  '${booking.guestCount} guests, ₱${total.toStringAsFixed(2)} total',
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: needsAction ? AppColors.goldMist : AppColors.sageMist,
                borderRadius: BorderRadius.circular(AppTheme.radiusPanel),
                border: Border.all(
                  color: (needsAction
                          ? AppColors.statusWarning
                          : AppColors.primaryForest)
                      .withValues(alpha: 0.22),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    needsAction ? Icons.priority_high : Icons.checklist_outlined,
                    size: 18,
                    color: needsAction
                        ? AppColors.statusWarning
                        : AppColors.primaryForest,
                  ),
                  const SizedBox(width: 9),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Next step',
                          style: AppTheme.label(
                            fontSize: 11,
                            color: needsAction
                                ? AppColors.statusWarning
                                : AppColors.primaryForest,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          expiredPending
                              ? 'The Date hold ran out — the dates are free again. Record the expiry on this booking\u2019s detail screen.'
                              : booking.nextStep,
                          style: AppTheme.body(fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (isHoldExpirable(booking.rawStatus) && booking.holdExpiresAt != null) ...[
              const SizedBox(height: 9),
              Text(
                'Date hold: ${formatHoldCountdown(hold)}',
                style: AppTheme.label(fontSize: 11),
              ),
            ],
            if (booking.specialRequests != null &&
                booking.specialRequests!.isNotEmpty) ...[
              const SizedBox(height: 9),
              Text(
                'Notes: ${booking.specialRequests!}',
                style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _cardAction(
                  icon: Icons.phone_outlined,
                  label: 'Call',
                  onPressed: _quickActionInFlight
                      ? null
                      : () => _launchUrl('tel:${booking.guestPhone.replaceAll(' ', '')}'),
                ),
                _cardAction(
                  icon: Icons.chat_bubble_outline,
                  label: 'Message',
                  onPressed: _quickActionInFlight ? null : () => _openConversation(booking),
                ),
                _cardAction(
                  icon: Icons.fact_check_outlined,
                  label: 'Review',
                  onPressed:
                      _quickActionInFlight ? null : () => _openDetail(booking),
                ),
              ],
            ),
            if (quick != null) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _quickActionInFlight || expiredPending
                      ? null
                      : () => _runQuick(booking, quick),
                  icon: _quickActionInFlight
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.check, size: 19),
                  label: Text(
                    expiredPending
                        ? 'Expired (Hold Timed Out)'
                        : _quickActionInFlight
                            ? 'Working… do not tap again'
                            : quick.label,
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: expiredPending
                        ? AppColors.statusNeutral
                        : (quick == AdminAction.approve
                            ? AppColors.statusSuccess
                            : AppColors.statusInfo),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _cardAction({
    required IconData icon,
    required String label,
    required VoidCallback? onPressed,
  }) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        visualDensity: VisualDensity.compact,
        textStyle: AppTheme.label(fontSize: 12, color: AppColors.primaryForest),
      ),
      icon: Icon(icon, size: 17),
      label: Text(label),
    );
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) _say('This device could not open the phone dialler.');
    } catch (_) {
      if (mounted) _say('The call could not be opened. Try a guest message instead.');
    }
  }
}

/// A tap target around a booking card that keeps the card's own buttons
/// tappable (InkWell under the card, not over it).
class PressableBookingCard extends StatelessWidget {
  final Widget child;
  final VoidCallback onTap;
  final String semanticLabel;

  const PressableBookingCard({
    super.key,
    required this.child,
    required this.onTap,
    required this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.deferToChild,
        onTap: onTap,
        child: child,
      ),
    );
  }
}
