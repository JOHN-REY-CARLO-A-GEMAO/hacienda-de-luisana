import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/guest_crm_model.dart';
import '../../providers/app_providers.dart';
import '../../services/booking_lifecycle.dart';
import '../bookings/booking_detail_screen.dart';

class GuestCrmDetailDialog extends ConsumerStatefulWidget {
  final GuestCrmModel guest;

  const GuestCrmDetailDialog({
    super.key,
    required this.guest,
  });

  @override
  ConsumerState<GuestCrmDetailDialog> createState() =>
      _GuestCrmDetailDialogState();
}

class _GuestCrmDetailDialogState extends ConsumerState<GuestCrmDetailDialog> {
  late TextEditingController _notesController;
  late bool _isVip;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _notesController = TextEditingController(text: widget.guest.notes);
    _isVip = widget.guest.isVip;
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _saveNotes() async {
    setState(() => _busy = true);
    final service = ref.read(firestoreServiceProvider);

    final patch = {
      'notes': _notesController.text.trim(),
      'isVip': _isVip,
      'updatedAt': FieldValue.serverTimestamp(),
    };

    if (service.isCloud) {
      try {
        await FirebaseFirestore.instance
            .collection(AppConstants.colGuestProfiles)
            .doc(widget.guest.id)
            .set(patch, SetOptions(merge: true));
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error saving profile: $e')));
        }
        setState(() => _busy = false);
        return;
      }
    }

    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Internal guest notes saved.')),
    );
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);
    final currencyFmt = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 0);

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 550, maxHeight: 650),
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: _isVip ? AppColors.accentGoldLight : AppColors.primaryForest.withValues(alpha: 0.1),
                  child: Icon(
                    _isVip ? Icons.star_rounded : Icons.person_outline,
                    color: _isVip ? AppColors.accentGoldDark : AppColors.primaryForest,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.guest.name,
                        style: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      Text(
                        '${widget.guest.phone} · ${widget.guest.email}',
                        style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const Divider(height: 20),

            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // VIP Toggle & Stats
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('VIP Guest Status:', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
                        Switch(
                          value: _isVip,
                          activeColor: AppColors.accentGoldDark,
                          onChanged: (v) => setState(() => _isVip = v),
                        ),
                      ],
                    ),

                    bookingsAsync.when(
                      data: (allBookings) {
                        final guestBookings = allBookings.where((b) {
                          return b.guestEmail.toLowerCase() == widget.guest.email.toLowerCase() ||
                              (b.uid != null && b.uid == widget.guest.id) ||
                              b.guestName.toLowerCase() == widget.guest.name.toLowerCase();
                        }).toList();

                        double lifetimeVal = 0.0;
                        double outstanding = 0.0;
                        int completedCount = 0;

                        for (final b in guestBookings) {
                          if (b.rawStatus == BookingStatuses.completed ||
                              b.rawStatus == BookingStatuses.reserved ||
                              b.rawStatus == BookingStatuses.checkedIn ||
                              b.rawStatus == BookingStatuses.staying) {
                            lifetimeVal += b.totalAmount;
                            final verified = b.amountVerified ?? b.amountClaimed ?? 0.0;
                            outstanding += (b.totalAmount - verified).clamp(0.0, double.infinity);
                          }
                          if (b.rawStatus == BookingStatuses.completed) {
                            completedCount++;
                          }
                        }

                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: AppColors.surfaceLight,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceAround,
                                children: [
                                  _statCol('TOTAL STAYS', '${guestBookings.length}'),
                                  _statCol('COMPLETED', '$completedCount'),
                                  _statCol('LIFETIME VALUE', currencyFmt.format(lifetimeVal)),
                                  _statCol('OUTSTANDING', currencyFmt.format(outstanding), isWarning: outstanding > 0),
                                ],
                              ),
                            ),
                            const SizedBox(height: 16),

                            Text('Booking History:', style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 8),

                            if (guestBookings.isEmpty)
                              Text('No matching bookings recorded yet.', style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted))
                            else
                              ListView.separated(
                                shrinkWrap: true,
                                physics: const NeverScrollableScrollPhysics(),
                                itemCount: guestBookings.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 8),
                                itemBuilder: (context, i) {
                                  final b = guestBookings[i];
                                  return InkWell(
                                    onTap: () {
                                      Navigator.pop(context);
                                      Navigator.of(context).push(
                                        MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: b.id)),
                                      );
                                    },
                                    child: Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        borderRadius: BorderRadius.circular(8),
                                        border: Border.all(color: AppColors.cardBorder),
                                      ),
                                      child: Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                '${b.accommodation} · ${DateFormatter.formatStayRange(b.checkInDate, b.checkOutDate)}',
                                                style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600),
                                              ),
                                              Text('Ref: ${b.refId ?? b.id} · Status: ${b.rawStatus}', style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
                                            ],
                                          ),
                                          Text('₱${b.totalAmount.toStringAsFixed(0)}', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
                                        ],
                                      ),
                                    ),
                                  );
                                },
                              ),
                          ],
                        );
                      },
                      loading: () => const CircularProgressIndicator(),
                      error: (e, _) => Text('Error loading bookings: $e'),
                    ),

                    const SizedBox(height: 16),
                    Text('Internal Admin Notes (Private to Admin):', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _notesController,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        hintText: 'Add internal notes about guest preferences, behavior, or special instructions…',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _busy ? null : _saveNotes,
                icon: const Icon(Icons.save, size: 18),
                label: Text(_busy ? 'Saving…' : 'Save Internal Profile Notes'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primaryForest,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statCol(String title, String val, {bool isWarning = false}) {
    return Column(
      children: [
        Text(title, style: GoogleFonts.inter(fontSize: 8, color: AppColors.textMuted)),
        Text(
          val,
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: isWarning ? AppColors.statusAlert : AppColors.textDark,
          ),
        ),
      ],
    );
  }
}
