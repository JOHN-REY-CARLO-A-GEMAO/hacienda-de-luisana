import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/firestore_service.dart';

Map<String, dynamic> channel({
  String method = 'GCash',
  String recipient = 'Agueda H.',
  String account = '09258507707',
  String? qr,
}) =>
    {
      'method': method,
      'recipient_name': recipient,
      if (account.isNotEmpty) 'account_identifier': account,
      if (qr != null) 'qr_image': qr,
    };

Map<String, dynamic> listShape(List<Map<String, dynamic>> methods) => {
      'active': true,
      'methods': methods,
      'instructions': 'Send the down payment through one listed channel.',
    };

Map<String, dynamic> flatShape() => {
      'active': true,
      'method': 'GCash',
      'recipient_name': 'Agueda H.',
      'account_identifier': '09258507707',
      'instructions': 'Send the down payment through one listed channel.',
    };

void main() {
  group('payment information the Admin app publishes', () {
    test('a `methods` list is accepted — this is the shape the screen sends', () {
      // The Admin screen builds `methods`, so a validator that only reads the
      // singular fields refused every publish with "method is required".
      expect(validatePaymentInformationDocument(listShape([channel()])), isNull);
    });

    test('two channels are accepted', () {
      expect(
        validatePaymentInformationDocument(
            listShape([channel(), channel(method: 'BDO', account: '005438013682')])),
        isNull,
      );
    });

    test('five channels are accepted, the most the rules allow', () {
      expect(validatePaymentInformationDocument(listShape(List.generate(5, (_) => channel()))),
          isNull);
    });

    test('the singular shape of an older document is still accepted', () {
      expect(validatePaymentInformationDocument(flatShape()), isNull);
    });

    test('an empty channel is refused, and the message names it', () {
      final problem = validatePaymentInformationDocument(
          listShape([channel(), channel(method: '', account: '005438013682')]));
      expect(problem, contains('methods[1].method'));
    });

    test('a blank recipient inside a list entry is refused', () {
      final problem =
          validatePaymentInformationDocument(listShape([channel(recipient: '   ')]));
      expect(problem, contains('methods[0].recipient_name'));
    });

    test('a channel with no account identifier is refused', () {
      final problem = validatePaymentInformationDocument(listShape([channel(account: '')]));
      expect(problem, contains('methods[0].account_identifier'));
    });

    test('a GCash channel that publishes only the official QR code is accepted', () {
      // The owner replaced the mobile number with their own QR code, so the
      // screen sends `qr_image` and no `account_identifier`.
      expect(
        validatePaymentInformationDocument(listShape([
          channel(account: '', qr: '/images/payment/gcash-qr.png'),
        ])),
        isNull,
      );
    });

    test('a QR code source must be a site path or an https URL', () {
      for (final bad in ['javascript:alert(1)', 'data:image/png;base64,AA', '//evil.example/qr.png']) {
        final problem = validatePaymentInformationDocument(
            listShape([channel(account: '', qr: bad)]));
        expect(problem, contains('methods[0].qr_image'), reason: bad);
      }
      expect(
        validatePaymentInformationDocument(
            listShape([channel(account: '', qr: 'https://example.com/owner-qr.png')])),
        isNull,
      );
    });

    test('an over-long QR code path is refused', () {
      final problem = validatePaymentInformationDocument(
          listShape([channel(account: '', qr: '/images/${'x' * 500}.png')]));
      expect(problem, contains('methods[0].qr_image'));
    });

    test('more than five channels is refused', () {
      final problem = validatePaymentInformationDocument(
          listShape(List.generate(6, (_) => channel())));
      expect(problem, contains('between 1 and 5'));
    });

    test('an empty list is refused', () {
      expect(validatePaymentInformationDocument(listShape([])), contains('between 1 and 5'));
    });

    test('a method longer than 80 characters is refused', () {
      final problem =
          validatePaymentInformationDocument(listShape([channel(method: 'x' * 81)]));
      expect(problem, contains('80 characters'));
    });

    test('missing instructions are refused', () {
      final doc = listShape([channel()])..remove('instructions');
      expect(validatePaymentInformationDocument(doc), contains('instructions'));
    });

    test('active must be a boolean', () {
      final doc = listShape([channel()]);
      doc['active'] = 'yes';
      expect(validatePaymentInformationDocument(doc), contains('Active'));
    });

    test('optional notes may be absent, and are length-checked when present', () {
      final doc = listShape([channel()]);
      expect(validatePaymentInformationDocument(doc), isNull);

      doc['notes'] = 'y' * 1001;
      expect(validatePaymentInformationDocument(doc), contains('notes'));
    });
  });
}