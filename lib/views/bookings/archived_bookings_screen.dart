import 'package:flutter/material.dart';

import 'bookings_screen.dart';

/// Read-only archive of ended stays and ended requests, opened from the
/// Bookings app bar (archive icon).
///
/// Reuses [BookingsScreen] in `archiveMode`, so the cards, search, filter
/// chips and pagination are identical to the live queue — only the filter
/// strip changes to the archive buckets:
///
///  - Completed bookings      (`Completed`)
///  - Cancelled bookings      (`Cancelled`)
///  - Expired reservations    (`Expired`, incl. Pending holds that lapsed)
///  - Rejected booking requests (`Rejected`)
///  - No-show reservations    (derived: dates committed but the check-in day
///    passed with no check-in — the lifecycle stores no "No-show" status)
///
/// Nothing here is deleted or hidden from the live queue; archiving is a
/// view, not a data move (docs/MESSAGING.md §4: bookings and money movements
/// are never auto-purged).
class ArchivedBookingsScreen extends StatelessWidget {
  const ArchivedBookingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const BookingsScreen(tourAnchors: false, archiveMode: true);
  }
}
