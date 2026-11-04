import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../models/smart_lock_event_model.dart';
import '../../providers/app_providers.dart';
import '../../services/booking_queue.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/explore_ui.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/section_header.dart';
import '../bookings/bookings_screen.dart';
import '../notifications/notifications_screen.dart';

/// The Admin's daily work page.
///
/// Every number on this page is derived from the Booking and Access-log
/// streams. The masthead states the day's real position; the ledger below is
/// ordered by the decision the Admin has to make next.
class DashboardScreen extends ConsumerWidget {
  final Function(int tabIndex) onNavigateTab;

  const DashboardScreen({
    super.key,
    required this.onNavigateTab,
  });

  void _openQueue(BuildContext context, String filter) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => BookingsScreen(initialFilter: filter, tourAnchors: false),
    ));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stats = ref.watch(dashboardStatsProvider);
    final bookingsAsync = ref.watch(bookingsStreamProvider);
    final smartLockLogsAsync = ref.watch(smartLockLogsStreamProvider);
    // The bell counts decisions, not notifications: the Notifications screen
    // lists several rows about one Booking (a proof is both "submitted" and
    // "to verify"), so its length was never the number of things to do.
    final pendingActions = ref.watch(pendingActionsCountProvider);

    Widget queuesSection() {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const AdminSectionHeading(
            title: 'Needs attention',
            caption: 'Open a queue to work through the real bookings inside it.',
          ),
          const SizedBox(height: 8),
          bookingsAsync.when(
            data: (bookings) {
              final queues = _operationalQueues(bookings);
              return Column(
                children: [
                  for (var i = 0; i < queues.length; i++) ...[
                    _QueueRow(
                      queue: queues[i],
                      onTap: () => _openQueue(context, queues[i].filter),
                    ),
                    if (i < queues.length - 1) const SizedBox(height: 8),
                  ],
                ],
              );
            },
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: LoadingState(
                label: 'Building the queues…',
                detail: 'Reading the current booking records.',
              ),
            ),
            error: (error, _) => AdminInlineNotice(
              title: 'Bookings could not be read',
              message:
                  'No queue is shown as complete. Check the connection and try again. ${error.toString().split('\n').first}',
              tone: AdminNoticeTone.danger,
              action: OutlinedButton.icon(
                onPressed: () => ref.invalidate(bookingsStreamProvider),
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Try again'),
              ),
            ),
          ),
        ],
      );
    }

    Widget quickActions() {
      // Category row in the explore-style kit (docs/DAILY_FLUTTER_UI_STYLE_GUIDE.md):
      // icon tile + label per destination, replacing the old button wrap. The
      // tour anchors on TourKeys.reviewBookings, so the key stays on the subtree.
      return HaciendaCard(
        padding: const EdgeInsets.all(14),
        child: KeyedSubtree(
          key: TourKeys.reviewBookings,
          child: ExploreCategoryRow(
            items: [
              ExploreCategory(
                label: 'Bookings',
                icon: Icons.confirmation_number_outlined,
                onTap: () => onNavigateTab(1),
              ),
              ExploreCategory(
                label: 'Chat',
                icon: Icons.chat_bubble_outline,
                onTap: () => onNavigateTab(2),
              ),
              ExploreCategory(
                label: 'Stays',
                icon: Icons.night_shelter_outlined,
                onTap: () => onNavigateTab(3),
              ),
              ExploreCategory(
                label: 'Smart lock',
                icon: Icons.lock_open_rounded,
                badge: 'NEW',
                onTap: () => onNavigateTab(5),
              ),
              ExploreCategory(
                label: 'More',
                icon: Icons.more_horiz,
                onTap: () => onNavigateTab(4),
              ),
            ],
          ),
        ),
      );
    }

    Widget activitySection() {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            title: 'Recent door activity',
            caption: 'Latest events from the Access log',
            padding: EdgeInsets.zero,
            actionLabel: 'All logs',
            actionSemanticsLabel: 'Open all smart lock logs',
            onAction: () => onNavigateTab(5),
          ),
          const SizedBox(height: 8),
          smartLockLogsAsync.when(
            data: (logs) {
              final recentLogs = logs.take(5).toList();
              if (recentLogs.isEmpty) {
                // Slim inline empty row — a full-height EmptyState card reads as
                // a broken layout when the Access log simply has no events yet.
                return HaciendaCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Row(
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: AppColors.primaryForest.withValues(alpha: 0.10),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.lock_clock_outlined,
                          size: 17,
                          color: AppColors.primaryForest,
                        ),
                      ),
                      const SizedBox(width: 11),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('No recent door activity', style: AppTheme.title(fontSize: 13)),
                            const SizedBox(height: 2),
                            Text(
                              'Real smart lock events will appear here.',
                              style: AppTheme.body(fontSize: 11, color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }
              return Column(
                children: [
                  for (var i = 0; i < recentLogs.length; i++) ...[
                    _FeedTile(log: recentLogs[i]),
                    if (i < recentLogs.length - 1) const SizedBox(height: 8),
                  ],
                ],
              );
            },
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: LoadingState(label: 'Reading door activity…'),
            ),
            error: (error, _) => AdminInlineNotice(
              title: 'Door activity could not be read',
              message: error.toString().split('\n').first,
              tone: AdminNoticeTone.danger,
              action: OutlinedButton.icon(
                onPressed: () => ref.invalidate(smartLockLogsStreamProvider),
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Try again'),
              ),
            ),
          ),
        ],
      );
    }

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AdminPageHeader(
        title: 'Hacienda de LuisAna',
        subtitle: 'Admin operations, ${DateFormatter.formatOperationsDay(DateTime.now())}',
        actions: [
          Semantics(
            button: true,
            label: pendingActions > 0
                ? 'Notifications, $pendingActions booking'
                    '${pendingActions == 1 ? '' : 's'} waiting'
                : 'Notifications',
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                IconButton(
                  tooltip: 'Notifications',
                  icon: const Icon(Icons.notifications_none, color: Colors.white),
                  onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const NotificationsScreen(),
                    ));
                  },
                ),
                if (pendingActions > 0)
                  Positioned(
                    top: 7,
                    right: 7,
                    child: IgnorePointer(
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 18),
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                        decoration: const BoxDecoration(
                          color: AppColors.statusAlert,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          '$pendingActions',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 10,
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primaryForest,
        onRefresh: () async {
          ref.invalidate(bookingsStreamProvider);
          ref.invalidate(smartLockLogsStreamProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 32),
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: AppTheme.pageMaxWidth),
              child: Padding(
                padding: const EdgeInsets.all(AppTheme.gutter),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _OperationsMasthead(stats: stats),
                    const SizedBox(height: 20),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        if (constraints.maxWidth < AppTheme.compactBreakpoint) {
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              queuesSection(),
                              const SizedBox(height: 18),
                              quickActions(),
                              const SizedBox(height: 18),
                              activitySection(),
                            ],
                          );
                        }
                        return AdminResponsiveColumns(
                          breakpoint: AppTheme.compactBreakpoint,
                          primary: queuesSection(),
                          secondary: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              quickActions(),
                              const SizedBox(height: 16),
                              activitySection(),
                            ],
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OperationsMasthead extends StatelessWidget {
  final DashboardStats stats;

  const _OperationsMasthead({required this.stats});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Today\'s operations. ${stats.pendingRequests} awaiting approval, '
          '${stats.todayCheckIns} arrivals, ${stats.activeStayingGuests} guests in house.',
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
        decoration: BoxDecoration(
          color: AppColors.primaryDark,
          borderRadius: BorderRadius.circular(AppTheme.radiusCard),
          border: Border.all(color: AppColors.accentGold.withValues(alpha: 0.55)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 3,
                  height: 26,
                  decoration: BoxDecoration(
                    color: AppColors.accentGold,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Today at the estate',
                        style: AppTheme.title(fontSize: 15, color: Colors.white),
                      ),
                      Text(
                        'Luisiana, Laguna, ${DateFormatter.formatOperationsDay(DateTime.now())}',
                        style: AppTheme.body(
                          fontSize: 11,
                          color: Colors.white.withValues(alpha: 0.68),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                AdminMastheadMetric(
                  value: '${stats.pendingRequests}',
                  label: 'Awaiting approval',
                  icon: Icons.fact_check_outlined,
                ),
                const SizedBox(width: 12),
                AdminMastheadMetric(
                  value: '${stats.todayCheckIns}',
                  label: 'Arrivals today',
                  icon: Icons.login_outlined,
                ),
                const SizedBox(width: 12),
                AdminMastheadMetric(
                  value: '${stats.activeStayingGuests}',
                  label: 'Guests in house',
                  icon: Icons.king_bed_outlined,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _OperationalQueue {
  final String title;
  final String description;
  final String filter;
  final IconData icon;
  final Color color;
  final List<BookingModel> bookings;

  /// True when the list this row opens is wider than the count on the row.
  ///
  /// "Needs action" is the one combined working list (approvals, payment
  /// review, check-outs, refunds), so its row must say that the list continues
  /// past the number it prints instead of implying the count is the whole list.
  final bool opensWiderList;

  const _OperationalQueue({
    required this.title,
    required this.description,
    required this.filter,
    required this.icon,
    required this.color,
    required this.bookings,
    this.opensWiderList = false,
  });
}

List<BookingModel> _sorted(Iterable<BookingModel> source, {bool byStayDate = false}) {
  final result = source.toList();
  result.sort((a, b) => byStayDate
      ? a.checkInDate.compareTo(b.checkInDate)
      : a.createdAt.compareTo(b.createdAt));
  return result;
}

List<_OperationalQueue> _operationalQueues(List<BookingModel> bookings) {
  final now = DateTime.now();
  // Each row owns a different piece of work. Approvals and Payments to verify
  // used to be counted a second time inside "Other admin actions", so two rows
  // described the same Bookings with different totals — the same seven proofs
  // read as 7 here and 8 there, and the row named "Other" showed nothing other
  // than the payment review above it. Rows now split the work as: approve,
  // verify payment, close a checked-out stay, pay out a refund, and check in
  // today's guests.
  final approvals = _sorted(bookings.where((booking) => bookingNeedsApproval(booking, now)));
  final payments = _sorted(bookings.where(bookingNeedsPaymentReview));
  final arrivals = _sorted(
    bookings.where((booking) => bookingArrivesToday(booking, now)),
    byStayDate: true,
  );
  final current = _sorted(bookings.where(bookingIsCurrentGuest));
  final other = _sorted(bookings.where(bookingIsUnattended));
  return [
    _OperationalQueue(
      title: 'Approvals',
      description: 'New bookings waiting for a decision.',
      filter: BookingListFilter.pendingVerification,
      icon: Icons.fact_check_outlined,
      color: AppColors.statusWarning,
      bookings: approvals,
    ),
    _OperationalQueue(
      title: 'Arrivals today',
      description: 'Approved or reserved stays checking in today.',
      filter: BookingListFilter.arrivalsToday,
      icon: Icons.meeting_room_outlined,
      color: AppColors.primaryForest,
      bookings: arrivals,
    ),
    _OperationalQueue(
      title: 'Current guests',
      description: 'Checked-in or staying guests and their next step.',
      filter: BookingListFilter.activeStay,
      icon: Icons.king_bed_outlined,
      color: AppColors.statusSuccess,
      bookings: current,
    ),
    _OperationalQueue(
      title: 'Payments to verify',
      description: 'Submitted proofs awaiting an Admin decision.',
      filter: BookingListFilter.paymentQueue,
      icon: Icons.payments_outlined,
      color: AppColors.accentGoldDark,
      bookings: payments,
    ),
    _OperationalQueue(
      title: 'Other admin actions',
      description: 'Checked-out stays to close and refunds to pay out.',
      filter: BookingListFilter.needsAction,
      // The list behind this row is "Needs action", which still contains the
      // approvals and payments above (that chip is the one combined working
      // queue). The row counts only its own remainder, so it states plainly
      // that it opens a wider list.
      opensWiderList: true,
      icon: Icons.assignment_late_outlined,
      color: AppColors.statusAlert,
      bookings: other,
    ),
  ];
}

/// The one-line preview on a queue row: the Guest whose Booking is next, and
/// what is waiting on it.
///
/// A lapsed Date hold is stated as what it is. [BookingModel.nextStep] is a
/// pure function of the stored status, and a Pending whose hold ran out still
/// reads `Pending` in the document — so printing `nextStep` there told the Admin
/// "Suriin ang downpayment screenshot" about a request whose dates had already
/// been released and whose approval the lifecycle refuses.
String _previewLine(BookingModel booking, DateTime now) {
  if (bookingHoldLapsed(booking, now)) {
    return '${booking.guestName}, the Date hold ran out — the dates were released, '
        'so this one needs no decision.';
  }
  return '${booking.guestName}, ${booking.nextStep}';
}

class _QueueRow extends StatelessWidget {
  final _OperationalQueue queue;
  final VoidCallback onTap;

  const _QueueRow({required this.queue, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final count = queue.bookings.length;
    final next = count == 0 ? null : queue.bookings.first;
    final tone = count > 0 ? queue.color : AppColors.textMuted;
    final nextLine = next == null ? queue.description : _previewLine(next, now);
    final countLabel = queue.opensWiderList
        ? '$count in this row; the list it opens also holds approvals and payments'
        : '$count bookings';

    return Semantics(
      button: true,
      label: '${queue.title}, $countLabel. Open the queue.',
      child: HaciendaCard(
        padding: EdgeInsets.zero,
        borderColor: count > 0
            ? queue.color.withValues(alpha: 0.36)
            : AppColors.cardBorder,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusCard),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 13, 12, 13),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: tone.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(queue.icon, size: 20, color: tone),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        queue.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTheme.title(fontSize: 14),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        nextLine,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTheme.body(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                // Count and chevron share one line so the numeral cannot stack
                // on top of the chevron and shove the two lines of copy into a
                // narrower column than the row has room for.
                Row(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text('$count', style: AppTheme.metric(fontSize: 22, color: tone)),
                    const SizedBox(width: 2),
                    const Icon(Icons.chevron_right, size: 18, color: AppColors.textMuted),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One recent smart-lock event in the dashboard feed.
class _FeedTile extends StatelessWidget {
  final SmartLockEventModel log;

  const _FeedTile({required this.log});

  @override
  Widget build(BuildContext context) {
    final isUnlock = log.action == LockAction.unlock;
    final isDenied = log.action == LockAction.denied;
    final color = isUnlock
        ? AppColors.statusSuccess
        : isDenied
            ? AppColors.statusAlert
            : AppColors.primaryForest;
    final icon = isUnlock
        ? Icons.lock_open_rounded
        : isDenied
            ? Icons.gpp_bad_rounded
            : Icons.lock_outline_rounded;

    return HaciendaCard(
      padding: const EdgeInsets.all(13),
      semanticLabel: '${log.doorName}, ${log.action.displayName}, ${DateFormatter.timeAgo(log.timestamp)}',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 17, color: color),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  log.doorName,
                  style: AppTheme.title(fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 3),
                Text(
                  '${log.action.displayName}, ${log.triggeredBy}, ${log.method.displayName}',
                  style: AppTheme.body(fontSize: 11, color: AppColors.textMuted),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 5),
                Text(
                  DateFormatter.timeAgo(log.timestamp),
                  style: AppTheme.label(fontSize: 11),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
