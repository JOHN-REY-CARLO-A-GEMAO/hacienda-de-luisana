import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/utils/validators.dart';

void main() {
  test('age is calendar-based and min age is 10', () {
    final today = DateTime(2026, 9, 24);
    expect(Validators.ageOn(DateTime(2016, 9, 24), today), 10);
    expect(Validators.ageOn(DateTime(2016, 9, 25), today), 9);
    expect(Validators.birthdate(DateTime(2016, 9, 25), today), isNotNull);
    expect(Validators.birthdate(DateTime(2016, 9, 24), today), isNull);
    expect(Validators.birthdate(DateTime(2099, 1, 1), today), contains('future'));
  });

  test('amount validator checks valid peso figures and bounds', () {
    expect(Validators.amount('1500.00'), isNull);
    expect(Validators.amount('1,500.50'), isNull);
    expect(Validators.amount(''), isNotNull);
    expect(Validators.amount('abc'), isNotNull);
    expect(Validators.amount('-10'), isNotNull);
  });

  test('reference validator checks alphanumeric formats', () {
    expect(Validators.reference('GCASH-100234'), isNull);
    expect(Validators.reference('1234567890123'), isNull);
    expect(Validators.reference(''), isNotNull);
    expect(Validators.reference('INVALID REF # WITH SPACES'), isNotNull);
  });

  test('pin validator requires 6 digits', () {
    expect(Validators.pin('123456'), isNull);
    expect(Validators.pin('12345'), isNotNull);
    expect(Validators.pin('abcdef'), isNotNull);
  });

  test('rejectionReason requires non-empty min length text', () {
    expect(Validators.rejectionReason('Invalid payment proof uploaded'), isNull);
    expect(Validators.rejectionReason(''), isNotNull);
    expect(Validators.rejectionReason('no'), isNotNull);
  });
}
