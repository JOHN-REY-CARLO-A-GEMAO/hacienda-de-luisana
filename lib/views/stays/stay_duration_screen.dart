import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../core/theme/status_style.dart';
import '../../services/booking_lifecycle.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/loading_state.dart';
import '../../widgets/luxe_progress.dart';
import '../../widgets/status_pill.dart';
import '../../widgets/admin_ui.dart';

class StayDurationScreen extends ConsumerStatefulWidget {
  const StayDurationScreen({super.key});

  @override
  ConsumerState<StayDurationScreen> createState() => _StayDurationScreenState();
}

class _StayDurationScreenState extends ConsumerState<StayDurationScreen> {
  String _selectedDurationFilter = 'All';

  final List<String> _filters = ['All', '1 Night', '2 Nights', '3+ Nights'];

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: const AdminPageHeader(
        title: 'Stays & guest tracker',
        subtitle: 'Follow the duration of every recorded stay',
      ),
      body: Column(
        children: [
          HaciendaCard(
            borderRadius: const BorderRadius.vertical(
              bottom: Radius.circular(AppTheme.radiusPanel),
            ),
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: AdminFilterStrip(
              items: [
                for (final filter in _filters)
                  AdminFilterItem(label: filter),
              ],
              selectedIndex: _filters.indexOf(_selectedDurationFilter),
              onSelected: (index) =>
                  setState(() => _selectedDurationFilter = _filters[index]),
            ),
          ),

          // Stays List
          Expanded(
            child: bookingsAsync.when(
              data: (bookings) {
                final activeStays = bookings.where((b) {
                  if (b.status == BookingStatus.cancelled) return false;

                  if (_selectedDurationFilter == '1 Night') {
                    if (b.totalNights != 1) return false;
                  } else if (_selectedDurationFilter == '2 Nights') {
                    if (b.totalNights != 2) return false;
                  } else if (_selectedDurationFilter == '3+ Nights') {
                    if (b.totalNights < 3) return false;
                  }

                  return true;
                }).toList();

                if (activeStays.isEmpty) {
                  return const EmptyState(
                    icon: Icons.hourglass_empty_rounded,
                    title: 'No active stays found',
                    subtitle: 'Try selecting another stay duration filter above.',
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: activeStays.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, i) {
                    final stay = activeStays[i];
                    return _buildStayCard(stay);
                  },
                );
              },
              loading: () => const LoadingState(
                    label: 'Reading stays…',
                    detail: 'Loading the current booking records.',
                  ),
              error: (err, _) => EmptyState(
                    icon: Icons.cloud_off_outlined,
                    title: 'Stays could not be read',
                    subtitle:
                        'Check the connection and try again. ${err.toString().split('\n').first}',
                    action: OutlinedButton.icon(
                      onPressed: () => ref.invalidate(bookingsStreamProvider),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Try again'),
                    ),
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStayCard(BookingModel stay) {
    final now = DateTime.now();
    final totalHours = stay.checkOutDate.difference(stay.checkInDate).inHours;
    final elapsedHours = now.isAfter(stay.checkInDate)
        ? now.difference(stay.checkInDate).inHours.clamp(0, totalHours)
        : 0;
    final remainingHours = (totalHours - elapsedHours).clamp(0, totalHours);
    final double progress = totalHours > 0 ? (elapsedHours / totalHours).clamp(0.0, 1.0) : 0.0;

    final isStayingNow = stay.status == BookingStatus.checkedIn ||
        (stay.checkInDate.isBefore(now) && stay.checkOutDate.isAfter(now));

    final currentDay = isStayingNow
        ? (elapsedHours ~/ 24) + 1
        : 1;

    return HaciendaCard(
      borderColor: isStayingNow ? AppColors.statusSuccess.withOpacity(0.4) : AppColors.cardBorder,
      borderWidth: isStayingNow ? 1.5 : 1.0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      stay.guestName,
                      style: GoogleFonts.inter(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: AppColors.textDark,
                      ),
                    ),
                    Text(
                      BookingModel.accommodationLabel(
                          stay.accommodation, ref.watch(accommodationsProvider)),
                      style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              StatusPill(
                label: isStayingNow ? 'In resort now' : stay.status.displayName,
                color: isStayingNow
                    ? StatusStyle.color(BookingStatuses.staying)
                    : AppColors.textMuted,
                radius: 16,
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Duration Badge & Check-out Countdown
          HaciendaCard(
            color: AppColors.surfaceSunken,
            showBorder: false,
            shadows: const [],
            borderRadius: BorderRadius.circular(14),
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      DateFormatter.formatStayDuration(stay.checkInDate, stay.checkOutDate),
                      style: GoogleFonts.cinzel(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primaryForest,
                      ),
                    ),
                    Text(
                      isStayingNow
                          ? 'Check-out in $remainingHours hours'
                          : 'Check-in: ${DateFormatter.formatDate(stay.checkInDate)}',
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: isStayingNow ? AppColors.statusAlert : AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),

                // Stay Progress Bar (animates as the stay advances)
                LuxeProgress(
                  value: progress,
                  height: 8,
                  color: isStayingNow ? AppColors.statusSuccess : AppColors.primaryForest,
                ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      isStayingNow
                          ? 'Day $currentDay of ${stay.totalNights + 1} ($elapsedHours hrs elapsed)'
                          : '${stay.totalNights} Nights reservation',
                      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                    ),
                    Text(
                      '${(progress * 100).toInt()}%',
                      style: GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),

          // Date timeline
          Wrap(
            spacing: 8,
            runSpacing: 2,
            alignment: WrapAlignment.spaceBetween,
            children: [
              Text(
                'Check-in: ${DateFormatter.formatDate(stay.checkInDate)} (2:00 PM)',
                style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
              ),
              Text(
                'Check-out: ${DateFormatter.formatDate(stay.checkOutDate)} (12:00 PM)',
                style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
