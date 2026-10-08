import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';

class BookingInvoiceDialog extends ConsumerWidget {
  final BookingModel booking;

  const BookingInvoiceDialog({
    super.key,
    required this.booking,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final published = ref.watch(accommodationsProvider);
    final accommodationName =
        BookingModel.accommodationLabel(booking.accommodation, published);

    final stayTotal = booking.stayTotal ?? booking.totalAmount;
    final securityDeposit = booking.securityDeposit ?? 0.0;

    // Check additional charges in raw map if present
    final rawCharges = booking.raw['additional_charges'];
    final List<Map<String, dynamic>> additionalCharges = rawCharges is List
        ? rawCharges.whereType<Map<String, dynamic>>().toList()
        : [];

    final lateCheckoutFee = (booking.raw['late_checkout_fee'] is num)
        ? (booking.raw['late_checkout_fee'] as num).toDouble()
        : 0.0;

    final petFee = (booking.raw['pet_fee'] is num)
        ? (booking.raw['pet_fee'] as num).toDouble()
        : (booking.specialRequests?.toLowerCase().contains('pet') ?? false)
            ? 300.0
            : 0.0;

    double extraTotal = lateCheckoutFee + petFee;
    for (final c in additionalCharges) {
      if (c['amount'] is num) {
        extraTotal += (c['amount'] as num).toDouble();
      }
    }

    final grandTotal = stayTotal + securityDeposit + extraTotal;
    final downpayment = booking.amountDue ?? (stayTotal * 0.5);
    final amountPaid = booking.amountVerified ?? booking.amountClaimed ?? 0.0;
    final balanceDue = (grandTotal - amountPaid).clamp(0.0, double.infinity);

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 500),
        padding: const EdgeInsets.all(24),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Hacienda de LuisAna',
                        style: GoogleFonts.cinzel(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primaryForest,
                        ),
                      ),
                      Text(
                        'OFFICIAL INVOICE',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 1.1,
                          color: AppColors.accentGoldDark,
                        ),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const Divider(height: 24),

              // Booking Meta
              _metaRow('Reference Number:', booking.refId ?? booking.id.toUpperCase()),
              _metaRow('Guest Name:', booking.guestName),
              _metaRow('Contact:', '${booking.guestPhone} · ${booking.guestEmail}'),
              _metaRow('Accommodation:', accommodationName),
              _metaRow(
                'Stay Dates:',
                '${DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate)} (${DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate)})',
              ),
              _metaRow('Guest Count:', '${booking.guestCount} Guests'),

              const SizedBox(height: 16),
              Text(
                'Itemized Statement',
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 8),

              // Itemized Table
              Container(
                decoration: BoxDecoration(
                  color: AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.cardBorder),
                ),
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    _itemRow('Base Stay Rate ($accommodationName)', stayTotal),
                    if (securityDeposit > 0)
                      _itemRow('Refundable Security Deposit', securityDeposit),
                    if (petFee > 0) _itemRow('Pet Fee', petFee),
                    if (lateCheckoutFee > 0)
                      _itemRow('Late Checkout Extension Fee', lateCheckoutFee),
                    for (final item in additionalCharges)
                      _itemRow(
                        (item['description'] ?? 'Additional Charge').toString(),
                        (item['amount'] is num) ? (item['amount'] as num).toDouble() : 0.0,
                      ),
                  ],
                ),
              ),

              const SizedBox(height: 16),
              // Summary
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.accentGold.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.accentGold),
                ),
                child: Column(
                  children: [
                    _summaryRow('Grand Total:', grandTotal, isBold: true),
                    _summaryRow('Required Downpayment (50%):', downpayment),
                    _summaryRow('Amount Verified / Paid:', amountPaid, isSuccess: true),
                    const Divider(height: 12),
                    _summaryRow(
                      'Remaining Balance Due:',
                      balanceDue,
                      isBold: true,
                      isPrimary: true,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Close Invoice'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primaryForest,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _metaRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(
              label,
              style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemRow(String label, double amount) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              label,
              style: GoogleFonts.inter(fontSize: 12, color: AppColors.textDark),
            ),
          ),
          Text(
            '₱${amount.toStringAsFixed(2)}',
            style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _summaryRow(String label, double amount,
      {bool isBold = false, bool isSuccess = false, bool isPrimary = false}) {
    Color color = AppColors.textDark;
    if (isSuccess) color = AppColors.statusSuccess;
    if (isPrimary) color = AppColors.primaryForest;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.inter(
              fontSize: isBold ? 13 : 12,
              fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
              color: color,
            ),
          ),
          Text(
            '₱${amount.toStringAsFixed(2)}',
            style: GoogleFonts.inter(
              fontSize: isBold ? 13 : 12,
              fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
