// The rates document the Admin publishes must pass the same checks the
// website applies when it reads `site_config/rates` back.
//
// Run: flutter test test/published_rates_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

Map<String, dynamic> good() => {
      'version': 'v2',
      'effective_date': '2026-09-24',
      'accommodations': {
        'main-house': {'nightly_rate': 6000, 'security_deposit': 2000, 'down_payment_percent': 50},
        'house-a-camping': {'nightly_rate': 1200, 'security_deposit': 0},
      },
      'refund': {
        'refund_percent': 50,
        'deposit_refund_percent': 100,
        'tiers': [
          {'min_days_before_check_in': 7, 'refund_percent': 50},
        ],
      },
    };

List<String> paths(List<RatesProblem> problems) => problems.map((p) => p.path).toList();

void main() {
  test('a complete document has no problems', () {
    expect(validatePublishedRates(good(), kKnownAccommodationIds), isEmpty);
  });

  test('version and effective date are required', () {
    final doc = good()
      ..['version'] = ' '
      ..['effective_date'] = '2026-02-30';
    expect(paths(validatePublishedRates(doc)), containsAll(['version', 'effective_date']));
  });

  test('figures must be sane numbers', () {
    final doc = good();
    (doc['accommodations'] as Map)['main-house'] = {
      'nightly_rate': 0,
      'security_deposit': -1,
      'down_payment_percent': 100,
    };
    expect(
      paths(validatePublishedRates(doc)),
      containsAll([
        'accommodations.main-house.nightly_rate',
        'accommodations.main-house.security_deposit',
        'accommodations.main-house.down_payment_percent',
      ]),
    );
  });

  test('unknown Accommodation ids are flagged', () {
    final doc = good();
    (doc['accommodations'] as Map)['pool-villa'] = {'nightly_rate': 1, 'security_deposit': 0};
    expect(paths(validatePublishedRates(doc, kKnownAccommodationIds)), contains('accommodations.pool-villa'));
    expect(validatePublishedRates(doc), isEmpty, reason: 'without a known list any id passes');
  });

  test('refund percentages stay within 0–100 and tiers are well-formed', () {
    final doc = good();
    doc['refund'] = {
      'refund_percent': 120,
      'tiers': [
        {'min_days_before_check_in': -1, 'refund_percent': 'half'},
      ],
    };
    expect(
      paths(validatePublishedRates(doc)),
      containsAll([
        'refund.refund_percent',
        'refund.tiers.0.min_days_before_check_in',
        'refund.tiers.0.refund_percent',
      ]),
    );
  });

  test('a non-object is refused outright', () {
    expect(validatePublishedRates('rates').single.message, contains('object'));
  });

  test('ratesForAccommodation reads the card and policy back', () {
    final r = ratesForAccommodation(good(), 'main-house')!;
    expect(r.rateCard.nightlyRate, 6000);
    expect(r.rateCard.securityDeposit, 2000);
    expect(r.rateCard.downPaymentPercent, 50);
    expect(r.policy.refundPercent, 50);
    expect(r.policy.tiers.single.minDaysBeforeCheckIn, 7);
    expect(ratesForAccommodation(good(), 'nowhere'), isNull);
    expect(ratesForAccommodation(null, 'main-house'), isNull);
  });
}
