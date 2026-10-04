// The rates document the Admin publishes must pass the same checks the
// website applies when it reads `site_config/rates` back.
//
// Run: flutter test test/published_rates_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/booking_lifecycle.dart';

Map<String, dynamic> schedule({
  required int included,
  required num rate,
  num? extra,
  int? cap,
}) => {
      'min_guests': 1,
      'base_max_guests': included,
      'base_rate': rate,
      if (extra != null) 'excess_per_guest': extra,
      if (cap != null) 'max_guests': cap,
    };

Map<String, dynamic> good() => {
      'version': 'guest-count-v2',
      'effective_date': '2026-10-04',
      'holiday_dates': <String>[],
      'accommodations': {
        'main-house': {
          'rate_unit': 'standard_stay',
          'security_deposit': 500,
          'down_payment_percent': 50,
          'guest_pricing': {
            'units_per_booking': 1,
            'weekday': schedule(included: 10, rate: 5000, extra: 500),
            'weekend_holiday': schedule(included: 10, rate: 6000, extra: 500),
          },
        },
        'annex': {
          'rate_unit': 'standard_stay',
          'security_deposit': 500,
          'down_payment_percent': 50,
          'guest_pricing': {
            'units_per_booking': 1,
            'weekday': schedule(included: 6, rate: 4000, extra: 500),
            'weekend_holiday': schedule(included: 6, rate: 5000, extra: 500),
          },
        },
        'house-a-camping': {
          'rate_unit': 'standard_stay',
          'security_deposit': 0,
          'down_payment_percent': 50,
          'guest_pricing': {
            'units_per_booking': 1,
            'weekday': schedule(included: 3, rate: 1000, cap: 3),
            'weekend_holiday': schedule(included: 3, rate: 1000, cap: 3),
          },
        },
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
  test('a complete configurable guest-count schedule has no problems', () {
    expect(validatePublishedRates(good(), kKnownAccommodationIds), isEmpty);
  });

  test('refund terms can be read without requiring a legacy nightly rate card', () {
    final policy = refundPolicyFromPublished(good());
    expect(policy.refundPercent, 50);
    expect(policy.depositRefundPercent, 100);
    expect(policy.tiers.single.minDaysBeforeCheckIn, 7);
    expect(policy.tiers.single.refundPercent, 50);
    expect(ratesForAccommodation(good(), 'main-house'), isNull);
  });

  test('version and effective date are required', () {
    final doc = good()
      ..['version'] = ' '
      ..['effective_date'] = '2026-02-30';
    expect(paths(validatePublishedRates(doc)), containsAll(['version', 'effective_date']));
  });

  test('holiday dates are explicit, valid, and unique', () {
    final missing = good()..remove('holiday_dates');
    expect(paths(validatePublishedRates(missing)), contains('holiday_dates'));
    final invalid = good()..['holiday_dates'] = ['2026-02-30'];
    expect(paths(validatePublishedRates(invalid)), contains('holiday_dates'));
    final duplicate = good()..['holiday_dates'] = ['2026-10-06', '2026-10-06'];
    expect(paths(validatePublishedRates(duplicate)), contains('holiday_dates'));
  });

  test('base occupancy is not a minimum, and Main/Annex have no unsupported caps', () {
    final doc = good();
    final main = (doc['accommodations'] as Map)['main-house'] as Map;
    final gp = Map<String, dynamic>.from(main['guest_pricing'] as Map);
    gp['weekday'] = {
      ...Map<String, dynamic>.from(gp['weekday'] as Map),
      'min_guests': 6,
      'max_guests': 10,
      'upper_rate': 5500,
    };
    (doc['accommodations'] as Map)['main-house'] = {...main, 'guest_pricing': gp};
    expect(
      paths(validatePublishedRates(doc)),
      containsAll([
        'accommodations.main-house.guest_pricing.weekday.min_guests',
        'accommodations.main-house.guest_pricing.weekday.max_guests',
        'accommodations.main-house.guest_pricing.weekday.upper_rate',
      ]),
    );
  });

  test('A-House remains one unit with an included and absolute maximum of three guests', () {
    final doc = good();
    final house = (doc['accommodations'] as Map)['house-a-camping'] as Map;
    final gp = Map<String, dynamic>.from(house['guest_pricing'] as Map);
    gp['weekday'] = schedule(included: 4, rate: 1000, cap: 4);
    (doc['accommodations'] as Map)['house-a-camping'] = {...house, 'guest_pricing': gp};
    expect(paths(validatePublishedRates(doc)), contains('accommodations.house-a-camping.guest_pricing'));
  });

  test('fixed reservation fees and down-payment percentages other than 50 are refused', () {
    final doc = good();
    final main = (doc['accommodations'] as Map)['main-house'] as Map;
    (doc['accommodations'] as Map)['main-house'] = {
      ...main,
      'reservation_fee_amount': 750,
      'down_payment_percent': 30,
    };
    expect(
      paths(validatePublishedRates(doc)),
      containsAll([
        'accommodations.main-house.reservation_fee_amount',
        'accommodations.main-house.down_payment_percent',
      ]),
    );
  });

  test('legacy flat nightly rate documents cannot be published as new rates', () {
    final doc = good();
    (doc['accommodations'] as Map)['main-house'] = {
      'rate_unit': 'night',
      'nightly_rate': 6000,
      'security_deposit': -1,
      'down_payment_percent': 100,
    };
    expect(
      paths(validatePublishedRates(doc)),
      containsAll([
        'accommodations.main-house.nightly_rate',
        'accommodations.main-house.rate_unit',
        'accommodations.main-house.guest_pricing',
        'accommodations.main-house.security_deposit',
        'accommodations.main-house.down_payment_percent',
      ]),
    );
  });

  test('unknown Accommodation ids are flagged when a known list is supplied', () {
    final doc = good();
    (doc['accommodations'] as Map)['pool-villa'] = {
      'rate_unit': 'standard_stay',
      'security_deposit': 0,
      'down_payment_percent': 50,
      'guest_pricing': {
        'weekday': schedule(included: 2, rate: 1000, extra: 100),
        'weekend_holiday': schedule(included: 2, rate: 1000, extra: 100),
      },
    };
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

  test('the legacy rate-card helper still reads old historical data without treating it as publishable', () {
    final legacy = {
      'version': 'legacy-v1',
      'effective_date': '2026-09-24',
      'holiday_dates': <String>[],
      'accommodations': {
        'main-house': {
          'rate_unit': 'night',
          'nightly_rate': 6000,
          'security_deposit': 2000,
          'down_payment_percent': 50,
        },
      },
      'refund': {
        'refund_percent': 50,
        'tiers': [
          {'min_days_before_check_in': 7, 'refund_percent': 50},
        ],
      },
    };
    final r = ratesForAccommodation(legacy, 'main-house')!;
    expect(r.rateCard.nightlyRate, 6000);
    expect(r.rateCard.securityDeposit, 2000);
    expect(r.rateCard.downPaymentPercent, 50);
    expect(r.policy.refundPercent, 50);
    expect(r.policy.tiers.single.minDaysBeforeCheckIn, 7);
    expect(ratesForAccommodation(good(), 'main-house'), isNull);
    expect(ratesForAccommodation(legacy, 'nowhere'), isNull);
    expect(ratesForAccommodation(null, 'main-house'), isNull);
    expect(validatePublishedRates(legacy), isNotEmpty);
  });
}
