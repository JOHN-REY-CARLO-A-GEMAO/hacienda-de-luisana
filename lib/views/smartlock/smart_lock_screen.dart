import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/rfid_card_model.dart';
import '../../models/smart_lock_event_model.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_store.dart';
import '../../services/firestore_service.dart';
import '../security/secure_action_sheet.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/staggered_entrance.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/loading_state.dart';
import '../../core/theme/app_theme.dart';

/// Door access: the one home of the smart-lock Access log — counters, door
/// filter, RFID card register, simulators and the full audit trail. Reached
/// via More › Smart lock logs; the Dashboard does not repeat any of it.
class SmartLockScreen extends ConsumerStatefulWidget {
  const SmartLockScreen({super.key});

  @override
  ConsumerState<SmartLockScreen> createState() => _SmartLockScreenState();
}

class _SmartLockScreenState extends ConsumerState<SmartLockScreen> {
  String _doorFilter = 'All Doors';

  /// The one demo card the simulators tap and the register reports on.
  static const String _demoCardUid = 'RFID-A3-89-CF-12';

  RfidCardModel? _demoCard;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadDemoCard());
  }

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
        if (log.doorName.isNotEmpty && log.doorName != 'Unrecorded door')
          log.doorName,
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
      appBar: const AdminPageHeader(
        title: 'Door access',
        subtitle: 'Real-time smart lock audit trail',
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.extended(
            heroTag: 'simulateRfidSwipe',
            backgroundColor: AppColors.primaryForest,
            foregroundColor: Colors.white,
            icon: const Icon(Icons.nfc_rounded, size: 20),
            label: const Text('Simulate RFID Swipe'),
            onPressed: () => _simulateRfidSwipe(firestoreService),
          ),
          const SizedBox(height: 10),
          FloatingActionButton.extended(
            heroTag: 'simulateDeskCheckoutTap',
            backgroundColor: AppColors.primaryForest.withOpacity(0.85),
            foregroundColor: Colors.white,
            icon: const Icon(Icons.logout, size: 20),
            label: const Text('Simulate Check-out Tap (desk)'),
            onPressed: () => _simulateDeskCheckoutTap(firestoreService),
          ),
        ],
      ),
      body: lockLogsAsync.when(
        data: (logs) {
          final doorOptions = _doorOptions(logs);
          final totalUnlocks =
              logs.where((l) => l.action == LockAction.unlock).length;
          final totalRelocks = logs
              .where((l) =>
                  l.action == LockAction.lock ||
                  l.action == LockAction.autoRelock)
              .length;
          final totalDenied = logs
              .where((l) => l.action == LockAction.denied || !l.isSuccess)
              .length;

          // A door can disappear when the stream changes. Fall back to the
          // real "all" view rather than showing an unselected, empty filter.
          final effectiveDoorFilter =
              doorOptions.contains(_doorFilter) ? _doorFilter : 'All Doors';
          final filteredLogs = effectiveDoorFilter == 'All Doors'
              ? logs
              : logs.where((l) => l.doorName == effectiveDoorFilter).toList();

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
                          title: 'Unlocks',
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
                          title: 'Auto-relocks',
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
                          title: 'Access denied',
                          value: '$totalDenied',
                          color: AppColors.statusAlert,
                          icon: Icons.gpp_bad_rounded,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // Door filters built from the doors the logs actually name.
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: AdminFilterStrip(
                  items: [
                    for (final door in doorOptions)
                      AdminFilterItem(
                        label: door,
                        count: door == 'All Doors'
                            ? logs.length
                            : logs.where((log) => log.doorName == door).length,
                      ),
                  ],
                  selectedIndex: doorOptions.indexOf(effectiveDoorFilter),
                  onSelected: (index) =>
                      setState(() => _doorFilter = doorOptions[index]),
                ),
              ),
              const SizedBox(height: 14),

              // The desk reader's register entry for the demo card.
              _buildCardRegister(_demoCard),
              const SizedBox(height: 14),

              // 2. Audit Trail Header
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Audit trail (${filteredLogs.length})',
                      style: AppTheme.title(fontSize: 14),
                    ),
                    Text(
                      'Down to the second',
                      style: GoogleFonts.inter(
                          fontSize: 11, color: AppColors.textMuted),
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
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
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
        loading: () => const LoadingState(
          label: 'Reading door activity…',
          detail: 'Loading the real-time Access log.',
        ),
        error: (err, _) => EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Door activity could not be read',
          subtitle:
              'Check the connection and try again. ${err.toString().split('\n').first}',
          action: OutlinedButton.icon(
            onPressed: () => ref.invalidate(smartLockLogsStreamProvider),
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Try again'),
          ),
        ),
      ),
    );
  }

  /// Reloads the demo card's register entry for [_buildCardRegister] —
  /// after first frame, and again after a simulated desk tap rewrites it.
  Future<void> _loadDemoCard() async {
    final card =
        await ref.read(firestoreServiceProvider).fetchRfidCard(_demoCardUid);
    if (!mounted) return;
    setState(() => _demoCard = card);
  }

  /// The desk reader's card register as a rounded white card: icon tile, card
  /// uid + payload kind, the encoded payload itself, and a status pill —
  /// ACTIVE (opens a room) until the check-out tap flips it to the REVOKED
  /// calling card.
  Widget _buildCardRegister(RfidCardModel? card) {
    final active = card?.status == RfidCardStatus.active;
    final tone = active ? AppColors.statusSuccess : AppColors.statusAlert;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: tone.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.credit_card, color: tone),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('RFID card register',
                      style: AppTheme.title(fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(
                    card == null
                        ? 'No card issued yet — run the check-out tap demo to issue one.'
                        : '${card.cardUid} · ${card.payloadKind.displayName}',
                    style: GoogleFonts.inter(
                        fontSize: 11, color: AppColors.textMuted),
                  ),
                  if (card != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      card.payload,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        color: AppColors.textDark,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (card != null) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: tone.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  card.status.displayName,
                  style: GoogleFonts.inter(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: tone,
                  ),
                ),
              ),
            ],
          ],
        ),
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
            style: GoogleFonts.cinzel(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: AppColors.textDark),
          ),
          const SizedBox(height: 2),
          Text(
            title,
            style: AppTheme.label(fontSize: 11),
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
        badgeColor = C
        olors.purple;
        break;
      case LockAction.keyWritten:
        badgeColor = AppColors.statusSuccess;
        break;
      case LockAction.keyRevoked:
        badgeColor = AppColors.statusAlert;
        break;
      case LockAction.cardRewritten:
        badgeColor = AppColors.primaryForest;
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
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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
                          decoration: BoxDecoration(
                              color: badgeColor, shape: BoxShape.circle),
                        ),
                        Text(
                          log.action.displayName,
                          style: GoogleFonts.inter(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: badgeColor),
                        ),
                      ],
                    ),
                  ),
                  // The simulator's rows say what they are, in the log itself —
                  // demonstration rows never pass as door history (ADR-0015).
                  if (log.simulated) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.textMuted.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: AppColors.textMuted.withOpacity(0.4)),
                      ),
                      child: Text(
                        'Simulation',
                        style: GoogleFonts.inter(
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                            color: AppColors.textMuted),
                      ),
                    ),
                  ],
                ],
              ),
              Text(
                DateFormatter.timeAgo(log.timestamp),
                style:
                    GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            log.doorName,
            style: GoogleFonts.inter(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: AppColors.textDark),
          ),
          const SizedBox(height: 3),
          Text(
            'Triggered by: ${log.triggeredBy}, ${log.method.displayName}${log.cardUid != null ? ' (${log.cardUid})' : ''}',
            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
          ),
          if (log.notes != null && log.notes!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              log.notes!,
              style: GoogleFonts.inter(
                  fontSize: 11,
                  fontStyle: FontStyle.italic,
                  color: AppColors.textDark.withOpacity(0.8)),
            ),
          ],
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.access_time_filled,
                  size: 11, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Text(
                DateFormatter.formatFull(log.timestamp),
                style: GoogleFonts.inter(
                    fontSize: 10,
                    fontFeatures: const [FontFeature.tabularFigures()],
                    color: AppColors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// The check-out desk tap, end to end: issue a room key onto the demo card
  /// if it has none, then tap at the desk — which revokes the key and rewrites
  /// the card to the website link (souvenir calling card). Every step lands in
  /// the Access log stamped SIMULATED. One ESP32 (the smart lock) serves both
  /// the door and the desk tap.
  Future<void> _simulateDeskCheckoutTap(
      FirestoreService firestoreService) async {
    final ok = await showSecureConfirm(
      context,
      title: 'Simulate a check-out desk tap?',
      body:
          'Key write + revoke + card rewrite for demo card $_demoCardUid. All rows are marked SIMULATED in the Access log.',
      confirm: 'Run it',
    );
    if (!ok || !mounted) return;

    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    final uid = auth.uid ?? auth.sessionEmail ?? 'admin';

    final existing = await firestoreService.fetchRfidCard(_demoCardUid);
    if (existing == null) {
      final problem = await firestoreService.issueRoomKey(
        cardUid: _demoCardUid,
        bookingRefId: 'simulated',
        accommodationId: 'main-house',
        actorUid: uid,
      );
      if (!mounted) return;
      if (problem != null) {
        _showProblem(problem);
        return;
      }
    }

    final problem = await firestoreService.deskCheckoutTap(
      cardUid: _demoCardUid,
      actorUid: uid,
    );
    if (!mounted) return;
    if (problem != null) {
      _showProblem(problem);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
            'Check-out tap recorded: key revoked and card $_demoCardUid rewritten to ${AppConstants.websiteUrl} (calling card).'),
        duration: const Duration(seconds: 5),
      ),
    );
    await _loadDemoCard();
  }

  void _showProblem(String problem) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      backgroundColor: AppColors.statusAlert,
      content: Text(problem),
      duration: const Duration(seconds: 6),
    ));
  }

  /// The simulator writes demonstration rows into the real Access log —
  /// the audit trail — so it runs behind a confirm, stamps its rows
  /// `simulated: true`, and says so when a write fails instead of
  /// swallowing it (ADR-0015's bundled fixes).
  Future<void> _simulateRfidSwipe(FirestoreService firestoreService) async {
    final ok = await showSecureConfirm(
      context,
      title: 'Run the RFID simulator?',
      body:
          'Two demonstration rows, marked SIMULATED, are written into the real Access log. They are not door history.',
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
      triggeredBy: 'Simulator (demo swipe)',
      cardUid: _demoCardUid,
      timestamp: now,
      isSuccess: true,
      notes: 'Simulated RFID tap — not a real credential use',
      reason: 'Simulated unlock by Admin',
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
        content: Text(
            'Simulated swipe recorded and marked as a simulation. Auto-relock in 5 seconds.'),
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
        triggeredBy: 'Simulator (safety timer)',
        timestamp: DateTime.now(),
        isSuccess: true,
        notes: 'Simulated auto-relock after 5-second interval',
        reason: 'Simulated auto-relock',
        uid: uid,
        refId: 'simulated',
        simulated: true,
      );
      final relockProblem =
          await firestoreService.recordSmartLockEvent(relockEvent);
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
