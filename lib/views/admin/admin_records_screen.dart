import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../services/esp32_service.dart';
import '../../core/theme/app_theme.dart';

/// Owner tab 3: smart-lock records. No ESP32 hardware yet -> SIM MODE.
/// Shows the local access-log buffer (what WILL sync to `access_logs` once
/// hardware + syncLogs wiring lands). Never claims hardware is connected.
class AdminRecordsScreen extends StatelessWidget {
  const AdminRecordsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final lock = context.watch<Esp32Service>();
    final logs = lock.logs.toList().reversed.toList();
    final grants = logs.where((l) => l.granted).length;
    final denies = logs.length - grants;

    return Scaffold(
      appBar: AppBar(title: const Text('Smart lock')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.amber.shade50,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.amber.shade200),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline, color: Colors.black54),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'SIM MODE · no ESP32 hardware. Counts below are local simulation — '
                    'they will sync to access_logs once hardware arrives.',
                    style: GoogleFonts.inter(fontSize: 12, height: 1.45, color: Colors.black87),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: _StatCard(label: 'Unlocks', value: '$grants', color: Colors.green.shade700)),
              const SizedBox(width: 10),
              Expanded(child: _StatCard(label: 'Denied', value: '$denies', color: Colors.red.shade700)),
              const SizedBox(width: 10),
              Expanded(
                  child: _StatCard(
                      label: 'Unsynced',
                      value: '${lock.pendingSyncCount}',
                      color: AppTheme.forest800)),
            ],
          ),
          const SizedBox(height: 20),
          Text('ACCESS LOG · ${logs.length}',
              style: GoogleFonts.inter(
                  fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppTheme.olive)),
          const SizedBox(height: 10),
          if (logs.isEmpty)
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                  border: Border.all(color: AppTheme.forest900.withOpacity(0.15)),
                  borderRadius: BorderRadius.circular(16)),
              child: Text('No lock events yet (SIM).',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(fontSize: 13, color: AppTheme.forest800.withOpacity(0.7))),
            )
          else
            ...logs.take(50).map((l) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Icon(
                      l.granted ? Icons.lock_open : Icons.lock_outline,
                      color: l.granted ? Colors.green.shade700 : Colors.red.shade700,
                    ),
                    title: Text('${l.granted ? 'Unlocked' : 'Denied'} · ${l.refId.isEmpty ? 'no ref' : l.refId}',
                        style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w700)),
                    subtitle: Text(
                        '${DateFormat('MMM d, h:mm a').format(l.timestamp)} · ${l.reason}'
                        '${l.synced ? '' : ' · unsynced'}',
                        style: GoogleFonts.inter(fontSize: 11)),
                  ),
                )),
          const SizedBox(height: 16),
          Text(
            'When ESP32 arrives: flash firmware (BLE + RFID, offline buffer) → '
            'wire syncLogs → Firestore access_logs → this tab becomes the source of truth.',
            style: GoogleFonts.inter(fontSize: 11, color: AppTheme.forest800.withOpacity(0.6)),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatCard({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(color: AppTheme.cream100, borderRadius: BorderRadius.circular(14)),
      child: Column(
        children: [
          Text(value,
              style: GoogleFonts.cormorantGaramond(
                  fontSize: 26, fontWeight: FontWeight.w700, color: AppTheme.forest900)),
          Text(label, style: GoogleFonts.inter(fontSize: 11, color: color)),
        ],
      ),
    );
  }
}
