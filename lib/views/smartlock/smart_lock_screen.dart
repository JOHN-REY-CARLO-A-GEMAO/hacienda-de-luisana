import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/smart_lock_event_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/firestore_service.dart';
import '../../services/notification_service.dart';
import '../security/secure_action_sheet.dart';
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

  /// The door filter is built from the doors the logs actually name.
  ///
  /// It used to be a fixed list of four — including 'Villa LuisAna Front Door',
  /// 'Casita Suite Entrance' and a 'Swimming Pool Safety Gate' that no event in
  /// the system used, and which named a pool the Hacienda has no documented
  /// Accommodation for. A filter option for a door that does not exist is a
  /// claim that it does.
  List<String> _doorOptions(List<SmartLockEventModel> logs) {
    final names = <String>{
      for (final log in logs)
        if (log.doorName.isNotEmpty && log.doorName != 'Unrecorded door') log.doorName,
    }.toList()
      ..sort();
    return ['All Doors', ...names];
  }

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
              : logs.where((l) => l.doorName == _doorFilter).toList();

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
                    children: _doorOptions(logs).map((d) {
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
              Row(
                mainAxisSize: MainAxisSize.min,
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
                  // The simulator's rows say what they are, in the log itself —
                  // demonstration rows never pass as door history (ADR-0015).
                  if (log.simulated) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.textMuted.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.textMuted.withOpacity(0.4)),
                      ),
                      child: Text(
                        'SIMULATED',
                        style: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold, color: AppColors.textMuted),
                      ),
                    ),
                  ],
                ],
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

  /// The simulator writes demonstration rows into the real Access log —
  /// the audit trail — so it runs behind a confirm, stamps its rows
  /// `simulated: true`, and says so when a write fails instead of
  /// swallowing it (ADR-0015's bundled fixes).
  Future<void> _simulateRfidSwipe(FirestoreService firestoreService) async {
    final ok = await showSecureConfirm(
      context,
      title: 'Run the RFID simulator?',
      body: 'Two demonstration rows, marked SIMULATED, are written into the real Access log. They are not door history.',
      confirm: 'Run it',
    );
    if (!ok || !mounted) return;

    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    final uid = auth.uid ?? auth.sessionEmail ?? 'admin';
    final now = DateTime.now();

    // 1. Record unlock
    final unlockEvent = SmartLockEventModel(
      id: 'lock-sim-${now.millisecondsSinceEpoch}',
      doorName: 'Simulated door',
      action: LockAction.unlock,
      method: LockMethod.rfidKeycard,
      triggeredBy: 'Simulator · Demo Swipe',
      cardUid: 'RFID-A3-89-CF-12',
      timestamp: now,
      isSuccess: true,
      notes: 'Simulated RFID tap — not a real credential use',
      uid: uid,
      refId: 'simulated',
      simulated: true,
    );

    final problem = await firestoreService.recordSmartLockEvent(unlockEvent);
    if (!mounted) return;
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        backgroundColor: AppColors.statusAlert,
        content: Text(problem),
        duration: const Duration(seconds: 6),
      ));
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('🟢 SIMULATED swipe recorded (marked as simulation). Auto-relock in 5s.'),
        duration: Duration(seconds: 4),
      ),
    );

    // 2. Schedule auto-relock in 5 seconds
    Future.delayed(const Duration(seconds: 5), () async {
      final relockEvent = SmartLockEventModel(
        id: 'lock-sim-relock-${DateTime.now().millisecondsSinceEpoch}',
        doorName: 'Simulated door',
        action: LockAction.autoRelock,
        method: LockMethod.autoTimer,
        triggeredBy: 'Simulator · Safety Timer',
        timestamp: DateTime.now(),
        isSuccess: true,
        notes: 'Simulated auto-relock after 5-second interval',
        uid: uid,
        refId: 'simulated',
        simulated: true,
      );
      final relockProblem = await firestoreService.recordSmartLockEvent(relockEvent);
      if (relockProblem != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          backgroundColor: AppColors.statusAlert,
          content: Text(relockProblem),
          duration: const Duration(seconds: 6),
        ));
      }
    });
  }
}
