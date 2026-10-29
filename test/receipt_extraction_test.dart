import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/receipt_extraction.dart';

/// A realistic GCash "Express Send" receipt, as a text recognizer returns it:
/// one block per line, in the order the screen prints them.
const gcashExpressSend = '''
GCash
Express Send
You sent
PHP 1,020.00
Total Amount Sent
PHP 1,020.00
Ref No. 7044 357 122304
Aug 26, 2026 10:23 AM
Sent to
MARIA SANTOS
Sender
JUAN DELA CRUZ
''';

/// A two-column GCash receipt: the reference wraps onto the next row and the
/// date column interleaves with it. This is the shape that defeats a naive
/// `\d{10,13}` regex, and the reason the grouped walk exists.
const twoColumnReference = '''
GCash Transaction Receipt
Ref No. 7044 357    Aug 26, 2026 10:23
122304 AM
Amount: PHP 4,500.00
''';

void main() {
  group('extractReferenceNumber', () {
    test('reads a 13-digit GCash reference printed with spacing', () {
      expect(extractReferenceNumber(gcashExpressSend), '7044357122304');
    });

    test('stitches a reference split across the rows of a two-column receipt',
        () {
      expect(extractReferenceNumber(twoColumnReference), '7044357122304');
    });

    test('never reads a 16-digit card number as a reference', () {
      const text = 'Card 1234 5678 9012 3456\nRef No. 7044 357 122304\n'
          'Amount 1,020.00';
      expect(extractReferenceNumber(text), '7044357122304');
    });

    test('refuses a card number when it is the only long digit run', () {
      expect(extractReferenceNumber('Card 1234 5678 9012 3456'), '');
    });

    test('returns empty rather than guessing when nothing looks like a reference',
        () {
      expect(extractReferenceNumber('GCash\nSent successfully\nTotal 1,020.00'),
          '');
      expect(extractReferenceNumber(''), '');
    });

    test('reads a labelled alphanumeric bank reference', () {
      expect(
        extractReferenceNumber('BDO InstaPay\nReference No: BDO-99887766\n'
            'Amount 12,000.00'),
        'BDO-99887766',
      );
    });
  });

  group('extractReceiptAmounts', () {
    test('keeps both figures when the receipt prints two', () {
      const text = 'Amount\nPHP 2,500.00\nTotal Amount Sent\nPHP 1,020.00';
      expect(extractReceiptAmounts(text), const [
        ReceiptAmount('Total Amount Sent', '1020.00'),
        ReceiptAmount('Amount', '2500.00'),
      ]);
    });

    test('one figure under two labels is one amount, under the specific label',
        () {
      const text = 'Amount 1,020.00\nTotal Amount Sent 1,020.00';
      expect(extractReceiptAmounts(text), const [
        ReceiptAmount('Total Amount Sent', '1020.00'),
      ]);
    });

    test('a bare peso sign is enough for a figure on its own line', () {
      expect(
        extractReceiptAmounts('Money Sent\n₱5,000.00\nTo\nMARIA SANTOS'),
        const [ReceiptAmount('Amount', '5000.00')],
      );
    });

    test('the reference digits are never read as money', () {
      expect(
        extractReceiptAmounts('GCash\nRef No. 7044357122304\nSent successfully'),
        isEmpty,
      );
    });

    test('a figure after a different label still counts', () {
      expect(
        extractReceiptAmounts('Ref No. 7044357122304\nAmount: 1,500.00'),
        const [ReceiptAmount('Amount', '1500.00')],
      );
    });
  });

  group('extractPaymentDate', () {
    test('reads a month-name date without calling it ambiguous', () {
      final date = extractPaymentDate('Aug 26, 2026 10:23 AM');
      expect(date, isNotNull);
      expect(date!.iso, '2026-08-26');
      expect(date.ambiguous, isFalse);
    });

    test('reads a day-first slash date', () {
      final date = extractPaymentDate('26/08/2026 10:23');
      expect(date!.iso, '2026-08-26');
      expect(date.ambiguous, isFalse);
    });

    test('flags a slash date that could be either order', () {
      final date = extractPaymentDate('08/05/2026');
      expect(date, isNotNull);
      expect(date!.iso, '2026-05-08'); // day-first reading
      expect(date.ambiguous, isTrue);
    });

    test('refuses an impossible calendar date', () {
      expect(extractPaymentDate('31/02/2026'), isNull);
    });

    test('reads the printed time', () {
      expect(extractPaymentTime('Aug 26, 2026 10:23 AM'), '10:23 AM');
      expect(extractPaymentTime('Aug 26, 2026 7:05 PM'), '07:05 PM');
      expect(extractPaymentTime('no time here'), '');
    });
  });

  group('extractSenderName / extractRecipientName', () {
    test('reads the sender a GCash receipt names', () {
      expect(extractSenderName(gcashExpressSend), 'JUAN DELA CRUZ');
    });

    test('reads the recipient a GCash receipt names', () {
      expect(extractRecipientName(gcashExpressSend), 'MARIA SANTOS');
    });

    test('a phone number alone is not a name', () {
      expect(extractSenderName('+63 930 485 7798\nSent via GCash'), '');
    });

    test('no label means no name rather than a guess', () {
      expect(extractSenderName('JUAN DELA CRUZ\nAmount 1,020.00'), '');
      expect(extractRecipientName('Amount 1,020.00'), '');
    });
  });

  group('normalization', () {
    test('references are upper-cased and stripped to the allowed alphabet', () {
      expect(normalizeReference(' gcash-123456 '), 'GCASH-123456');
      expect(normalizeReference('ref#12 34'), 'REF1234');
      expect(isValidReference('GCASH-123456'), isTrue);
      expect(isValidReference('abc'), isFalse);
    });

    test('amounts are two decimals, and absurd values are refused', () {
      expect(normalizeReceiptAmount('1,020'), '1020.00');
      expect(normalizeReceiptAmount('0'), isNull);
      expect(normalizeReceiptAmount('9999999'), isNull);
      expect(normalizeReceiptAmount('12.345'), isNull);
    });

    test('dates must be real calendar dates', () {
      expect(normalizeIsoDate('2026-08-26'), '2026-08-26');
      expect(normalizeIsoDate('2026-02-31'), isNull);
      expect(normalizeIsoDate('26/08/2026'), isNull);
      expect(normalizeIsoDate(''), isNull);
    });
  });

  group('parseReceiptText', () {
    test('a readable GCash receipt yields high confidence and every field', () {
      final extraction = parseReceiptText(gcashExpressSend);
      expect(extraction.reference, '7044357122304');
      expect(extraction.amount, '1020.00');
      expect(extraction.senderName, 'JUAN DELA CRUZ');
      expect(extraction.recipientName, 'MARIA SANTOS');
      expect(extraction.paymentDateIso, '2026-08-26');
      expect(extraction.confidence, ReceiptConfidence.high);
      expect(extraction.notes, isEmpty);
    });

    test('an unreadable receipt produces warnings, never invented values', () {
      final extraction = parseReceiptText('   ');
      expect(extraction.reference, '');
      expect(extraction.amount, '');
      expect(extraction.confidence, ReceiptConfidence.none);
      expect(extraction.notes, isNotEmpty);
    });

    test('a receipt with no reference warns instead of fabricating one', () {
      final extraction =
          parseReceiptText('GCash\nAmount 1,020.00\nSent successfully');
      expect(extraction.reference, '');
      expect(extraction.amount, '1020.00');
      expect(extraction.confidence, ReceiptConfidence.low);
      expect(
        extraction.notes.any((n) => n.toLowerCase().contains('no reference')),
        isTrue,
      );
    });

    test('two disagreeing amounts are both surfaced and flagged', () {
      final extraction = parseReceiptText(
        'Amount 2,500.00\nTotal Amount Sent 1,020.00\nRef No. 7044357122304',
      );
      expect(extraction.amounts.length, 2);
      expect(extraction.notes.any((n) => n.contains('2 different amounts')),
          isTrue);
    });

    test('a known expected amount picks the matching figure', () {
      final extraction = parseReceiptText(
        'Amount 2,500.00\nTotal Amount Sent 1,020.00\nRef No. 7044357122304',
        expectedAmount: 1020,
      );
      expect(extraction.amount, '1020.00');
    });

    test('takes the amount label printed on the row above the figure', () {
      // GCash prints `Total Amount Sent` on one row and `₱1,020.00` on the next.
      final extraction = parseReceiptText(
        'Amount\nPHP 2,500.00\nTotal Amount Sent\nPHP 1,020.00\n'
        'Ref No. 7044357122304',
      );
      expect(extraction.amounts, const [
        ReceiptAmount('Total Amount Sent', '1020.00'),
        ReceiptAmount('Amount', '2500.00'),
      ]);
    });

    test('a full GCash Send Money receipt reads end to end', () {
      final extraction = parseReceiptText('''
GCash
Ref No. 1029 384 756123
Sep 02, 2026 08:41 AM
Amount
PHP 4,500.00
Send Money
To
AGUEDA HERNANDEZ
From
ANA CRUZ
''');
      expect(extraction.reference, '1029384756123');
      expect(extraction.amount, '4500.00');
      expect(extraction.paymentDateIso, '2026-09-02');
      expect(extraction.paymentTime, '08:41 AM');
      expect(extraction.senderName, 'ANA CRUZ');
      expect(extraction.recipientName, 'AGUEDA HERNANDEZ');
      expect(extraction.confidence, ReceiptConfidence.high);
    });

    test('a Maya receipt with a labelled transaction id and a slash date', () {
      final extraction = parseReceiptText(
        'Maya\nTransaction ID: 123456789012\nAmount: 8,500.00\n'
        'Date: 09/05/2026',
      );
      expect(extraction.reference, '123456789012');
      expect(extraction.amount, '8500.00');
      // Day-first, and ambiguous as printed — which the notes say out loud.
      expect(extraction.paymentDateIso, '2026-05-09');
      expect(extraction.notes.any((n) => n.contains('could be more than one')),
          isTrue);
    });

    test('an invalid reference-like run is discarded with a note', () {
      final extraction = parseReceiptText('Ref No. 12\nAmount 1,020.00');
      expect(extraction.reference, '');
      expect(extraction.notes, isNotEmpty);
    });
  });

  group('ReceiptExtraction.mergedWith', () {
    test('the first extraction wins and the second fills the gaps', () {
      const stored = ReceiptExtraction(
        reference: '7044357122304',
        amount: '1020.00',
        confidence: ReceiptConfidence.high,
      );
      const fresh = ReceiptExtraction(
        reference: '9999999999',
        amount: '2500.00',
        senderName: 'JUAN DELA CRUZ',
        recipientName: 'MARIA SANTOS',
        paymentDateIso: '2026-08-26',
        confidence: ReceiptConfidence.high,
      );
      final merged = stored.mergedWith(fresh);
      expect(merged.reference, '7044357122304');
      expect(merged.amount, '1020.00');
      expect(merged.senderName, 'JUAN DELA CRUZ');
      expect(merged.recipientName, 'MARIA SANTOS');
      expect(merged.paymentDateIso, '2026-08-26');
    });

    test('confidence is recomputed from what actually survived', () {
      const referenceOnly = ReceiptExtraction(reference: '7044357122304');
      const nothing = ReceiptExtraction();
      expect(referenceOnly.mergedWith(nothing).confidence, ReceiptConfidence.low);
      expect(nothing.mergedWith(nothing).confidence, ReceiptConfidence.none);
    });
  });
}
