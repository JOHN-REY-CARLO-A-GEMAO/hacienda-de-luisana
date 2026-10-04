import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/booking_lifecycle.dart';
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

  void _seedFrom(Map<String, dynamic>? doc) {
    if (_seeded) return;
    _seeded = true;
    if (doc == null) {
      final today = DateTime.now().toIso8601String().substring(0, 10);
      _version.text = 'official-v1';
      _effectiveDate.text = today;
      void official(String id, Map<String, num> weekday, Map<String, num> weekend) {
        final f = _acc[id]!;
        f.tiered = true;
        f.weekday.seed(weekday);
        f.weekend.seed(weekend);
      }
      official('main-house',
        {'min_guests': 6, 'base_max_guests': 10, 'base_rate': 5000, 'upper_min_guests': 11, 'upper_max_guests': 13, 'upper_rate': 5500, 'excess_after': 13, 'excess_per_guest': 500},
        {'min_guests': 6, 'base_max_guests': 10, 'base_rate': 6000, 'upper_min_guests': 11, 'upper_max_guests': 13, 'upper_rate': 6500, 'excess_after': 13, 'excess_per_guest': 500});
      official('annex',
        {'min_guests': 2, 'base_max_guests': 6, 'base_rate': 4000},
        {'min_guests': 2, 'base_max_guests': 6, 'base_rate': 5000});
      official('house-a-camping',
        {'min_guests': 2, 'base_max_guests': 3, 'base_rate': 1000},
        {'min_guests': 2, 'base_max_guests': 3, 'base_rate': 1000});
      return;
    }
    _version.text = '${doc['version'] ?? ''}';
    _effectiveDate.text = '${doc['effective_date'] ?? ''}';
    final holidays = doc['holiday_dates'];
    if (holidays is List) _holidayDates.text = holidays.join(', ');
    final acc = doc['accommodations'];
    if (acc is Map) {
      acc.forEach((id, node) {
        final f = _acc['$id'];
        if (f == null || node is! Map) return;
        f.name.text = '${node['property_name'] ?? BookingModel.accommodationLabel('$id')}';
        f.active = node['active'] != false;
        f.nightly.text = _numText(node['nightly_rate']);
        f.deposit.text = _numText(node['security_deposit']);
        f.downPayment.text = _numText(node['down_payment_percent']);
        f.reservationFee.text = _numText(node['reservation_fee_amount']);
        final gp = node['guest_pricing'];
        if (gp is Map) {
          f.tiered = true;
          f.weekday.seed(gp['weekday']);
          f.weekend.seed(gp['weekend_holiday']);
        }
      });
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
      final nightly = _num(f.nightly.text);
      final deposit = _num(f.deposit.text);
      final dp = _num(f.downPayment.text);
      final reservationFee = _num(f.reservationFee.text);
      if (!f.tiered && nightly == null && deposit == null && dp == null && reservationFee == null) return;
      accommodations[id] = {
        'property_name': f.name.text.trim(),
        'rate_unit': f.tiered ? 'standard_stay' : 'night',
        'active': f.active,
        if (f.tiered) 'guest_pricing': {
          'units_per_booking': 1,
          'weekday': f.weekday.toMap(),
          'weekend_holiday': f.weekend.toMap(),
        } else 'nightly_rate': nightly,
        'security_deposit': deposit,
        if (reservationFee != null) 'reservation_fee_amount': reservationFee,
        if (dp != null) 'down_payment_percent': dp,
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
    return {
      'version': _version.text.trim(),
      'effective_date': _effectiveDate.text.trim(),
      'accommodations': accommodations,
      if (_holidayDates.text.trim().isNotEmpty)
        'holiday_dates': _holidayDates.text.split(',').map((date) => date.trim()).where((date) => date.isNotEmpty).toList(),
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

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Publish ${doc['version']}?',
            style: GoogleFonts.cinzel(fontWeight: FontWeight.bold, fontSize: 16)),
        content: const Text(
            'The website starts quoting these figures immediately. Bookings already chosen under an earlier version keep their terms.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Back')),
          ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Publish')),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _busy = true);
    final result = await ref.read(firestoreServiceProvider).publishRates(doc);
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
      _paymentInstructions.text = 'Send the non-refundable reservation fee through one listed channel. Full payment is due at check-in. Submit a screenshot or Gmail confirmation/reference for verification.';
      _paymentDepositNotes.text = 'Reservation fee is non-refundable. Confirm its amount before publishing rates.';
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
    });
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
                      labelText: 'Holiday dates (comma-separated)',
                      hintText: 'YYYY-MM-DD, YYYY-MM-DD',
                      helperText: 'Only dates entered here use holiday pricing; no calendar is assumed.',
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

  Widget _scheduleFields(String label, _ScheduleFields f) {
    InputDecoration decoration(String text) => InputDecoration(labelText: text, isDense: true);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
      const SizedBox(height: 6),
      Wrap(spacing: 8, runSpacing: 8, children: [
        SizedBox(width: 115, child: TextField(controller: f.min, keyboardType: TextInputType.number, decoration: decoration('Min guests'))),
        SizedBox(width: 115, child: TextField(controller: f.baseMax, keyboardType: TextInputType.number, decoration: decoration('Base max'))),
        SizedBox(width: 125, child: TextField(controller: f.baseRate, keyboardType: TextInputType.number, decoration: decoration('Base rate ₱'))),
        SizedBox(width: 115, child: TextField(controller: f.upperMin, keyboardType: TextInputType.number, decoration: decoration('Upper min'))),
        SizedBox(width: 115, child: TextField(controller: f.upperMax, keyboardType: TextInputType.number, decoration: decoration('Upper max'))),
        SizedBox(width: 125, child: TextField(controller: f.upperRate, keyboardType: TextInputType.number, decoration: decoration('Upper rate ₱'))),
        SizedBox(width: 125, child: TextField(controller: f.excessAfter, keyboardType: TextInputType.number, decoration: decoration('Excess after'))),
        SizedBox(width: 135, child: TextField(controller: f.excessRate, keyboardType: TextInputType.number, decoration: decoration('Excess/person ₱'))),
      ]),
    ]);
  }

  Widget _accommodationCard(String id, _AccommodationFields f) {
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(id,
                    style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
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
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Guest-count / standard-stay schedule'),
            subtitle: const Text('Use weekday and weekend/Admin-holiday brackets instead of a nightly price.'),
            value: f.tiered,
            onChanged: (value) => setState(() => f.tiered = value == true),
          ),
          if (f.tiered) ...[
            _scheduleFields('Weekday', f.weekday),
            const SizedBox(height: 10),
            _scheduleFields('Weekend / configured holiday', f.weekend),
          ] else Row(
            children: [
              Expanded(
                child: TextField(
                  controller: f.nightly,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                      labelText: 'Per night', prefixText: '₱ '),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: f.deposit,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                      labelText: 'Security deposit', prefixText: '₱ '),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (f.tiered) ...[
            TextField(
              controller: f.deposit,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Security deposit', prefixText: '₱ '),
            ),
            const SizedBox(height: 8),
          ],
          Row(children: [
            Expanded(child: TextField(
              controller: f.reservationFee,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Exact reservation fee ₱'),
            )),
            const SizedBox(width: 12),
            Expanded(child: TextField(
              controller: f.downPayment,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Legacy down payment %'),
            )),
          ]),
          const SizedBox(height: 4),
          Text('Use only one; leave both blank for full payment.', style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
        ],
      ),
    );
  }
}

class _ScheduleFields {
  final min = TextEditingController();
  final baseMax = TextEditingController();
  final baseRate = TextEditingController();
  final upperMin = TextEditingController();
  final upperMax = TextEditingController();
  final upperRate = TextEditingController();
  final excessAfter = TextEditingController();
  final excessRate = TextEditingController();
  void seed(Object? value) {
    if (value is! Map) return;
    min.text = _RatesScreenState._numText(value['min_guests']);
    baseMax.text = _RatesScreenState._numText(value['base_max_guests']);
    baseRate.text = _RatesScreenState._numText(value['base_rate']);
    upperMin.text = _RatesScreenState._numText(value['upper_min_guests']);
    upperMax.text = _RatesScreenState._numText(value['upper_max_guests']);
    upperRate.text = _RatesScreenState._numText(value['upper_rate']);
    excessAfter.text = _RatesScreenState._numText(value['excess_after']);
    excessRate.text = _RatesScreenState._numText(value['excess_per_guest']);
  }
  Map<String, dynamic> toMap() {
    final upperMinValue = _RatesScreenState._num(upperMin.text);
    final upperMaxValue = _RatesScreenState._num(upperMax.text);
    final upperRateValue = _RatesScreenState._num(upperRate.text);
    final excessAfterValue = _RatesScreenState._num(excessAfter.text);
    final excessRateValue = _RatesScreenState._num(excessRate.text);
    return {
      'min_guests': _RatesScreenState._num(min.text),
      'base_max_guests': _RatesScreenState._num(baseMax.text),
      'base_rate': _RatesScreenState._num(baseRate.text),
      if (upperMinValue != null) 'upper_min_guests': upperMinValue,
      if (upperMaxValue != null) 'upper_max_guests': upperMaxValue,
      if (upperRateValue != null) 'upper_rate': upperRateValue,
      if (excessAfterValue != null) 'excess_after': excessAfterValue,
      if (excessRateValue != null) 'excess_per_guest': excessRateValue,
    };
  }
  void dispose() {
    for (final field in [min, baseMax, baseRate, upperMin, upperMax, upperRate, excessAfter, excessRate]) { field.dispose(); }
  }
}

class _AccommodationFields {
  final name = TextEditingController();
  final nightly = TextEditingController();
  final deposit = TextEditingController();
  final downPayment = TextEditingController();
  final reservationFee = TextEditingController();
  final weekday = _ScheduleFields();
  final weekend = _ScheduleFields();
  bool tiered = false;
  bool active = true;
  _AccommodationFields(String initialName) {
    name.text = initialName;
  }
  void dispose() {
    name.dispose();
    nightly.dispose();
    deposit.dispose();
    downPayment.dispose();
    reservationFee.dispose();
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
