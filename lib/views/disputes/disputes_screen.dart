import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;

import '../../core/constants/app_constants.dart';
import '../../models/dispute_model.dart';
import '../../services/auth_store.dart';
import '../../services/dispute_service.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';
import '../bookings/booking_detail_screen.dart';

final disputeServiceProvider = Provider((ref) => DisputeService());

final disputesStreamProvider = StreamProvider<List<DisputeModel>>((ref) {
  final service = ref.watch(disputeServiceProvider);
  return service.streamAllDisputes();
});

class DisputesScreen extends ConsumerStatefulWidget {
  const DisputesScreen({super.key});

  @override
  ConsumerState<DisputesScreen> createState() => _DisputesScreenState();
}

class _DisputesScreenState extends ConsumerState<DisputesScreen> {
  String _statusFilter = 'all';

  @override
  Widget build(BuildContext context) {
    final disputesAsync = ref.watch(disputesStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Disputes & Complaints',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: Column(
        children: [
          _buildFilterBar(),
          Expanded(
            child: disputesAsync.when(
              data: (list) {
                final filtered = list.where((d) {
                  if (_statusFilter == 'all') return true;
                  return d.status == _statusFilter;
                }).toList()
                  ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

                if (filtered.isEmpty) {
                  return const EmptyState(
                    icon: Icons.gavel_outlined,
                    title: 'No disputes found',
                    subtitle: 'Guest dispute reports will appear here for review.',
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final dispute = filtered[index];
                    return _buildDisputeCard(dispute);
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(child: Text('Error loading disputes: $err')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterBar() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _chip('All', 'all'),
            const SizedBox(width: 8),
            _chip('Open', 'open'),
            const SizedBox(width: 8),
            _chip('Under Review', 'under_review'),
            const SizedBox(width: 8),
            _chip('Resolved', 'resolved'),
            const SizedBox(width: 8),
            _chip('Rejected', 'rejected'),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, String value) {
    final selected = _statusFilter == value;
    return ChoiceChip(
      label: Text(label, style: GoogleFonts.inter(fontSize: 12)),
      selected: selected,
      selectedColor: AppColors.primaryForest,
      backgroundColor: AppColors.surfaceLight,
      side: BorderSide(color: selected ? AppColors.primaryForest : AppColors.cardBorder),
      onSelected: (_) => setState(() => _statusFilter = value),
    );
  }

  Widget _buildDisputeCard(DisputeModel dispute) {
    Color statusColor;
    switch (dispute.status) {
      case 'resolved':
        statusColor = AppColors.statusSuccess;
        break;
      case 'rejected':
        statusColor = AppColors.statusAlert;
        break;
      case 'under_review':
        statusColor = const Color(0xFF1D3557);
        break;
      default:
        statusColor = AppColors.statusWarning;
    }

    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                dispute.category,
                style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold),
              ),
              StatusPill(
                label: dispute.status.toUpperCase().replaceAll('_', ' '),
                color: statusColor,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Booking ID: ${dispute.bookingId}',
            style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
          ),
          const SizedBox(height: 8),
          Text(
            dispute.description,
            style: GoogleFonts.inter(fontSize: 13, height: 1.4, color: AppColors.textDark),
          ),
          if (dispute.adminResponse != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.primaryForestLight.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Admin Response:',
                    style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    dispute.adminResponse!,
                    style: GoogleFonts.inter(fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton.icon(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => BookingDetailScreen(bookingId: dispute.bookingId),
                    ),
                  );
                },
                icon: const Icon(Icons.bookmark_outline, size: 16),
                label: const Text('View Booking'),
              ),
              ElevatedButton.icon(
                onPressed: () => _showManageDialog(dispute),
                icon: const Icon(Icons.rate_review_outlined, size: 16),
                label: const Text('Manage Report'),
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.primaryForest),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _showManageDialog(DisputeModel dispute) async {
    String status = dispute.status;
    final responseController = TextEditingController(text: dispute.adminResponse ?? '');
    final notesController = TextEditingController(text: dispute.internalNotes ?? '');

    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    final adminUid = auth.uid ?? 'admin';

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(
            'Manage Issue Report',
            style: GoogleFonts.cinzel(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Set Status:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  initialValue: status,
                  items: const [
                    DropdownMenuItem(value: 'open', child: Text('Open')),
                    DropdownMenuItem(value: 'under_review', child: Text('Under Review')),
                    DropdownMenuItem(value: 'resolved', child: Text('Resolved')),
                    DropdownMenuItem(value: 'rejected', child: Text('Rejected')),
                  ],
                  onChanged: (val) {
                    if (val != null) setDialogState(() => status = val);
                  },
                  decoration: const InputDecoration(border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                const Text('Public Response to Guest:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                TextField(
                  controller: responseController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    hintText: 'Response visible to guest on website...',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Internal Private Admin Notes:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                TextField(
                  controller: notesController,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    hintText: 'Private notes for admin team...',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () async {
                Navigator.pop(ctx);
                final service = ref.read(disputeServiceProvider);
                await service.updateDisputeStatus(
                  disputeId: dispute.id,
                  newStatus: status,
                  adminUid: adminUid,
                  adminResponse: responseController.text.trim(),
                  internalNotes: notesController.text.trim(),
                );
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Dispute status updated.')),
                  );
                }
              },
              child: const Text('Save Changes'),
            ),
          ],
        ),
      ),
    );
  }
}
