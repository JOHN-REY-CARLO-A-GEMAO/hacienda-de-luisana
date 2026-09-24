import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_constants.dart';
import '../../models/room_model.dart';
import '../../providers/app_providers.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';

class RoomsScreen extends ConsumerWidget {
  const RoomsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final roomsAsync = ref.watch(roomsStreamProvider);
    final firestoreService = ref.read(firestoreServiceProvider);
    final currencyFmt = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 0);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Rooms & Accommodations',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: roomsAsync.when(
        data: (rooms) {
          if (rooms.isEmpty) {
            return const EmptyState(
              icon: Icons.hotel_outlined,
              title: 'No rooms published',
              subtitle: 'Accommodations appear here once the host publishes rates.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rooms.length,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (context, i) {
              final room = rooms[i];
              return _buildRoomCard(context, room, firestoreService, currencyFmt);
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
      ),
    );
  }

  Widget _buildRoomCard(
    BuildContext context,
    RoomModel room,
    dynamic firestoreService,
    NumberFormat currencyFmt,
  ) {
    Color statusColor;
    switch (room.status) {
      case RoomStatus.available:
        statusColor = AppColors.statusSuccess;
        break;
      case RoomStatus.occupied:
        statusColor = AppColors.statusAlert;
        break;
      case RoomStatus.maintenance:
        statusColor = Colors.amber.shade800;
        break;
    }

    return HaciendaCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with Name & Status
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        room.name,
                        style: GoogleFonts.cinzel(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textDark,
                        ),
                      ),
                    ),
                    StatusPill(
                      label: room.status.displayName,
                      color: statusColor,
                      radius: 14,
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.people_outline, size: 14, color: AppColors.textMuted),
                    const SizedBox(width: 4),
                    Text(
                      'Up to ${room.capacity} Guests',
                      style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
                    ),
                    const SizedBox(width: 14),
                    const Icon(Icons.payments_outlined, size: 14, color: AppColors.textMuted),
                    const SizedBox(width: 4),
                    Text(
                      '${currencyFmt.format(room.pricePerNight)} / night',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.primaryForest,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // Amenities chips
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: room.amenities.map((a) {
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceLight,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        a,
                        style: GoogleFonts.inter(fontSize: 10, color: AppColors.textMuted),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 14),
                const Divider(height: 1, color: AppColors.cardBorder),
                const SizedBox(height: 10),

                // Controls Row (Status dropdown & Price adjust)
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('Status Control:', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600)),
                        Flexible(
                          child: DropdownButton<RoomStatus>(
                            value: room.status,
                            underline: const SizedBox.shrink(),
                            items: RoomStatus.values.map((s) {
                              return DropdownMenuItem(
                                value: s,
                                child: Text(s.displayName, style: GoogleFonts.inter(fontSize: 12)),
                              );
                            }).toList(),
                            onChanged: (newStatus) {
                              if (newStatus != null) {
                                firestoreService.updateRoomStatus(room.id, newStatus);
                              }
                            },
                          ),
                        ),
                      ],
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _showPriceOverrideDialog(context, room, firestoreService),
                      icon: const Icon(Icons.edit_outlined, size: 13),
                      label: const Text('Edit Rate'),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showPriceOverrideDialog(BuildContext context, RoomModel room, dynamic firestoreService) {
    final controller = TextEditingController(text: room.pricePerNight.toInt().toString());

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Peak Season Rate Override', style: GoogleFonts.cinzel(fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Adjust rate for ${room.name}:', style: GoogleFonts.inter(fontSize: 12)),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                prefixText: '₱ ',
                border: OutlineInputBorder(),
                labelText: 'Price per night',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final newPrice = double.tryParse(controller.text);
              if (newPrice != null) {
                firestoreService.updateRoomStatus(room.id, room.status, newPrice);
              }
              Navigator.pop(ctx);
            },
            child: const Text('Save Rate'),
          ),
        ],
      ),
    );
  }
}
