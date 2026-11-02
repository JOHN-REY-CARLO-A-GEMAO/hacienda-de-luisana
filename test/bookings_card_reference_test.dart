import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/booking_model.dart';
import 'package:hacienda_de_luisana/views/bookings/bookings_screen.dart';

/// The reference line on a Booking card.
///
/// The card used to print "No reference on file" whenever a Booking carried no
/// `ref_id`, which reads as a fault in the app on the many Bookings that simply
/// have no `HDL-…` id while still having a payment reference a payment was
/// verified against. These pin the fallback order instead.
void main() {
  BookingModel booking({
    String? refId,
    String? paymentReference,
    String? ocrReference,
    String id = 'AbCdEf123456',
  }) =>
      BookingModel.fromJson({
        'guest_name': 'Ana Cruz',
        'phone': '09171234567',
        'email': 'ana@example.com',
        'check_in': '2026-09-01',
        'check_out': '2026-09-02',
        'guests': 2,
        'accommodation': 'main-house',
        'status': 'Approved',
        'created_at': '2026-08-01T09:00:00Z',
        if (refId != null) 'ref_id': refId,
        if (paymentReference != null) 'payment_reference': paymentReference,
        if (ocrReference != null) 'ocr_reference': ocrReference,
      }, id);

  group('bookingCardReference', () {
    test("shows the Guest's HDL id when the Booking has one", () {
      expect(bookingCardReference(booking(refId: 'HDL-2026-0001')), 'HDL-2026-0001');
    });

    test("falls back to the payment reference, never to 'No reference on file'", () {
      expect(
        bookingCardReference(booking(paymentReference: '8159662488150')),
        'Ref #8159662488150',
      );
    });

    test('falls back to the machine read when nothing else names the payment', () {
      expect(
        bookingCardReference(booking(ocrReference: '7044357122304')),
        'Ref #7044357122304',
      );
    });

    test('falls back to a short fragment of the document id as the last resort', () {
      expect(bookingCardReference(booking()), '#ABCDEF');
    });

    test('a short document id is not truncated past its end', () {
      expect(bookingCardReference(booking(id: 'AB1')), '#AB1');
    });

    test("the HDL id wins over a payment reference that disagrees with it", () {
      expect(
        bookingCardReference(booking(
          refId: 'HDL-2026-0001',
          paymentReference: '8159662488150',
        )),
        'HDL-2026-0001',
      );
    });
  });
}
