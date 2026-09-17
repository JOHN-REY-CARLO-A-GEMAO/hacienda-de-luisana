import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../../core/constants/app_constants.dart';
import '../../providers/app_providers.dart';

class AnalyticsScreen extends ConsumerWidget {
  const AnalyticsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kpis = ref.watch(analyticsKpisProvider);
    final stats = ref.watch(dashboardStatsProvider);

    final currencyFmt = NumberFormat.currency(locale: 'en_PH', symbol: '₱', decimalDigits: 0);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Revenue & Stay Analytics',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 1. Revenue Overview Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0D2818), Color(0xFF1E3A2F)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(22),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.12),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'TOTAL REVENUE OVERVIEW',
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: AppColors.accentGoldLight,
                      ),
                    ),
                    const Icon(Icons.trending_up, color: AppColors.accentGoldLight, size: 18),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  currencyFmt.format(kpis.confirmedRevenue),
                  style: GoogleFonts.cinzel(
                    fontSize: 32,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Confirmed Bookings Revenue',
                  style: GoogleFonts.inter(fontSize: 12, color: Colors.white.withOpacity(0.8)),
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('PROJECTED PIPELINE',
                              style: GoogleFonts.inter(fontSize: 9, color: Colors.white60)),
                          Text(
                            currencyFmt.format(kpis.projectedRevenue),
                            style: GoogleFonts.inter(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text('CONVERSION RATE',
                              style: GoogleFonts.inter(fontSize: 9, color: Colors.white60)),
                          Text(
                            '${kpis.conversionRate}%',
                            style: GoogleFonts.inter(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: AppColors.accentGoldLight,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 2. Core KPIs Row
          Row(
            children: [
              Expanded(
                child: _buildMetricCard(
                  title: 'AVG LENGTH OF STAY',
                  value: '${kpis.averageLengthOfStay} Nights',
                  subtitle: 'Consistent weekend demand',
                  icon: Icons.hourglass_bottom_rounded,
                  accentColor: AppColors.primaryForest,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildMetricCard(
                  title: 'GUESTS SERVED',
                  value: '${stats.totalGuestsHosted}',
                  subtitle: 'Hosted at Luisiana',
                  icon: Icons.people_outline,
                  accentColor: AppColors.statusSuccess,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // 3. Stay Duration Distribution (Visual Bars)
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'STAY DURATION DISTRIBUTION',
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.8,
                        color: AppColors.textMuted,
                      ),
                    ),
                    const Icon(Icons.bar_chart_rounded, size: 18, color: AppColors.primaryForest),
                  ],
                ),
                const SizedBox(height: 14),
                _buildBarProgress('1 Night (Day/Overnight)', kpis.stayDurationBuckets[1] ?? 0, 5, Colors.amber),
                const SizedBox(height: 10),
                _buildBarProgress('2 Nights (Standard Weekend)', kpis.stayDurationBuckets[2] ?? 0, 5, AppColors.statusSuccess),
                const SizedBox(height: 10),
                _buildBarProgress('3 - 4 Nights (Extended)', kpis.stayDurationBuckets[3] ?? 0, 5, AppColors.primaryForest),
                const SizedBox(height: 10),
                _buildBarProgress('5+ Nights (Workcation / Long Stay)', kpis.stayDurationBuckets[5] ?? 0, 5, Colors.indigo),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // 4. Top Accommodation Card
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.accentGold.withOpacity(0.12),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.hotel_class, color: AppColors.accentGoldDark, size: 24),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'TOP PERFORMING PROPERTY',
                        style: GoogleFonts.inter(fontSize: 10, color: AppColors.textMuted, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        kpis.topAccommodation,
                        style: GoogleFonts.cinzel(fontSize: 15, fontWeight: FontWeight.bold, color: AppColors.textDark),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Highest occupancy & direct guest inquiry rate',
                        style: GoogleFonts.inter(fontSize: 11, color: AppColors.statusSuccess),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricCard({
    required String title,
    required String value,
    required String subtitle,
    required IconData icon,
    required Color accentColor,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: GoogleFonts.inter(fontSize: 9, fontWeight: FontWeight.bold, color: AppColors.textMuted)),
              Icon(icon, size: 14, color: accentColor),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: GoogleFonts.cinzel(fontSize: 20, fontWeight: FontWeight.bold, color: AppColors.textDark)),
          const SizedBox(height: 2),
          Text(subtitle, style: GoogleFonts.inter(fontSize: 10, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _buildBarProgress(String label, int count, int maxVal, Color color) {
    final double fraction = (count / (maxVal > 0 ? maxVal : 1)).clamp(0.05, 1.0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.w500)),
            Text('$count stays', style: GoogleFonts.inter(fontSize: 12, fontWeight: FontWeight.bold)),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: fraction,
            backgroundColor: AppColors.surfaceLight,
            valueColor: AlwaysStoppedAnimation<Color>(color),
            minHeight: 8,
          ),
        ),
      ],
    );
  }
}
