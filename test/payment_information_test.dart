import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/firestore_service.dart';

Map<String, dynamic> channel({
  String method = 'GCash',
  String recipient = 'Agueda H.',
  String account = '09258507707',
}) =>
    {'method': method, 'recipient_name': recipient, 'account_identifier': account};

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