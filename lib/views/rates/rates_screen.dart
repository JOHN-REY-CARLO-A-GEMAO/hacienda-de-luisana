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
  final _refundPercent = TextEditingController();
  final _depositRefundPercent = TextEditingController(text: '100');
  final Map<String, _AccommodationFields> _acc = {
    for (final id in kKnownAccommodationIds) id: _AccommodationFields(),
  };
  final List<_TierFields> _tiers = [];

  bool _seeded = false;
  bool _busy = false;
  List<RatesProblem> _problems = const [];

  @override
  void dispose() {
    _version.dispose();
    _effectiveDate.dispose();
    _refundPercent.dispose();
    _depositRefundPercent.dispose();
    for (final f in _acc.values) {
      f.dispose();
    }
    for (final t in _tiers) {
      t.dispose();
    }
    super.dispose();
  }

  void _seedFrom(Map<String, dynamic>? doc) {
    if (_seeded) return;
    _seeded = true;
    if (doc == null) {
      final today = DateTime.now().toIso8601String().substring(0, 10);
      _version.text = 'v1';
      _effectiveDate.text = today;
      return;
    }
    _version.text = '${doc['version'] ?? ''}';
    _effectiveDate.text = '${doc['effective_date'] ?? ''}';
    final acc = doc['accommodations'];
    if (acc is Map) {
      acc.forEach((id, node) {
        final f = _acc['$id'];
        if (f == null || node is! Map) return;
        f.nightly.text = _numText(node['nightly_rate']);
        f.deposit.text = _numText(node['security_deposit']);
        f.downPayment.text = _numText(node['down_payment_percent']);
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
      if (nightly == null && deposit == null && dp == null) return;
      accommodations[id] = {
        'nightly_rate': nightly,
        'security_deposit': deposit,
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

  @override
  Widget build(BuildContext context) {
    final ratesAsync = ref.watch(publishedRatesProvider);
    ratesAsync.whenData(_seedFrom);

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
            const SizedBox(height: 6),
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

  Widget _accommodationCard(String id, _AccommodationFields f) {
    return HaciendaCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(BookingModel.accommodationLabel(id),
              style:
                  GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.bold)),
          Text(id,
              style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 8),
          Row(
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
          TextField(
            controller: f.downPayment,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
                labelText: 'Down payment % (blank = full payment only)'),
          ),
        ],
      ),
    );
  }
}

class _AccommodationFields {
  final nightly = TextEditingController();
  final deposit = TextEditingController();
  final downPayment = TextEditingController();
  void dispose() {
    nightly.dispose();
    deposit.dispose();
    downPayment.dispose();
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
