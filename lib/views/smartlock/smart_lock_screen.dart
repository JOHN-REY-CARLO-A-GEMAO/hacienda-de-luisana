import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/smart_lock_event_model.dart';
import '../../providers/app_providers.dart';
import '../../services/notification_service.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/staggered_entrance.dart';

class SmartLockScreen extends ConsumerStatefulWidget {
  const SmartLockScreen({super.key});

  @override
  ConsumerState<SmartLockScreen> createState() => _SmartLockScreenState();
}

class _SmartLockScreenState extends ConsumerState<SmartLockScreen> {
  String _doorFilter = 'All Doors';

  final List<String> _doors = [
    'All Doors',
    'Villa LuisAna Front Door',
    'Resort Main Entrance Gate',
    'Casita Suite Entrance',
    'Swimming Pool Safety Gate',
  ];

  @override
  Widget build(BuildContext context) {
    final lockLogsAsync = ref.watch(smartLockLogsStreamProvider);
    final firestoreService = ref.read(firestoreServiceProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Smart Lock Security & Logs',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.primaryForest,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.nfc_rounded, size: 20),
        label: const Text('Simulate RFID Swipe'),
        onPressed: () => _simulateRfidSwipe(firestoreService),
      ),
      body: lockLogsAsync.when(
        data: (logs) {
          final totalUnlocks = logs.where((l) => l.action == LockAction.unlock).length;
          final totalRelocks = logs.where((l) => l.action == LockAction.lock || l.action == LockAction.autoRelock).length;
          final totalDenied = logs.where((l) => l.action == LockAction.denied || !l.isSuccess).length;

          final filteredLogs = _doorFilter == 'All Doors'
              ? logs
              : logs.where((l) => l.doorName.toLowerCase().contains(_doorFilter.toLowerCase().split(' ').first)).toList();

          return ListView(
            padding: const EdgeInsets.only(bottom: 84),
            children: [
              // 1. Summary Metric Counters at Top
              Padding(
                key: TourKeys.smartLockStats,
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: StaggeredEntrance(
                        index: 0,
                        child: _buildCounterTile(
                          title: 'TOTAL UNLOCKS',
                          value: '$totalUnlocks',
                          color: AppColors.statusSuccess,
                          icon: Icons.lock_open_rounded,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: StaggeredEntrance(
                        index: 1,
                        child: _buildCounterTile(
                          title: 'AUTO-RELOCKS',
                          value: '$totalRelocks',
                          color: AppColors.primaryForest,
                          icon: Icons.lock_clock_rounded,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: StaggeredEntrance(
                        index: 2,
                        child: _buildCounterTile(
                          title: 'ACCESS DENIED',
                          value: '$totalDenied',
                          color: AppColors.statusAlert,
                          icon: Icons.gpp_bad_rounded,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // Filter Bar
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _doors.map((d) {
                      final isSelected = _doorFilter == d;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(
                            d,
                            style: GoogleFonts.inter(
                              fontSize: 11,
                              color: isSelected ? Colors.white : AppColors.textDark,
                              fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                            ),
                          ),
                          selected: isSelected,
                          selectedColor: AppColors.primaryForest,
                          backgroundColor: Colors.white,
                          side: BorderSide(color: isSelected ? AppColors.primaryForest : AppColors.cardBorder),
                          onSelected: (val) {
                            if (val) setState(() => _doorFilter = d);
                          },
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // 2. Audit Trail Header
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'REAL-TIME AUDIT TRAIL (${filteredLogs.length})',
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: AppColors.textMuted,
                      ),
                    ),
                    Text(
                      'Down to the second',
                      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),

              // 3. Audit Trail List
              if (filteredLogs.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 24),
                  child: EmptyState(
                    icon: Icons.lock_clock_outlined,
                    title: 'No lock activity',
                    subtitle: 'Simulate an RFID swipe to see the audit trail.',
                  ),
                )
              else
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  itemCount: filteredLogs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, i) {
                    final log = filteredLogs[i];
                    // New events animate in; existing rows keep their settled
                    // state because they are keyed by event id.
                    return StaggeredEntrance(
                      key: ValueKey('lock-${log.id}'),
                      index: i.clamp(0, 5),
                      child: _buildLogCard(log),
                    );
                  },
                ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
      ),
    );
  }

  Widget _buildCounterTile({
    required String title,
    required String value,
    required Color color,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 6),
          Text(
            value,
            style: GoogleFonts.cinzel(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.textDark),
          ),
          const SizedBox(height: 2),
          Text(
            title,
            style: GoogleFonts.inter(fontSize: 9, fontWeight: FontWeight.bold, color: AppColors.textMuted),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildLogCard(SmartLockEventModel log) {
    Color badgeColor;
    switch (log.action) {
      case LockAction.unlock:
        badgeColor = AppColors.statusSuccess;
        break;
      case LockAction.lock:
      case LockAction.autoRelock:
        badgeColor = AppColors.primaryForest;
        break;
      case LockAction.denied:
        badgeColor = AppColors.statusAlert;
        break;
      case LockAction.masterOverride:
        badgeColor = Colors.purple;
        break;
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: badgeColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: badgeColor.withOpacity(0.4)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      margin: const EdgeInsets.only(right: 5),
                      decoration: BoxDecoration(color: badgeColor, shape: BoxShape.circle),
                    ),
                    Text(
                      log.action.displayName,
                      style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: badgeColor),
                    ),
                  ],
                ),
              ),
              Text(
                DateFormatter.timeAgo(log.timestamp),
                style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            log.doorName,
            style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold, color: AppColors.textDark),
          ),
          const SizedBox(height: 3),
          Text(
            'Triggered by: ${log.triggeredBy} · ${log.method.displayName}${log.cardUid != null ? ' (${log.cardUid})' : ''}',
            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
          ),
          if (log.notes != null && log.notes!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              log.notes!,
              style: GoogleFonts.inter(fontSize: 11, fontStyle: FontStyle.italic, color: AppColors.textDark.withOpacity(0.8)),
            ),
          ],
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.access_time_filled, size: 11, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Text(
                DateFormatter.formatFull(log.timestamp),
                style: GoogleFonts.inter(fontSize: 10, fontFeatures: const [FontFeature.tabularFigures()], color: AppColors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _simulateRfidSwipe(dynamic firestoreService) async {
    final now = DateTime.now();

    // 1. Record unlock
    final unlockEvent = SmartLockEventModel(
      id: 'lock-sim-${now.millisecondsSinceEpoch}',
      doorName: 'Villa LuisAna Front Door',
      action: LockAction.unlock,
      method: LockMethod.rfidKeycard,
      triggeredBy: 'Juan Dela Cruz (Demo Swipe)',
      cardUid: 'RFID-A3-89-CF-12',
      timestamp: now,
      isSuccess: true,
      notes: 'Authorized RFID Keycard tap · 800ms BLE handshake',
    );

    await firestoreService.recordSmartLockEvent(unlockEvent);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('🟢 RFID Swiped: Villa Door UNLOCKED. Auto-relock scheduled in 5s!'),
          duration: Duration(seconds: 4),
        ),
      );
    }

    // 2. Schedule auto-relock in 5 seconds
    Future.delayed(const Duration(seconds: 5), () async {
      final relockEvent = SmartLockEventModel(
        id: 'lock-sim-relock-${DateTime.now().millisecondsSinceEpoch}',
        doorName: 'Villa LuisAna Front Door',
        action: LockAction.autoRelock,
        method: LockMethod.autoTimer,
        triggeredBy: 'System Safety Timer',
        timestamp: DateTime.now(),
        isSuccess: true,
        notes: 'Door securely auto-relocked after 5-second interval',
      );
      await firestoreService.recordSmartLockEvent(relockEvent);
    });
  }
}
