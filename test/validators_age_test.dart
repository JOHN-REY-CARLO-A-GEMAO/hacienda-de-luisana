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
}
