import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/luxe_progress.dart';

/// Revenue and stay analytics derived entirely from recorded bookings.
///
/// The page is deliberately quiet: one dark revenue panel, readable measures,
/// and bars scaled to the real counts in the current data set.
class AnalyticsScreen extends ConsumerWidget {
  const AnalyticsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kpis = ref.watch(analyticsKpisProvider);
    final stats = ref.watch(dashboardStatsProvider);
    final accommodations = ref.watch(accommodationsProvider);
    final currency = NumberFormat.currency(
      locale: 'en_PH',
      symbol: '₱',
      decimalDigits: 0,
    );

    final metrics = <Widget>[
      AdminMetricTile(
        label: 'Average stay',
        value: '${kpis.averageLengthOfStay.toStringAsFixed(1)} nights',
        detail: 'Across recorded stays',
        icon: Icons.hourglass_bottom_outlined,
        accent: AppColors.primaryForest,
      ),
      AdminMetricTile(
        label: 'Guests hosted',
        value: '${stats.totalGuestsHosted}',
        detail: 'From confirmed bookings',
        icon: Icons.groups_outlined,
        accent: AppColors.statusSuccess,
      ),
      AdminMetricTile(
        label: 'Conversion',
        value: '${kpis.conversionRate.toStringAsFixed(1)}%',
        detail: 'Bookings confirmed',
        icon: Icons.trending_up_outlined,
        accent: AppColors.statusInfo,
      ),
      AdminMetricTile(
        label: 'Projected revenue',
        value: currency.format(kpis.projectedRevenue),
        detail: 'All non-cancelled bookings',
        icon: Icons.account_balance_wallet_outlined,
        accent: AppColors.accentGoldDark,
      ),
    ];

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: const AdminPageHeader(
        title: 'Revenue & stays',
        subtitle: 'Derived from recorded bookings',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 32),
        child: AdminContent(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _RevenuePanel(kpis: kpis, currency: currency),
              const SizedBox(height: 20),
              const AdminSectionHeading(
                title: 'Operating measures',
                caption: 'Figures update with the live booking stream.',
              ),
              const SizedBox(height: 8),
              LayoutBuilder(
                builder: (context, constraints) {
                  final columns = constraints.maxWidth >= 1000
                      ? 4
                      : constraints.maxWidth >= 620
                          ? 2
                          : 1;
                  final cardWidth =
                      (constraints.maxWidth - (12 * (columns - 1))) / columns;
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: [
                      for (final metric in metrics)
                        SizedBox(width: cardWidth, child: metric),
                    ],
                  );
                },
              ),
              const SizedBox(height: 20),
              AdminResponsiveColumns(
                primary: _StayLengthPanel(kpis: kpis),
                secondary: _RevenueSplitPanel(
                  kpis: kpis,
                  currency: currency,
                  accommodationLabel: (id) =>
                      BookingModel.accommodationLabel(id, accommodations),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RevenuePanel extends StatelessWidget {
  final AnalyticsKpis kpis;
  final NumberFormat currency;

  const _RevenuePanel({required this.kpis, required this.currency});

  @override
  Widget build(BuildContext context) {
    return HaciendaCard(
      padding: const EdgeInsets.all(20),
      color: AppColors.primaryDark,
      borderColor: AppColors.accentGold.withValues(alpha: 0.55),
      semanticLabel:
          'Confirmed booking revenue ${currency.format(kpis.confirmedRevenue)}. '
          'Collected ${currency.format(kpis.collectedRevenue)}. '
          'Outstanding ${currency.format(kpis.outstandingBalance)}. '
          'Refunded ${currency.format(kpis.refundedAmount)}.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.trending_up_outlined,
                  color: AppColors.accentGoldLight, size: 19),
              const SizedBox(width: 8),
              Text(
                'Confirmed booking revenue',
                style: AppTheme.title(fontSize: 13, color: Colors.white),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            currency.format(kpis.confirmedRevenue),
            style: AppTheme.metric(fontSize: 32, color: Colors.white),
          ),
          const SizedBox(height: 5),
          Text(
            'Based on confirmed, checked-in and completed bookings.',
            style: AppTheme.body(
              fontSize: 12,
              color: Colors.white.withValues(alpha: 0.68),
            ),
          ),
          const SizedBox(height: 18),
          const Divider(color: Color(0x33FFFFFF), height: 1),
          const SizedBox(height: 16),
          Row(
            children: [
              AdminMastheadMetric(
                value: currency.format(kpis.collectedRevenue),
                label: 'Collected',
                icon: Icons.savings_outlined,
              ),
              const SizedBox(width: 10),
              AdminMastheadMetric(
                value: currency.format(kpis.outstandingBalance),
                label: 'Outstanding',
                icon: Icons.schedule_outlined,
              ),
              const SizedBox(width: 10),
              AdminMastheadMetric(
                value: currency.format(kpis.refundedAmount),
                label: 'Refunded',
                icon: Icons.undo_outlined,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StayLengthPanel extends StatelessWidget {
  final AnalyticsKpis kpis;

  const _StayLengthPanel({required this.kpis});

  @override
  Widget build(BuildContext context) {
    final buckets = <String, int>{
      '1 night': kpis.stayDurationBuckets[1] ?? 0,
      '2 nights': kpis.stayDurationBuckets[2] ?? 0,
      '3–4 nights': kpis.stayDurationBuckets[3] ?? 0,
      '5+ nights': kpis.stayDurationBuckets[5] ?? 0,
    };
    final maxCount = buckets.values.fold<int>(
      0,
      (max, value) => value > max ? value : max,
    );
    final denominator = maxCount == 0 ? 1 : maxCount;

    return HaciendaCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Length of stay', style: AppTheme.display(fontSize: 19)),
          const SizedBox(height: 4),
          Text(
            'Bars are scaled to the busiest bucket in the current records.',
            style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
          ),
          const SizedBox(height: 18),
          for (final entry in buckets.entries) ...[
            _StayBar(
              label: entry.key,
              count: entry.value,
              fraction: entry.value / denominator,
            ),
            const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }
}

class _StayBar extends StatelessWidget {
  final String label;
  final int count;
  final double fraction;

  const _StayBar({
    required this.label,
    required this.count,
    required this.fraction,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: AppTheme.title(fontSize: 13)),
            Text(
              '$count ${count == 1 ? 'stay' : 'stays'}',
              style: AppTheme.label(fontSize: 12, color: AppColors.textDark),
            ),
          ],
        ),
        const SizedBox(height: 7),
        LuxeProgress(
          value: fraction,
          semanticLabel: '$label: $count stays',
        ),
      ],
    );
  }
}

class _RevenueSplitPanel extends StatelessWidget {
  final AnalyticsKpis kpis;
  final NumberFormat currency;
  final String Function(String) accommodationLabel;

  const _RevenueSplitPanel({
    required this.kpis,
    required this.currency,
    required this.accommodationLabel,
  });

  @override
  Widget build(BuildContext context) {
    return HaciendaCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Revenue split', style: AppTheme.display(fontSize: 19)),
          const SizedBox(height: 4),
          Text(
            'Weekday, weekend and accommodation totals from recorded bookings.',
            style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _SplitValue(
                  label: 'Weekday stays',
                  value: currency.format(kpis.weekdayRevenue),
                  icon: Icons.wb_sunny_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _SplitValue(
                  label: 'Weekend & holiday',
                  value: currency.format(kpis.weekendRevenue),
                  icon: Icons.weekend_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text('By accommodation', style: AppTheme.title(fontSize: 14)),
          const SizedBox(height: 6),
          if (kpis.accommodationRevenue.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'No accommodation revenue has been recorded yet.',
                style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
              ),
            )
          else
            for (final entry in kpis.accommodationRevenue.entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    const Icon(Icons.holiday_village_outlined,
                        size: 15, color: AppColors.textMuted),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        accommodationLabel(entry.key),
                        style: AppTheme.body(fontSize: 12),
                      ),
                    ),
                    Text(
                      currency.format(entry.value),
                      style: AppTheme.body(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

class _SplitValue extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _SplitValue({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.sageMist,
        borderRadius: BorderRadius.circular(AppTheme.radiusPanel),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 17, color: AppColors.primaryForest),
          const SizedBox(height: 8),
          Text(label, style: AppTheme.label(fontSize: 11)),
          const SizedBox(height: 3),
          Text(
            value,
            style: AppTheme.title(fontSize: 14),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
