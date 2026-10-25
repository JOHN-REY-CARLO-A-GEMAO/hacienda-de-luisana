import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../models/smart_lock_event_model.dart';
import '../../providers/app_providers.dart';
import '../../services/booking_queue.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/section_header.dart';
import '../bookings/bookings_screen.dart';
import '../notifications/notifications_screen.dart';

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

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Hacienda de LuisAna',
              style: GoogleFonts.cinzel(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                letterSpacing: 0.4,
                color: Colors.white,
              ),
            ),
            const Text(
              'Admin · Mga Gagawin Ngayon',
              style: TextStyle(fontSize: 14, color: AppColors.accentGoldLight),
            ),
          ],
        ),
        actions: [
          Semantics(
            button: true,
            label: stats.pendingRequests > 0
                ? 'Mga notification, ${stats.pendingRequests} booking ang naghihintay'
                : 'Mga notification',
            child: Stack(
              children: [
                IconButton(
                  iconSize: 28,
                  tooltip: 'Mga notification',
                  icon: const Icon(Icons.notifications_none, color: Colors.white),
                  onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const NotificationsScreen(),
                    ));
                  },
                ),
                if (stats.pendingRequests > 0)
                  Positioned(
                    top: 7,
                    right: 7,
                    child: IgnorePointer(
                      child: Container(
                        padding: const EdgeInsets.all(5),
                        decoration: const BoxDecoration(
                          color: AppColors.statusAlert,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          '${stats.pendingRequests}',
                          style: const TextStyle(
                            fontSize: 11,
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
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 22, 20, 6),
              child: Text(
                'Ano ang kailangang gawin?',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textDark,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 14),
              child: Text(
                'Pumili ng queue upang buksan ang aktwal na mga booking. Ang bawat desisyon ay nasa loob pa rin ng booking at may kumpirmasyon.',
                style: TextStyle(fontSize: 17, color: AppColors.textMuted, height: 1.45),
              ),
            ),
            bookingsAsync.when(
              data: (bookings) {
                final queues = _operationalQueues(bookings);
                return Column(
                  children: [
                    for (final queue in queues)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
                        child: _QueueCard(
                          queue: queue,
                          onTap: () => _openQueue(context, queue.filter),
                        ),
                      ),
                  ],
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 36),
                child: LoadingState(
                  label: 'Binubuo ang mga queue…',
                  detail: 'Binabasa ang aktwal na mga booking. Sandali lamang.',
                ),
              ),
              error: (error, _) => EmptyState(
                icon: Icons.cloud_off_outlined,
                title: 'Hindi mabasa ang mga booking',
                subtitle: 'Walang ipinapakitang gawaing tapos na. Suriin ang koneksyon at subukan muli. ${error.toString().split('\n').first}',
                action: ElevatedButton.icon(
                  onPressed: () => ref.invalidate(bookingsStreamProvider),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Subukan Muli'),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  OutlinedButton.icon(
                    key: TourKeys.reviewBookings,
                    onPressed: () => onNavigateTab(1),
                    icon: const Icon(Icons.confirmation_number_outlined, size: 22),
                    label: const Text('Buksan ang Lahat ng Booking'),
                  ),
                  const SizedBox(height: 10),
                  ElevatedButton.icon(
                    onPressed: () => onNavigateTab(2),
                    icon: const Icon(Icons.chat_bubble_outline, size: 22),
                    label: const Text('Mensahe ng mga Bisita'),
                  ),
                ],
              ),
            ),
            SectionHeader(
              title: 'Kamakailang Aktibidad',
              actionLabel: 'Lahat ng Log',
              actionSemanticsLabel: 'Buksan ang lahat ng smart lock log',
              onAction: () => onNavigateTab(5),
            ),
            smartLockLogsAsync.when(
              data: (logs) {
                final recentLogs = logs.take(5).toList();
                if (recentLogs.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.fromLTRB(16, 6, 16, 24),
                    child: EmptyState(
                      icon: Icons.lock_clock_outlined,
                      title: 'Walang kamakailang aktibidad',
                      subtitle: 'Dito lalabas ang mga aktwal na smart lock event.',
                    ),
                  );
                }
                return ListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  itemCount: recentLogs.length,
                  itemBuilder: (context, index) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _FeedTile(log: recentLogs[index]),
                  ),
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.all(20),
                child: LoadingState(label: 'Binabasa ang lock activity…'),
              ),
              error: (error, _) => Padding(
                padding: const EdgeInsets.all(16),
                child: EmptyState(
                  icon: Icons.error_outline,
                  title: 'Hindi mabasa ang lock activity',
                  subtitle: error.toString().split('\n').first,
                  action: OutlinedButton.icon(
                    onPressed: () => ref.invalidate(smartLockLogsStreamProvider),
                    icon: const Icon(Icons.refresh),
                    label: const Text('Subukan Muli'),
                  ),
                ),
              ),
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

  const _OperationalQueue({
    required this.title,
    required this.description,
    required this.filter,
    required this.icon,
    required this.color,
    required this.bookings,
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
  return [
    _OperationalQueue(
      title: 'Kailangang Aprubahan',
      description: 'Mga bagong booking na naghihintay ng desisyon.',
      filter: BookingListFilter.pendingVerification,
      icon: Icons.fact_check_outlined,
      color: AppColors.statusWarning,
      bookings: _sorted(bookings.where(bookingNeedsApproval)),
    ),
    _OperationalQueue(
      title: 'Mga Darating Ngayon',
      description: 'Approved o Reserved na may check-in ngayong araw.',
      filter: BookingListFilter.arrivalsToday,
      icon: Icons.meeting_room_outlined,
      color: AppColors.primaryForest,
      bookings: _sorted(
        bookings.where((booking) => bookingArrivesToday(booking, now)),
        byStayDate: true,
      ),
    ),
    _OperationalQueue(
      title: 'Mga Kasalukuyang Bisita',
      description: 'Checked-In o Staying; tingnan ang susunod na hakbang.',
      filter: BookingListFilter.activeStay,
      icon: Icons.king_bed_outlined,
      color: AppColors.statusSuccess,
      bookings: _sorted(bookings.where(bookingIsCurrentGuest)),
    ),
    _OperationalQueue(
      title: 'Mga Bayad na Susuriin',
      description: 'May naipadalang patunay na hindi pa nabe-verify.',
      filter: BookingListFilter.paymentQueue,
      icon: Icons.payments_outlined,
      color: AppColors.accentGoldDark,
      bookings: _sorted(bookings.where(bookingNeedsPaymentReview)),
    ),
    _OperationalQueue(
      title: 'Mga Nangangailangan ng Aksyon',
      description: 'Approval, completion, payment review o refund.',
      filter: BookingListFilter.needsAction,
      icon: Icons.assignment_late_outlined,
      color: AppColors.statusAlert,
      bookings: _sorted(bookings.where(bookingNeedsAdminAction)),
    ),
  ];
}

class _QueueCard extends StatelessWidget {
  final _OperationalQueue queue;
  final VoidCallback onTap;

  const _QueueCard({required this.queue, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final count = queue.bookings.length;
    final next = count == 0 ? null : queue.bookings.first;
    return Semantics(
      button: true,
      label: '${queue.title}, $count booking. Buksan ang queue.',
      child: Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: count > 0 ? queue.color.withOpacity(0.45) : AppColors.cardBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 132),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: queue.color.withOpacity(0.12),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(queue.icon, size: 28, color: queue.color),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          queue.title,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textDark,
                            height: 1.25,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          queue.description,
                          style: const TextStyle(fontSize: 16, color: AppColors.textMuted, height: 1.35),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          next == null
                              ? 'Walang nakapila sa grupong ito.'
                              : 'Susunod: ${next.guestName} · ${next.nextStep}',
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 16,
                            height: 1.35,
                            fontWeight: next == null ? FontWeight.normal : FontWeight.w600,
                            color: next == null ? AppColors.textMuted : AppColors.textDark,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Column(
                    children: [
                      Text(
                        '$count',
                        style: TextStyle(fontSize: 30, fontWeight: FontWeight.bold, color: queue.color),
                      ),
                      const Icon(Icons.chevron_right, size: 30, color: AppColors.textMuted),
                    ],
                  ),
                ],
              ),
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

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle),
            child: Icon(
              isUnlock
                  ? Icons.lock_open_rounded
                  : isDenied
                      ? Icons.gpp_bad_rounded
                      : Icons.lock_outline_rounded,
              size: 24,
              color: color,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  log.doorName,
                  style: GoogleFonts.inter(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textDark,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${log.action.displayName} · ${log.triggeredBy} · ${log.method.displayName}',
                  style: GoogleFonts.inter(fontSize: 16, color: AppColors.textMuted, height: 1.35),
                ),
                const SizedBox(height: 4),
                Text(
                  DateFormatter.timeAgo(log.timestamp),
                  style: GoogleFonts.inter(fontSize: 14, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
