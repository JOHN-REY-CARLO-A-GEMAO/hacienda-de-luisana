import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/auth_store.dart';
import '../services/booking_store.dart';
import '../theme/app_theme.dart';
import '../utils/tracking.dart';

/// Owner tab 1: booking requests (Confirm / Cancel). Full review stays on
/// the /admin website; this is the on-the-go owner triage view.
class AdminBookingsScreen extends StatelessWidget {
  const AdminBookingsScreen({super.key});

  Future<void> _call(String phone) async {
    final uri = Uri.parse('tel:${phone.replaceAll(RegExp(r'\s+'), '')}');
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<BookingStore>();
    final auth = context.watch<AuthStore>();
    // Anak = view-only (rules exclude anak from update/delete too).
    final readOnly = !auth.isOwner;
    final items = store.bookings.toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    // Live location is a session, not a booking field (G6): index them by the
    // booking's Firestore id so each card can show "where they are" without
    // the Booking carrying it.
    final sessionByCloudId = {
      for (final s in store.sessions) s.bookingId: s,
    };

    return Scaffold(
      appBar: AppBar(title: const Text('Requests')),
      body: RefreshIndicator(
        onRefresh: () => store.syncPending(),
        child: items.isEmpty
            ? ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  const SizedBox(height: 60),
                  const Icon(Icons.inbox_outlined, size: 56, color: AppTheme.olive),
                  const SizedBox(height: 12),
                  Text('No requests yet',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.cormorantGaramond(
                          fontSize: 24, fontWeight: FontWeight.w700, color: AppTheme.forest900)),
                  const SizedBox(height: 8),
                  Text(
                    store.cloudLive
                        ? 'New /book inquiries appear here in real-time.'
                        : 'Local mode — bookings stay on this phone until cloud setup.',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(fontSize: 13, color: AppTheme.forest800.withOpacity(0.7))),
                ],
              )
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                itemBuilder: (context, i) {
                  final b = items[i];
                  final session =
                      b.firestoreId != null ? sessionByCloudId[b.firestoreId] : null;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(b.guestName,
                                    style: GoogleFonts.inter(
                                        fontSize: 16, fontWeight: FontWeight.w700, color: AppTheme.forest900)),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                    color: AppTheme.cream100, borderRadius: BorderRadius.circular(12)),
                                child: Text(b.statusLabel,
                                    style: GoogleFonts.inter(
                                        fontSize: 11, fontWeight: FontWeight.w700, color: AppTheme.forest800)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text('${b.checkInDate.month}/${b.checkInDate.day} → '
                              '${b.checkOutDate.month}/${b.checkOutDate.day} · '
                              '${b.guestCount} guests · Ref ${b.referenceId}',
                              style: GoogleFonts.inter(fontSize: 12, color: AppTheme.forest800.withOpacity(0.7))),
                          if (session != null) ...[
                            const SizedBox(height: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                  color: Colors.green.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: Colors.green.withOpacity(0.4))),
                              child: Text('📍 sharing ${Tracking.sessionAge(session)} — see Tracking tab',
                                  style: GoogleFonts.inter(fontSize: 11, color: Colors.green.shade900)),
                            ),
                          ],
                          const SizedBox(height: 12),
                          if (readOnly)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: AppTheme.cream100,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text(
                                'Owner confirmation needed — view only.',
                                style: GoogleFonts.inter(
                                    fontSize: 11,
                                    color: AppTheme.forest800
                                        .withOpacity(0.7)),
                              ),
                            )
                          else
                            Wrap(
                              spacing: 8,
                              children: [
                                if (b.status == 'pending')
                                  ElevatedButton(
                                    onPressed: () =>
                                        store.confirmBooking(
                                            b.referenceId),
                                    child: const Text('Confirm'),
                                  ),
                                if (b.status != 'cancelled' &&
                                    b.status != 'completed')
                                  OutlinedButton(
                                    onPressed: () =>
                                        store.cancelBookingRef(
                                            b.referenceId),
                                    child: const Text('Cancel'),
                                  ),
                                OutlinedButton.icon(
                                  onPressed: () => _call(b.phone),
                                  icon: const Icon(Icons.phone, size: 15),
                                  label: const Text('Call'),
                                ),
                              ],
                            ),
                          if (readOnly)
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                onPressed: () => _call(b.phone),
                                icon: const Icon(Icons.phone, size: 15),
                                label: const Text('Call'),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }
}
