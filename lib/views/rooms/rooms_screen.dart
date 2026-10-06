import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';
import '../../models/room_model.dart';
import '../../providers/app_providers.dart';
import '../../services/accommodations.dart';
import '../../services/firestore_service.dart';
import '../security/secure_action_sheet.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';

/// Operational status for each Accommodation.
///
/// The Accommodations listed here are the canonical ones, read from the
/// published rates document — the same document the website quotes from. This
/// screen used to list a separate `rooms` catalogue of four invented rooms
/// ("Villa LuisAna (Main Heritage House)", "Casita Del Rio (Garden Suite)",
/// "House A Glamping & Camping Camp", "Poolside Casita B") with capacities and
/// per-night prices that existed nowhere else, and offered an "Edit Rate"
/// control that changed nothing: no booking, no website page and no availability
/// check ever read `rooms.pricePerNight`.
///
/// What is left is the part that is real — whether a Accommodation is available,
/// occupied or under maintenance right now. There is no rate control here,
/// because rates are published on the Rates screen and read by the booking
/// system.
class RoomsScreen extends ConsumerWidget {
  const RoomsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accommodations = ref.watch(accommodationsProvider);
    final roomsAsync = ref.watch(roomsStreamProvider);
    final firestoreService = ref.read(firestoreServiceProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Accommodation Status',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: accommodations.isEmpty
          ? const EmptyState(
              icon: Icons.hotel_outlined,
              title: 'No rates published',
              subtitle:
                  'Accommodations appear here once you publish rates. This screen lists the same ones guests book, so it never has its own list.',
            )
          : roomsAsync.when(
              data: (rooms) {
                if (rooms.isEmpty) {
                  return const EmptyState(
                    icon: Icons.hotel_outlined,
                    title: 'No status recorded',
                    subtitle:
                        'Nothing has been marked available or occupied yet. Use the control on an Accommodation to record its status.',
                  );
                }

                // One card per canonical Accommodation, in published order. A
                // status document naming an Accommodation that is no longer
                // published is not shown, and an Accommodation with no status
                // document is shown as needing one — which is the honest state,
                // rather than a status inherited from a room that was renamed.
                final statusById = <String, RoomStatus>{
                  for (final room in rooms)
                    if (room.accommodationId != null)
                      room.accommodationId!: room.status,
                };

                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: accommodations.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, i) {
                    final accommodation = accommodations[i];
                    return _buildAccommodationCard(
                      context,
                      accommodation,
                      statusById[accommodation.id],
                      rooms
                          .where((room) => room.accommodationId == accommodation.id)
                          .firstOrNull,
                      firestoreService,
                    );
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(
                  child: Text(
                      'Could not load rooms: ${err.toString().split('\n').first}')),
            ),
    );
  }

  Widget _buildAccommodationCard(
    BuildContext context,
    Accommodation accommodation,
    RoomStatus? status,
    RoomModel? record,
    FirestoreService firestoreService,
  ) {
    // With no status document the Accommodation reads as under maintenance:
    // it is the state that refuses rather than the state that sells.
    final current = status ?? RoomStatus.maintenance;
    final statusColor = switch (current) {
      RoomStatus.available => AppColors.statusSuccess,
      RoomStatus.occupied => AppColors.statusAlert,
      RoomStatus.maintenance => Colors.amber.shade800,
    };

    // Occupancy and money belong to the published rates document, so they are
    // shown from there. Nothing here computes or defaults a figure.
    final occupancy = accommodation.maxGuests != null
        ? 'Up to ${accommodation.maxGuests} guests per unit'
        : '${accommodation.includedGuests} guests included';
    final units = accommodation.availableUnits > 1
        ? '${accommodation.availableUnits} units · ${accommodation.unitsPerBooking} unit per booking'
        : '1 unit';

    return HaciendaCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                        accommodation.name,
                        style: GoogleFonts.cinzel(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textDark,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    StatusPill(
                      label: current.displayName,
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
                    Text(occupancy,
                        style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted)),
                    const SizedBox(width: 14),
                    const Icon(Icons.meeting_room_outlined, size: 14, color: AppColors.textMuted),
                    const SizedBox(width: 4),
                    Text(units,
                        style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted)),
                  ],
                ),
                const SizedBox(height: 8),
                // Which document these figures came from, so nobody reads them
                // as something typed on this screen.
                Text(
                  'Accommodation, occupancy and rates are published on the Rates screen.',
                  style: GoogleFonts.inter(
                      fontSize: 11, color: AppColors.textMuted, fontStyle: FontStyle.italic),
                ),
                const SizedBox(height: 10),
                const Divider(height: 1, color: AppColors.cardBorder),
                const SizedBox(height: 10),

                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    Text('Status Control:', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600)),
                    DropdownButton<RoomStatus>(
                      value: current,
                      underline: const SizedBox.shrink(),
                      items: RoomStatus.values.map((s) {
                        return DropdownMenuItem(
                          value: s,
                          child: Text(s.displayName, style: GoogleFonts.inter(fontSize: 12)),
                        );
                      }).toList(),
                      onChanged: (newStatus) async {
                        if (newStatus == null || newStatus == current) return;
                        // Confirm-tier in the gate (ADR-0015). The write is
                        // awaited and its failure said out loud — a silent drop
                        // used to leave the card lying.
                        final ok = await showSecureConfirm(
                          context,
                          title: 'Set ${accommodation.name} to ${newStatus.displayName}?',
                          body: 'This is the operational status the Admin sees. It does not '
                              'change any Booking or any published rate.',
                          confirm: 'Set status',
                        );
                        if (!ok || !context.mounted) return;
                        if (record == null) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                            backgroundColor: AppColors.statusAlert,
                            content: Text(
                                'No status record exists for this Accommodation yet, so there is nothing to update.'),
                            duration: Duration(seconds: 6),
                          ));
                          return;
                        }
                        final problem =
                            await firestoreService.updateRoomStatus(record.id, newStatus);
                        if (problem != null && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                            backgroundColor: AppColors.statusAlert,
                            content: Text(problem),
                            duration: const Duration(seconds: 6),
                          ));
                        }
                      },
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
}