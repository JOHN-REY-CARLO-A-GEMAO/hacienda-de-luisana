import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/booking.dart';
import '../../models/tracking_session.dart';
import '../../services/booking_store.dart';
import '../../core/theme/app_theme.dart';
import '../../utils/tracking.dart';

/// Owner tab 2: rider-style PICKUP (guest, moving) -> DROP-OFF (hotel, fixed).
/// Guest sends pickup with ONE TAP from the /book success screen.
class AdminTrackingScreen extends StatelessWidget {
  const AdminTrackingScreen({super.key});

  Future<void> _open(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _call(String phone) async {
    final uri = Uri.parse('tel:${phone.replaceAll(RegExp(r'\s+'), '')}');
    if (await canLaunchUrl(uri)) await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<BookingStore>();
    // The radar is the sessions, joined to their Bookings for the name and
    // status (G6): the session doc id is the booking's Firestore id.
    final bookingByCloudId = {
      for (final b in store.bookings)
        if (b.firestoreId != null) b.firestoreId: b,
    };
    final withPickup = <_RadarRow>[];
    for (final s in store.sessions) {
      final booking = bookingByCloudId[s.bookingId];
      if (booking == null) continue; // a stranger's session, not our booker
      withPickup.add(_RadarRow(session: s, booking: booking));
    }
    withPickup.sort(
        (a, b) => b.session.lastUpdated.compareTo(a.session.lastUpdated));
    final sessionCloudIds = store.sessions.map((s) => s.bookingId).toSet();
    final waiting = store.bookings
        .where((b) =>
            b.isActive &&
            (b.firestoreId == null || !sessionCloudIds.contains(b.firestoreId)))
        .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Pickup → Drop-off')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Fixed drop-off card
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: AppTheme.forestDeep,
              borderRadius: BorderRadius.circular(AppTheme.radiusCard),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('DROP-OFF · FIXED',
                    style: GoogleFonts.inter(
                        fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5,
                        color: AppTheme.cream50.withOpacity(0.7))),
                const SizedBox(height: 6),
                Text(Tracking.hotelName,
                    style: GoogleFonts.cormorantGaramond(
                        fontSize: 24, fontWeight: FontWeight.w700, color: AppTheme.cream50)),
                Text('${Tracking.hotelLat}, ${Tracking.hotelLng}',
                    style: GoogleFonts.inter(fontSize: 12, color: AppTheme.cream50.withOpacity(0.7))),
                const SizedBox(height: 12),
                Row(
                  children: [
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.cream50, foregroundColor: AppTheme.forest900),
                      onPressed: () => _open(Tracking.hotelMapsUrl()),
                      child: const Text('Open hotel in Maps'),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.cream50,
                          side: BorderSide(color: AppTheme.cream50.withOpacity(0.4))),
                      onPressed: () => _open(Tracking.hotelDirectionsUrl()),
                      child: const Text('Directions'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Text('Live pickups · ${withPickup.length}',
              style: GoogleFonts.inter(
                  fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppTheme.olive)),
          const SizedBox(height: 10),
          if (withPickup.isEmpty)
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                  border: Border.all(style: BorderStyle.solid, color: AppTheme.forest900.withOpacity(0.15)),
                  borderRadius: BorderRadius.circular(16)),
              child: Text(
                'No pickup shared yet. When a booker taps “Share my pickup location”, it shows here.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(fontSize: 13, color: AppTheme.forest800.withOpacity(0.7))),
            )
          else
            ...withPickup.map((row) => _TrackingCard(
                  row: row,
                  onOpen: _open,
                  onCall: () => _call(row.booking.phone),
                )),
          if (waiting.isNotEmpty) ...[
            const SizedBox(height: 20),
            Text('Waiting for pickup · ${waiting.length}',
                style: GoogleFonts.inter(
                    fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.4, color: AppTheme.olive)),
            const SizedBox(height: 10),
            ...waiting.map((b) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    title: Text(b.guestName,
                        style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w700)),
                    subtitle: Text('${b.phone} · ${b.statusLabel}',
                        style: GoogleFonts.inter(fontSize: 12)),
                    trailing: IconButton(
                      icon: const Icon(Icons.phone),
                      onPressed: () => _call(b.phone),
                    ),
                  ),
                )),
          ],
        ],
      ),
    );
  }
}

/// One radar row: a live session joined to its booking (G6).
class _RadarRow {
  final TrackingSession session;
  final Booking booking;
  const _RadarRow({required this.session, required this.booking});
}

class _TrackingCard extends StatelessWidget {
  final _RadarRow row;
  final Future<void> Function(String url) onOpen;
  final VoidCallback onCall;

  const _TrackingCard({required this.row, required this.onOpen, required this.onCall});

  @override
  Widget build(BuildContext context) {
    final booking = row.booking;
    final lat = row.session.latitude;
    final lng = row.session.longitude;
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
                  child: Text(booking.guestName,
                      style: GoogleFonts.inter(
                          fontSize: 15, fontWeight: FontWeight.w700, color: AppTheme.forest900)),
                ),
                Text(Tracking.sessionAge(row.session),
                    style: GoogleFonts.inter(fontSize: 11, color: AppTheme.forest800.withOpacity(0.6))),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _Pin(letter: 'A', color: Colors.green.shade700),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('Pickup (guest): ${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
                      style: GoogleFonts.inter(fontSize: 13)),
                ),
              ],
            ),
            const Padding(
              padding: EdgeInsets.only(left: 13),
              child: SizedBox(height: 14, child: VerticalDivider(width: 1)),
            ),
            Row(
              children: [
                _Pin(letter: 'B', color: AppTheme.forest800),
                const SizedBox(width: 8),
                const Expanded(child: Text('Drop-off: Hacienda de LuisAna')),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ElevatedButton(
                  onPressed: () => onOpen(Tracking.directionsUrl(lat, lng)),
                  child: const Text('Navigate pickup → hotel'),
                ),
                OutlinedButton(
                  onPressed: () => onOpen(Tracking.pickupMapsUrl(lat, lng)),
                  child: const Text('Guest pin only'),
                ),
                OutlinedButton.icon(
                  onPressed: onCall,
                  icon: const Icon(Icons.phone, size: 15),
                  label: const Text('Call guest'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Pin extends StatelessWidget {
  final String letter;
  final Color color;
  const _Pin({required this.letter, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 22,
      height: 22,
      alignment: Alignment.center,
      decoration: BoxDecoration(shape: BoxShape.circle, color: color),
      child: Text(letter,
          style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white)),
    );
  }
}
