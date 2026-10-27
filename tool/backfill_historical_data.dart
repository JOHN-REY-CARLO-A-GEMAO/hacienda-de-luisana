/// One-time historical backfill for the existing Bookings.
///
/// Populates `guest_profiles` (Guest Records directory) and
/// `payment_references` (Payment References screen) from the Booking history
/// already in Firestore, without inventing payments or duplicating rows.
/// Safe to re-run: guest profiles merge by normalized phone/email and payment
/// reference rows are skipped when a row for the same reference + Booking
/// already exists.
///
/// Defaults to preview mode: run
///   `dart run tool/backfill_historical_data.dart`
/// to see what would change without writing anything. Pass `--apply` to write.
///
/// This script is run against the live Firestore project by the operations
/// team; it is not part of the Admin app bundle and is not deployed here.
library backfill_historical_data;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';

import '../lib/core/constants/app_constants.dart';

/// A Guest assembled from one or more Bookings, keyed by a reliable
/// identifier (normalized phone first, then email). Name-only matches are
/// deliberately never a merge key: two different people can share a name.
class _GuestAgg {
  _GuestAgg({required this.key, this.name, this.phone, this.email});

  final String key;
  String? name;
  String? phone;
  String? email;

  int totalBookings = 0;
  DateTime? lastStayDate;
  double lifetimeRevenue = 0; // only Admin-verified payments count
}

/// Digits only, with the Philippine country code normalized to a leading 0.
/// `+63 917 892 3421` and `0917 892 3421` both become `09178923421`.
String normalizePhone(String? raw) {
  if (raw == null) return '';
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('63') && digits.length > 10) {
    return '0${digits.substring(2)}';
  }
  return digits;
}

/// Lowercased, trimmed email.
String normalizeEmail(String? raw) =>
    raw == null ? '' : raw.trim().toLowerCase();

/// Reliable merge key: normalized phone when present, otherwise normalized
/// email. A Guest with neither keeps their own profile (key includes their
/// Booking id, so name twins never merge).
String guestKey(String? phone, String? email, {String? fallback}) {
  final p = normalizePhone(phone);
  if (p.isNotEmpty) return 'phone:$p';
  final e = normalizeEmail(email);
  if (e.isNotEmpty) return 'email:$e';
  return fallback ?? 'name:unknown';
}

/// What counts as money actually paid: only the amount an Admin verified.
/// `total_price` / `stay_total` is never proof of payment on its own.
double? verifiedPayment(Map<String, dynamic> b) {
  final status = (b['payment_status'] ?? '').toString();
  if (status != 'verified') return null;
  final v = b['amount_verified'];
  if (v is num && v.isFinite && v > 0) return v.toDouble();
  return null;
}

/// Does this Booking carry enough payment evidence to file a reference row?
/// A Booking total alone is not evidence.
bool hasPaymentEvidence(Map<String, dynamic> b) {
  final ref = (b['payment_reference'] ?? '').toString().trim();
  if (ref.isNotEmpty) return true;
  final claimed = b['amount_claimed'];
  final proof = b['payment_proof_url'];
  return (claimed is num && claimed > 0) &&
      proof is String &&
      proof.trim().isNotEmpty;
}

String? _lastStayIso(Object? raw) {
  if (raw == null) return null;
  if (raw is String) return raw;
  try {
    return (raw as dynamic).toDate().toIso8601String();
  } catch (_) {
    return null;
  }
}

/// The computed plan: aggregated guests and the reference rows to file.
/// Pure over the list of Booking documents — no Firestore access.
class BackfillPlan {
  BackfillPlan({required this.guests, required this.rows});
  final Map<String, _GuestAgg> guests;
  final List<Map<String, dynamic>> rows;

  int get guestCount => guests.length;
  int get rowCount => rows.length;
}

BackfillPlan planBackfill(List<Map<String, dynamic>> bookings) {
  final guests = <String, _GuestAgg>{};
  final rows = <Map<String, dynamic>>[];

  for (final b in bookings) {
    final id = (b['id'] ?? '').toString();
    final phone = (b['phone'] ?? b['guestPhone'] ?? '').toString();
    final email = (b['email'] ?? b['guestEmail'] ?? '').toString();
    final name = (b['guest_name'] ?? b['guestName'] ?? '').toString();
    final key = guestKey(phone, email, fallback: 'name:$id');

    final agg = guests.putIfAbsent(key, () => _GuestAgg(key: key));
    if ((agg.name ?? '').isEmpty && name.isNotEmpty) agg.name = name;
    if (agg.phone == null && phone.isNotEmpty) agg.phone = phone;
    if (agg.email == null && email.isNotEmpty) agg.email = email;
    agg.totalBookings += 1;

    final iso = _lastStayIso(b['check_out'] ?? b['checkOutDate']);
    if (iso != null) {
      final parsed = DateTime.tryParse(iso);
      if (parsed != null &&
          (agg.lastStayDate == null || parsed.isAfter(agg.lastStayDate!))) {
        agg.lastStayDate = parsed;
      }
    }

    final paid = verifiedPayment(b);
    if (paid != null) agg.lifetimeRevenue += paid;

    if (hasPaymentEvidence(b)) {
      final ref = (b['payment_reference'] ?? '').toString().trim();
      // No reference number means nothing to file under a reference: the
      // proof itself stays on the Booking, and no synthetic identifier is
      // ever issued as if it were a real GCash or bank reference.
      if (ref.isNotEmpty) {
        rows.add({
          'booking_id': id,
          'reference': ref,
          'amount': (b['amount_verified'] ?? b['amount_claimed'] ?? 0)
              .toDouble(),
          'sender_name': b['payment_sender_name'] ?? b['ocr_sender_name'],
          'payment_date': b['payment_date'] ?? b['ocr_payment_date'],
          'proof_url': b['payment_proof_url'],
          // Already-verified historical payments keep their status; everything
          // else awaits Admin review — never auto-verified from OCR alone.
          'status': (b['payment_status'] == 'verified' &&
                  (b['amount_verified'] ?? 0) > 0)
              ? 'verified'
              : 'pending_review',
        });
      }
    }
  }
  return BackfillPlan(guests: guests, rows: rows);
}

Map<String, dynamic> previewBackfill(List<Map<String, dynamic>> bookings) {
  final plan = planBackfill(bookings);
  return {
    'bookings': bookings.length,
    'guestsToCreate': plan.guestCount,
    'guestKeys': plan.guests.keys.toList(),
    'paymentRows': plan.rowCount,
    'rows': plan.rows,
  };
}

void printPreview(Map<String, dynamic> preview) {
  print('=== Historical backfill preview (no writes) ===');
  print('Bookings found: ${preview['bookings']}');
  print('Guest profiles to create: ${preview['guestsToCreate']}');
  print('Payment reference rows to create: ${preview['paymentRows']}');
  print('==============================================');
}

/// Write the plan into Firestore. Idempotent and safe to repeat:
/// * guest profiles are merged (merge:true) so Admin notes and VIP flags
///   already on a profile are preserved, and figures are recomputed from
///   the bookings (same inputs -> same outputs);
/// * a reference row is only inserted when no row with the same reference
///   + booking_id exists.
Future<Map<String, int>> applyBackfill(
    FirebaseFirestore firestore, BackfillPlan plan) async {
  var guestsCreated = 0;
  var guestsRefreshed = 0;
  var rowsCreated = 0;
  var rowsSkipped = 0;

  final guestCol = firestore.collection(AppConstants.colGuestProfiles);
  for (final agg in plan.guests.values) {
    final existing = await guestCol.doc(agg.key).get();
    final computed = <String, dynamic>{
      if (agg.name != null) 'name': agg.name,
      if (agg.phone != null) 'phone': agg.phone,
      if (agg.email != null) 'email': agg.email,
      'totalBookings': agg.totalBookings,
      'lifetimeRevenue': agg.lifetimeRevenue,
      if (agg.lastStayDate != null)
        'lastStayDate': agg.lastStayDate!.toIso8601String(),
      'updated_at': FieldValue.serverTimestamp(),
    };
    if (existing.exists) {
      guestsRefreshed += 1;
      // merge:true preserves isVip and notes written by the Admin.
      await guestCol.doc(agg.key).set(computed, SetOptions(merge: true));
    } else {
      guestsCreated += 1;
      await guestCol.doc(agg.key).set({
        'id': agg.key,
        ...computed,
        'isVip': false,
        'notes': '',
        'created_at': FieldValue.serverTimestamp(),
      });
    }
  }

  final refCol = firestore.collection(AppConstants.colPaymentReferences);
  for (final row in plan.rows) {
    final snapshot = await refCol
        .where('reference', isEqualTo: row['reference'])
        .where('booking_id', isEqualTo: row['booking_id'])
        .get();
    if (snapshot.docs.isNotEmpty) {
      rowsSkipped += 1;
      continue;
    }
    rowsCreated += 1;
    await refCol.add({...row, 'created_at': FieldValue.serverTimestamp()});
  }

  return {
    'guestsCreated': guestsCreated,
    'guestsRefreshed': guestsRefreshed,
    'rowsCreated': rowsCreated,
    'rowsSkipped': rowsSkipped,
  };
}

/// Stream every Booking document (no ordering required for the backfill).
Future<List<Map<String, dynamic>>> readAllBookings(
    FirebaseFirestore firestore) async {
  final snap = await firestore.collection(AppConstants.colBookings).get();
  return snap.docs.map((d) => d.data()).toList();
}

Future<void> main(List<String> args) async {
  final apply = args.contains('--apply');
  FirebaseFirestore firestore;
  try {
    await Firebase.initializeApp();
    firestore = FirebaseFirestore.instance;
  } catch (e) {
    print('Firebase could not be initialized for this standalone script. '
        'Initialize Firebase with the project options before running, e.g. '
        'provide FirebaseOptions, then re-run.');
    rethrow;
  }

  final bookings = await readAllBookings(firestore);
  final preview = previewBackfill(bookings);
  printPreview(preview);

  if (!apply) {
    print('Preview only — no writes were made. Re-run with --apply to write.');
    return;
  }

  final plan = planBackfill(bookings);
  final result = await applyBackfill(firestore, plan);
  print('=== Backfill applied ===');
  print('Guest profiles created: ${result['guestsCreated']}');
  print('Guest profiles refreshed: ${result['guestsRefreshed']}');
  print('Payment reference rows created: ${result['rowsCreated']}');
  print('Payment reference rows skipped (already present): ${result['rowsSkipped']}');
}
