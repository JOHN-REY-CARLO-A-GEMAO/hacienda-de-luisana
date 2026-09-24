import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../providers/app_providers.dart';
import '../../models/smart_lock_event_model.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/metric_stat_card.dart';
import '../../widgets/section_header.dart';
import '../../widgets/staggered_entrance.dart';

class DashboardScreen extends ConsumerWidget {
  final Function(int tabIndex) onNavigateTab;

  const DashboardScreen({
    super.key,
    required this.onNavigateTab,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stats = ref.watch(dashboardStatsProvider);
    final smartLockLogsAsync = ref.watch(smartLockLogsStreamProvider);
    // Keep the bookings stream warm so pull-to-refresh can re-attach it.
    ref.watch(bookingsStreamProvider);

    final currencyFmt = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 0);

    final List<Widget> metricCards = [
      MetricStatCard(
        title: "Today's Check-ins",
        value: '${stats.todayCheckIns}',
        subtitle: stats.todayCheckIns > 0 ? 'Guests arriving today' : 'No arrivals scheduled',
        icon: Icons.meeting_room_outlined,
        accentColor: AppColors.primaryForest,
      ),
      MetricStatCard(
        title: 'Active Staying',
        value: '${stats.activeStayingGuests}',
        subtitle: '${stats.activeStayingGuests} Checked-in guests',
        icon: Icons.king_bed_outlined,
        accentColor: AppColors.statusSuccess,
      ),
      MetricStatCard(
        title: 'Pending Requests',
        value: '${stats.pendingRequests}',
        subtitle: stats.pendingRequests > 0 ? 'Action required!' : 'Up to date',
        icon: Icons.assignment_late_outlined,
        accentColor: stats.pendingRequests > 0 ? AppColors.statusAlert : AppColors.statusSuccess,
        hasAlert: stats.pendingRequests > 0,
      ),
      MetricStatCard(
        title: 'Month Revenue',
        value: currencyFmt.format(stats.currentMonthRevenue),
        subtitle: '${stats.totalGuestsHosted} total guests hosted',
        icon: Icons.payments_outlined,
        accentColor: AppColors.accentGoldDark,
      ),
    ];

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Hacienda de LuisAna',
              style: GoogleFonts.cinzel(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.8,
                color: Colors.white,
              ),
            ),
            Text(
              'Admin · ${DateFormat('EEEE, MMM dd, yyyy').format(DateTime.now())}',
              style: GoogleFonts.inter(
                fontSize: 11,
                color: AppColors.accentGoldLight.withOpacity(0.9),
                fontWeight: FontWeight.normal,
              ),
            ),
          ],
        ),
        actions: [
          Stack(
            children: [
              Semantics(
                button: true,
                label: 'Notifications',
                child: IconButton(
                  icon: const Icon(Icons.notifications_none, color: Colors.white),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Notifications: All systems operational.'),
                        duration: Duration(seconds: 2),
                      ),
                    );
                  },
                ),
              ),
              if (stats.pendingRequests > 0)
                Positioned(
                  top: 10,
                  right: 12,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: AppColors.statusAlert,
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      '${stats.pendingRequests}',
                      style: const TextStyle(fontSize: 9, color: Colors.white, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(bookingsStreamProvider);
          ref.invalidate(smartLockLogsStreamProvider);
        },
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            // 2. Summary Metric Cards — staggered in
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final columns = constraints.maxWidth >= 700 ? 4 : 2;
                  return GridView.count(
                    crossAxisCount: columns,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    childAspectRatio: columns == 4 ? 1.25 : 1.35,
                    children: [
                      for (int i = 0; i < metricCards.length; i++)
                        StaggeredEntrance(index: 1 + i, child: metricCards[i]),
                    ],
                  );
                },
              ),
            ),

            // Quick Shortcut Row — staggered in
            StaggeredEntrance(
              index: 5,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => onNavigateTab(1), // Bookings tab
                        icon: const Icon(Icons.confirmation_number_outlined, size: 16),
                        label: const Text('Review Bookings'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () => onNavigateTab(2),
                        icon: const Icon(Icons.chat_bubble_outline, size: 16),
                        label: const Text('Guest chat'),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // 3. Recent Activity Feed (Smart lock events & Booking updates)
            StaggeredEntrance(
              index: 6,
              child: SectionHeader(
                title: 'Recent activity feed',
                actionLabel: 'View All Logs →',
                actionSemanticsLabel: 'View all smart lock logs',
                onAction: () => onNavigateTab(5), // Smart lock tab
              ),
            ),

            smartLockLogsAsync.when(
              data: (logs) {
                final recentLogs = logs.take(5).toList();

                if (recentLogs.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.fromLTRB(16, 6, 16, 24),
                    child: EmptyState(
                      icon: Icons.lock_clock_outlined,
                      title: 'No recent activity',
                      subtitle: 'Smart lock events will appear here.',
                    ),
                  );
                }

                return ListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  itemCount: recentLogs.length,
                  itemBuilder: (context, i) {
                    final log = recentLogs[i];
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: StaggeredEntrance(
                        key: ValueKey('feed-${log.id}'),
                        index: 7 + i,
                        child: _FeedTile(log: log),
                      ),
                    );
                  },
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (_, __) => const SizedBox.shrink(),
            ),
          ],
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

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isUnlock
                  ? AppColors.statusSuccess.withOpacity(0.12)
                  : isDenied
                      ? AppColors.statusAlert.withOpacity(0.12)
                      : AppColors.primaryForest.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(
              isUnlock
                  ? Icons.lock_open_rounded
                  : isDenied
                      ? Icons.gpp_bad_rounded
                      : Icons.lock_outline_rounded,
              size: 16,
              color: isUnlock
                  ? AppColors.statusSuccess
                  : isDenied
                      ? AppColors.statusAlert
                      : AppColors.primaryForest,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      log.doorName,
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textDark,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      DateFormatter.timeAgo(log.timestamp),
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${log.action.displayName} by ${log.triggeredBy} · ${log.method.displayName}',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
