import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/booking_lifecycle.dart';
import '../security/security_pin_sheet.dart';
import '../../tutorial/tutorial_keys.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/section_header.dart';

/// Rates & cancellation policy — the one document (`site_config/rates`) the
/// website quotes every Guest from. Only the Admin publishes it; the website
/// reads it. Publishing a new version changes future quotes only: a Booking
/// keeps the `policy_version` it was chosen under.
class RatesScreen extends ConsumerStatefulWidget {
  const RatesScreen({super.key});

  @override
  ConsumerState<RatesScreen> createState() => _RatesScreenState();
}

class _RatesScreenState extends ConsumerState<RatesScreen> {
  final _version = TextEditingController();
  final _effectiveDate = TextEditingController();
  final _holidayDates = TextEditingController();
  final _refundPercent = TextEditingController();
  final _depositRefundPercent = TextEditingController(text: '100');
  final Map<String, _AccommodationFields> _acc = {
    for (final id in kKnownAccommodationIds)
      id: _AccommodationFields(BookingModel.accommodationLabel(id)),
  };
  final List<_TierFields> _tiers = [];
  final _paymentMethod = TextEditingController();
  final _paymentRecipient = TextEditingController();
  final _paymentAccount = TextEditingController();
  final _paymentMethod2 = TextEditingController();
  final _paymentRecipient2 = TextEditingController();
  final _paymentAccount2 = TextEditingController();
  final _paymentInstructions = TextEditingController();
  final _paymentDepositNotes = TextEditingController();
  final _paymentNotes = TextEditingController();

  bool _seeded = false;
  bool _paymentSeeded = false;
  bool _paymentActive = true;
  bool _busy = false;
  bool _paymentBusy = false;
  bool _legacyRatesNeedReview = false;
  Map<String, dynamic>? _preservedPolicies;
  List<RatesProblem> _problems = const [];

  @override
  void dispose() {
    _version.dispose();
    _effectiveDate.dispose();
    _holidayDates.dispose();
    _refundPercent.dispose();
    _depositRefundPercent.dispose();
    for (final f in _acc.values) {
      f.dispose();
    }
    for (final t in _tiers) {
      t.dispose();
    }
    _paymentMethod.dispose();
    _paymentRecipient.dispose();
    _paymentAccount.dispose();
    _paymentMethod2.dispose();
    _paymentRecipient2.dispose();
    _paymentAccount2.dispose();
    _paymentInstructions.dispose();
    _paymentDepositNotes.dispose();
    _paymentNotes.dispose();
    super.dispose();
  }

  void _seedOfficialSchedules() {
    void official(String id, Map<String, num> weekday, Map<String, num> weekend) {
      final f = _acc[id]!;
      f.weekday.seed(weekday);
      f.weekend.seed(weekend);
    }
    official('main-house',
      {'base_max_guests': 10, 'base_rate': 5000, 'excess_per_guest': 500},
      {'base_max_guests': 10, 'base_rate': 6000, 'excess_per_guest': 500});
    official('annex',
      {'base_max_guests': 6, 'base_rate': 4000, 'excess_per_guest': 500},
      {'base_max_guests': 6, 'base_rate': 5000, 'excess_per_guest': 500});
    official('house-a-camping',
      {'base_max_guests': 3, 'base_rate': 1000, 'max_guests': 3},
      {'base_max_guests': 3, 'base_rate': 1000, 'max_guests': 3});
  }

  void _seedFrom(Map<String, dynamic>? doc) {
    if (_seeded) return;
    _seeded = true;
    _seedOfficialSchedules();
    if (doc == null) {
      final today = DateTime.now().toIso8601String().substring(0, 10);
      _version.text = 'official-v2';
      _effectiveDate.text = today;
      return;
    }
    _version.text = '${doc['version'] ?? ''}';
    _effectiveDate.text = '${doc['effective_date'] ?? ''}';
    final holidays = doc['holiday_dates'];
    if (holidays is List) _holidayDates.text = holidays.join(', ');
    final policies = doc['policies'];
    if (policies is Map) _preservedPolicies = Map<String, dynamic>.from(policies);

    final acc = doc['accommodations'];
    if (acc is Map) {
      acc.forEach((id, node) {
        final f = _acc['$id'];
        if (f == null || node is! Map) return;
        f.name.text = '${node['property_name'] ?? BookingModel.accommodationLabel('$id')}';
        f.active = node['active'] != false;
        f.deposit.text = _numText(node['security_deposit']);
        if (node['manual_review_notice'] is String) {
          f.manualReviewNotice = node['manual_review_notice'] as String;
        }
        final gp = node['guest_pricing'];
        if (gp is Map) {
          f.weekday.seed(gp['weekday']);
          f.weekend.seed(gp['weekend_holiday']);
          for (final schedule in [gp['weekday'], gp['weekend_holiday']]) {
            if (schedule is Map && (schedule.containsKey('upper_min_guests')
                || schedule.containsKey('upper_max_guests')
                || schedule.containsKey('upper_rate')
                || schedule.containsKey('excess_after')
                || schedule['min_guests'] != 1)) {
              _legacyRatesNeedReview = true;
            }
          }
        } else {
          // A flat nightly amount cannot be safely converted. Show the confirmed
          // guest schedule as an editable proposal; the old Firestore document
          // remains unchanged until the Admin explicitly publishes a new version.
          _legacyRatesNeedReview = true;
        }
        if (node.containsKey('nightly_rate') || node.containsKey('reservation_fee_amount')
            || node['down_payment_percent'] != 50) {
          _legacyRatesNeedReview = true;
        }
      });
    }
    if (_legacyRatesNeedReview) {
      _version.text = '${_version.text}-guest-v2';
    }
    final refund = doc['refund'];
    if (refund is Map) {
      _refundPercent.text = _numText(refund['refund_percent']);
      _depositRefundPercent.text =
          _numText(refund['deposit_refund_percent'] ?? 100);
      final tiers = refund['tiers'];
      if (tiers is List) {
        for (final t in tiers) {
          if (t is! Map) continue;
          final f = _TierFields();
          f.minDays.text = _numText(t['min_days_before_check_in']);
          f.percent.text = _numText(t['refund_percent']);
          _tiers.add(f);
        }
      }
    }
  }

  static String _numText(Object? v) {
    if (v is! num) return '';
    return v == v.roundToDouble() ? v.toInt().toString() : v.toString();
  }

  static num? _num(String s) {
    final t = s.trim().replaceAll(',', '');
    if (t.isEmpty) return null;
    return num.tryParse(t);
  }

  /// Build the document exactly as the website reads it (`PublishedRates`).
  Map<String, dynamic> _buildDoc() {
    final accommodations = <String, dynamic>{};
    _acc.forEach((id, f) {
      final deposit = _num(f.deposit.text);
      accommodations[id] = {
        'property_name': f.name.text.trim(),
        'rate_unit': 'standard_stay',
        'active': f.active,
        'guest_pricing': {
          'units_per_booking': 1,
          'weekday': f.weekday.toMap(),
          'weekend_holiday': f.weekend.toMap(),
        },
        'security_deposit': deposit,
        'down_payment_percent': 50,
        if (f.manualReviewNotice != null) 'manual_review_notice': f.manualReviewNotice,
      };
    });
    final refund = <String, dynamic>{};
    final rp = _num(_refundPercent.text);
    if (rp != null) refund['refund_percent'] = rp;
    final drp = _num(_depositRefundPercent.text);
    if (drp != null) refund['deposit_refund_percent'] = drp;
    if (_tiers.isNotEmpty) {
      refund['tiers'] = _tiers
          .map((t) => {
                'min_days_before_check_in': _num(t.minDays.text),
                'refund_percent': _num(t.percent.text),
              })
          .toList();
    }
    final holidayDates = _holidayDates.text
        .split(',')
        .map((date) => date.trim())
        .where((date) => date.isNotEmpty)
        .toList();
    return {
      'version': _version.text.trim(),
      'effective_date': _effectiveDate.text.trim(),
      'holiday_dates': holidayDates,
      'accommodations': accommodations,
      if (_preservedPolicies != null) 'policies': _preservedPolicies,
      if (refund.isNotEmpty) 'refund': refund,
    };
  }

  Future<void> _publish() async {
    final doc = _buildDoc();
    final problems = [...validatePublishedRates(doc, kKnownAccommodationIds)];
    if (doc['accommodations'] is Map &&
        (doc['accommodations'] as Map).isEmpty) {
      problems.add(const RatesProblem(
          'accommodations', 'publish figures for at least one Accommodation.'));
    }
    setState(() => _problems = problems);
    if (problems.isNotEmpty) return;

    // Publishing is PIN-tier (ADR-0015): the sheet names the consequence and
    // asks for the PIN instead of the old confirm dialog.
    final ticket = await requirePinTicket(
      context,
      ref: ref,
      title: 'Publish rates ${doc['version']}',
      consequence:
          'The website starts quoting these figures immediately. Bookings already chosen under an earlier version keep their terms.',
    );
    if (ticket == null) return;

    setState(() => _busy = true);
    final result =
        await ref.read(firestoreServiceProvider).publishRates(doc, ticket: ticket);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _problems = result;
    });
    if (result.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Rates ${doc['version']} published.')),
      );
    }
  }

  void _seedPayment(Map<String, dynamic>? doc) {
    if (_paymentSeeded) return;
    _paymentSeeded = true;
    if (doc == null) {
      _paymentMethod.text = 'GCash';
      _paymentRecipient.text = 'Agueda H.';
      _paymentAccount.text = '09258507707';
      _paymentMethod2.text = 'BDO';
      _paymentRecipient2.text = 'Agueda Hortillas';
      _paymentAccount2.text = '005438013682';
      _paymentInstructions.text = 'Send the 50% down payment calculated from the published stay total through one listed channel. The remaining 50% is due at check-in. Upload a screenshot for Admin review.';
      _paymentDepositNotes.text = 'The down payment is 50% of the computed stay total. Any refundable security deposit is shown separately on the published rate card.';
      return;
    }
    _paymentActive = doc['active'] != false;
    final methods = doc['methods'];
    final first = methods is List && methods.isNotEmpty && methods[0] is Map ? methods[0] as Map : doc;
    final second = methods is List && methods.length > 1 && methods[1] is Map ? methods[1] as Map : null;
    _paymentMethod.text = '${first['method'] ?? ''}';
    _paymentRecipient.text = '${first['recipient_name'] ?? ''}';
    _paymentAccount.text = '${first['account_identifier'] ?? ''}';
    _paymentMethod2.text = '${second?['method'] ?? ''}';
    _paymentRecipient2.text = '${second?['recipient_name'] ?? ''}';
    _paymentAccount2.text = '${second?['account_identifier'] ?? ''}';
    _paymentInstructions.text = '${doc['instructions'] ?? ''}';
    _paymentDepositNotes.text = '${doc['security_deposit_notes'] ?? ''}';
    _paymentNotes.text = '${doc['notes'] ?? ''}';
  }

  Future<void> _publishPayment() async {
    // PIN-tier (ADR-0015): these numbers go to every visitor the moment the
    // write lands.
    final ticket = await requirePinTicket(
      context,
      ref: ref,
      title: 'Publish payment information',
      consequence:
          'The GCash and bank numbers become visible to every visitor the moment this saves. They are checked against the published rates page.',
    );
    if (ticket == null) return;
    setState(() => _paymentBusy = true);
    final problem = await ref.read(firestoreServiceProvider).publishPaymentInformation({
      'active': _paymentActive,
      'methods': [
        {
          'method': _paymentMethod.text.trim(),
          'recipient_name': _paymentRecipient.text.trim(),
          'account_identifier': _paymentAccount.text.trim(),
        },
        if (_paymentMethod2.text.trim().isNotEmpty || _paymentAccount2.text.trim().isNotEmpty)
          {
            'method': _paymentMethod2.text.trim(),
            'recipient_name': _paymentRecipient2.text.trim(),
            'account_identifier': _paymentAccount2.text.trim(),
          },
      ],
      'instructions': _paymentInstructions.text.trim(),
      if (_paymentDepositNotes.text.trim().isNotEmpty)
        'security_deposit_notes': _paymentDepositNotes.text.trim(),
      if (_paymentNotes.text.trim().isNotEmpty) 'notes': _paymentNotes.text.trim(),
    }, ticket: ticket);
    if (!mounted) return;
    setState(() => _paymentBusy = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(problem ?? 'Payment information published.'),
      backgroundColor: problem == null ? null : AppColors.statusAlert,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final ratesAsync = ref.watch(publishedRatesProvider);
    final paymentAsync = ref.watch(paymentInformationProvider);
    ratesAsync.whenData(_seedFrom);
    paymentAsync.whenData(_seedPayment);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text('Rates & Cancellation Policy',
            style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
      body: ratesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load rates: $e')),
        data: (current) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            HaciendaCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    current == null
                        ? 'Nothing published yet — the website cannot quote a price or offer a payment plan until you publish.'
                        : 'Live: version ${current['version']} since ${current['effective_date']}.',
                    style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: current == null
                            ? AppColors.statusWarning
                            : AppColors.primaryForest),
                  ),
                  if (_legacyRatesNeedReview) ...[
                    const SizedBox(height: 8),
                    Text(
                      'The stored rates use a retired nightly, minimum-guest, flat reservation-fee, or old bracket format. A new guest-count schedule is prepared below; review it and publish under a new version. Nothing changes until you publish.',
                      style: GoogleFonts.inter(fontSize: 12, color: AppColors.statusWarning, height: 1.4),
                    ),
                  ],
                  const SizedBox(height: 8),
                  Text(
                    'Rates below are per 22-hour standard stay. New Bookings use a 50% down payment from the computed total; the remaining 50% is due at check-in.',
                    style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted, height: 1.4),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _version,
                          decoration: const InputDecoration(
                              labelText: 'Version', hintText: 'v2'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _effectiveDate,
                          decoration: const InputDecoration(
                              labelText: 'Effective date',
                              hintText: 'YYYY-MM-DD'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _holidayDates,
                    decoration: const InputDecoration(
                      labelText: 'Admin-configured holiday dates (comma-separated)',
                      hintText: 'YYYY-MM-DD, YYYY-MM-DD',
                      helperText: 'Friday and Saturday nights use weekend rates. Sunday check-in is weekday unless it is listed here; Sunday noon checkout completes the Saturday stay. No calendar is assumed.'
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SectionHeader(
                title: 'Accommodations', padding: EdgeInsets.zero),
            const SizedBox(height: 6),
            for (final entry in _acc.entries) ...[
              _accommodationCard(entry.key, entry.value),
              const SizedBox(height: 10),
            ],
            const SizedBox(height: 12),
            const SectionHeader(
                title: 'Guest payment information', padding: EdgeInsets.zero),
            const SizedBox(height: 6),
            HaciendaCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Publish payment information'),
                    subtitle: const Text('Only enter account details that guests are allowed to see.'),
                    value: _paymentActive,
                    onChanged: (v) => setState(() => _paymentActive = v),
                  ),
                  TextField(controller: _paymentMethod, decoration: const InputDecoration(labelText: 'Payment method', hintText: 'GCash')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentRecipient, decoration: const InputDecoration(labelText: 'Recipient / account name')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentAccount, decoration: const InputDecoration(labelText: 'Account number or payment ID')),
                  const SizedBox(height: 12),
                  Text('Second channel (optional)', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
                  TextField(controller: _paymentMethod2, decoration: const InputDecoration(labelText: 'Payment method', hintText: 'BDO')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentRecipient2, decoration: const InputDecoration(labelText: 'Recipient / account name')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentAccount2, decoration: const InputDecoration(labelText: 'Account number or payment ID')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentInstructions, maxLines: 3, decoration: const InputDecoration(labelText: 'Payment instructions')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentDepositNotes, maxLines: 2, decoration: const InputDecoration(labelText: 'Security deposit notes (optional)')),
                  const SizedBox(height: 8),
                  TextField(controller: _paymentNotes, maxLines: 2, decoration: const InputDecoration(labelText: 'Other guest notes (optional)')),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _paymentBusy ? null : _publishPayment,
                      icon: const Icon(Icons.account_balance_wallet_outlined),
                      label: Text(_paymentBusy ? 'Publishing…' : 'Publish payment information'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const SectionHeader(
                title: 'Cancellation & refund', padding: EdgeInsets.zero),
            const SizedBox(height: 6),
            HaciendaCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _refundPercent,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                              labelText: 'Flat refund %',
                              helperText: 'Used when no tiers apply'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _depositRefundPercent,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                              labelText: 'Deposit refund %',
                              helperText: 'Of the Security deposit'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text('Tiers (days before check-in → refund %)',
                      style: GoogleFonts.inter(
                          fontSize: 12, fontWeight: FontWeight.bold)),
                  for (var i = 0; i < _tiers.length; i++)
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _tiers[i].minDays,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: 'At least … days before'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _tiers[i].percent,
                            keyboardType: TextInputType.number,
                            decoration:
                                const InputDecoration(labelText: 'Refund %'),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Remove tier',
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: () => setState(() {
                            _tiers.removeAt(i).dispose();
                          }),
                        ),
                      ],
                    ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () =>
                          setState(() => _tiers.add(_TierFields())),
                      icon: const Icon(Icons.add),
                      label: const Text('Add tier'),
                    ),
                  ),
                ],
              ),
            ),
            if (_problems.isNotEmpty) ...[
              const SizedBox(height: 12),
              HaciendaCard(
                borderColor: AppColors.statusAlert.withOpacity(0.5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Not published — fix these first:',
                        style: GoogleFonts.inter(
                            fontWeight: FontWeight.bold,
                            color: AppColors.statusAlert)),
                    const SizedBox(height: 6),
                    for (final p in _problems)
                      Text('• $p',
                          style: GoogleFonts.inter(
                              fontSize: 12, color: AppColors.textDark)),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              key: TourKeys.ratesPublish,
              height: 50,
              child: ElevatedButton.icon(
                onPressed: _busy ? null : _publish,
                icon: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.publish_outlined),
                label: Text(_busy ? 'Publishing…' : 'Publish to website'),
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _scheduleFields(String label, _ScheduleFields f, {bool allowCap = false}) {
    InputDecoration decoration(String text) => InputDecoration(labelText: text, isDense: true);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
      const SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 8, children: [
        SizedBox(width: 145, child: TextField(controller: f.baseMax, keyboardType: TextInputType.number, decoration: decoration('Guests included'))),
        SizedBox(width: 145, child: TextField(controller: f.baseRate, keyboardType: TextInputType.number, decoration: decoration('Base rate / stay ₱'))),
        SizedBox(width: 145, child: TextField(controller: f.excessRate, keyboardType: TextInputType.number, decoration: decoration('Each extra guest ₱'))),
        if (allowCap)
          SizedBox(width: 145, child: TextField(controller: f.maxGuests, keyboardType: TextInputType.number, decoration: decoration('Maximum guests'))),
      ]),
      const SizedBox(height: 4),
      Text(
        allowCap
            ? 'A-House is one unit per booking and is capped at 3 guests.'
            : 'Included occupancy is the base-rate threshold, not an absolute booking cap. No physical/safety maximum is configured.',
        style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted, height: 1.35),
      ),
    ]);
  }

  Widget _accommodationCard(String id, _AccommodationFields f) {
    final hasAHouseCap = id == 'house-a-camping';
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(BookingModel.accommodationLabel(id),
                    style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.bold)),
              ),
              Switch.adaptive(
                value: f.active,
                onChanged: (v) => setState(() => f.active = v),
              ),
              Text(f.active ? 'Active' : 'Inactive', style: GoogleFonts.inter(fontSize: 11)),
            ],
          ),
          TextField(
            controller: f.name,
            decoration: const InputDecoration(labelText: 'Property name'),
          ),
          const SizedBox(height: 8),
          _scheduleFields('Weekday (Sunday night–Thursday night)', f.weekday, allowCap: hasAHouseCap),
          const SizedBox(height: 10),
          _scheduleFields('Weekend / configured holiday (Friday and Saturday nights)', f.weekend, allowCap: hasAHouseCap),
          const SizedBox(height: 8),
          TextField(
            controller: f.deposit,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Security deposit', prefixText: '₱ '),
          ),
          const SizedBox(height: 8),
          Text('50% down payment from computed total · remaining 50% due at check-in',
              style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
        ],
      ),
    );
  }
}

class _ScheduleFields {
  final baseMax = TextEditingController();
  final baseRate = TextEditingController();
  final excessRate = TextEditingController();
  final maxGuests = TextEditingController();

  void seed(Object? value) {
    if (value is! Map) return;
    baseMax.text = _RatesScreenState._numText(value['base_max_guests']);
    baseRate.text = _RatesScreenState._numText(value['base_rate']);
    excessRate.text = _RatesScreenState._numText(value['excess_per_guest']);
    maxGuests.text = _RatesScreenState._numText(value['max_guests']);
  }

  Map<String, dynamic> toMap() {
    final excess = _RatesScreenState._num(excessRate.text);
    final max = _RatesScreenState._num(maxGuests.text);
    return {
      'min_guests': 1,
      'base_max_guests': _RatesScreenState._num(baseMax.text),
      'base_rate': _RatesScreenState._num(baseRate.text),
      if (excess != null) 'excess_per_guest': excess,
      if (max != null) 'max_guests': max,
    };
  }

  void dispose() {
    baseMax.dispose();
    baseRate.dispose();
    excessRate.dispose();
    maxGuests.dispose();
  }
}

class _AccommodationFields {
  final name = TextEditingController();
  final deposit = TextEditingController();
  final weekday = _ScheduleFields();
  final weekend = _ScheduleFields();
  String? manualReviewNotice;
  bool active = true;
  _AccommodationFields(String initialName) {
    name.text = initialName;
  }
  void dispose() {
    name.dispose();
    deposit.dispose();
    weekday.dispose();
    weekend.dispose();
  }
}

class _TierFields {
  final minDays = TextEditingController();
  final percent = TextEditingController();
  void dispose() {
    minDays.dispose();
    percent.dispose();
  }
}
