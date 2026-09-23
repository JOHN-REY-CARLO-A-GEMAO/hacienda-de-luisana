import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/date_formatter.dart';
import '../../models/booking_model.dart';
import '../../providers/app_providers.dart';
import '../../services/notification_service.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/status_pill.dart';

class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  int _selectedFilterIndex = 0;

  final List<String> _filters = [
    'All',
    'Pending',
    'Confirmed',
    'Active Stay',
    'Completed',
    'Cancelled',
  ];

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingsStreamProvider);
    final firestoreService = ref.read(firestoreServiceProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Booking Management',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          Tooltip(
            message: 'Refresh bookings',
            child: IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => ref.invalidate(bookingsStreamProvider),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Tabs
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: List.generate(_filters.length, (index) {
                  final isSelected = _selectedFilterIndex == index;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(
                        _filters[index],
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                          color: isSelected ? Colors.white : AppColors.textDark,
                        ),
                      ),
                      selected: isSelected,
                      selectedColor: AppColors.primaryForest,
                      backgroundColor: AppColors.surfaceLight,
                      side: BorderSide(
                        color: isSelected ? AppColors.primaryForest : AppColors.cardBorder,
                      ),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                      onSelected: (val) {
                        if (val) setState(() => _selectedFilterIndex = index);
                      },
                    ),
                  );
                }),
              ),
            ),
          ),
          const Divider(height: 1, color: AppColors.cardBorder),

          // Live Stream List
          Expanded(
            child: bookingsAsync.when(
              data: (allBookings) {
                final filtered = allBookings.where((b) {
                  switch (_selectedFilterIndex) {
                    case 1:
                      return b.status == BookingStatus.pending;
                    case 2:
                      return b.status == BookingStatus.confirmed;
                    case 3:
                      return b.status == BookingStatus.checkedIn;
                    case 4:
                      return b.status == BookingStatus.completed;
                    case 5:
                      return b.status == BookingStatus.cancelled;
                    case 0:
                    default:
                      return true;
                  }
                }).toList();

                if (filtered.isEmpty) {
                  return const EmptyState(
                    icon: Icons.event_busy,
                    title: 'No bookings found',
                    subtitle: 'No reservations match the selected filter category.',
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (context, i) {
                    final booking = filtered[i];
                    return _buildBookingCard(booking, firestoreService);
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(child: Text('Error loading bookings: $err')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBookingCard(BookingModel booking, dynamic firestoreService) {
    Color statusColor;
    switch (booking.status) {
      case BookingStatus.pending:
        statusColor = AppColors.statusWarning;
        break;
      case BookingStatus.confirmed:
        statusColor = AppColors.statusSuccess;
        break;
      case BookingStatus.checkedIn:
        statusColor = const Color(0xFF1D3557);
        break;
      case BookingStatus.completed:
        statusColor = AppColors.textMuted;
        break;
      case BookingStatus.cancelled:
        statusColor = AppColors.statusAlert;
        break;
    }

    final isPending = booking.status == BookingStatus.pending;

    return HaciendaCard(
      padding: const EdgeInsets.zero,
      borderColor: isPending ? AppColors.statusWarning.withOpacity(0.4) : AppColors.cardBorder,
      borderWidth: isPending ? 1.5 : 1.0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Row
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: AppColors.primaryForest.withOpacity(0.1),
                  child: Text(
                    booking.guestName.isNotEmpty ? booking.guestName[0].toUpperCase() : 'G',
                    style: GoogleFonts.cinzel(
                      fontWeight: FontWeight.bold,
                      color: AppColors.primaryForest,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        booking.guestName,
                        style: GoogleFonts.inter(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textDark,
                        ),
                      ),
                      Text(
                        '${booking.guestPhone} · ${booking.guestEmail}',
                        style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                StatusPill(
                  label: booking.status.displayName,
                  color: statusColor,
                  radius: 20,
                ),
              ],
            ),
          ),

          // Stay Details & Badges
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: HaciendaCard(
              color: AppColors.surfaceLight,
              borderColor: null,
              shadows: const [],
              borderRadius: BorderRadius.circular(14),
              padding: const EdgeInsets.all(12),
              child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        booking.accommodation,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textDark,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.cardBorder),
                      ),
                      child: Text(
                        DateFormatter.formatStayDuration(booking.checkInDate, booking.checkOutDate),
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primaryForest,
                        ),
                        maxLines: 1,
                        softWrap: false,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.calendar_today, size: 12, color: AppColors.textMuted),
                    const SizedBox(width: 5),
                    Text(
                      DateFormatter.formatStayRange(booking.checkInDate, booking.checkOutDate),
                      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                    ),
                    const Spacer(),
                    const Icon(Icons.people_outline, size: 13, color: AppColors.textMuted),
                    const SizedBox(width: 4),
                    Text(
                      '${booking.guestCount} Guests',
                      style: GoogleFonts.inter(fontSize: 11, color: AppColors.textMuted),
                    ),
                  ],
                ),
                if (booking.specialRequests != null && booking.specialRequests!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Notes: ${booking.specialRequests!}',
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      fontStyle: FontStyle.italic,
                      color: AppColors.textDark.withOpacity(0.8),
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
            ),
          ),

          // Action Buttons Row
          Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(
              spacing: 8,
              runSpacing: 6,
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                // Call & SMS shortcuts
                IconButton(
                  icon: const Icon(Icons.phone_outlined, size: 18, color: AppColors.primaryForest),
                  tooltip: 'Call Guest',
                  onPressed: () => _launchUrl('tel:${booking.guestPhone.replaceAll(' ', '')}'),
                ),
                IconButton(
                  icon: const Icon(Icons.sms_outlined, size: 18, color: AppColors.primaryForest),
                  tooltip: 'Message Guest',
                  onPressed: () => _launchUrl('sms:${booking.guestPhone.replaceAll(' ', '')}'),
                ),

                // Status Transitions
                if (booking.status == BookingStatus.pending) ...[
                  ElevatedButton.icon(
                    onPressed: () async {
                      await firestoreService.updateBookingStatus(booking.id, BookingStatus.confirmed);
                      NotificationService().showNewBookingAlert(booking.guestName, booking.accommodation);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Reservation for ${booking.guestName} Confirmed!')),
                        );
                      }
                    },
                    icon: const Icon(Icons.check, size: 15),
                    label: const Text('Confirm'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.statusSuccess,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _showRejectDialog(booking, firestoreService),
                    icon: const Icon(Icons.close, size: 15, color: AppColors.statusAlert),
                    label: const Text('Reject', style: TextStyle(color: AppColors.statusAlert)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppColors.statusAlert),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    ),
                  ),
                ],

                if (booking.status == BookingStatus.confirmed) ...[
                  ElevatedButton.icon(
                    onPressed: () async {
                      await firestoreService.updateBookingStatus(booking.id, BookingStatus.checkedIn);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('${booking.guestName} marked as Checked-In!')),
                        );
                      }
                    },
                    icon: const Icon(Icons.door_front_door_outlined, size: 15),
                    label: const Text('Check-In Guest'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF1D3557),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    ),
                  ),
                ],

                if (booking.status == BookingStatus.checkedIn) ...[
                  ElevatedButton.icon(
                    onPressed: () async {
                      await firestoreService.updateBookingStatus(booking.id, BookingStatus.completed);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('${booking.guestName} Stay Completed!')),
                        );
                      }
                    },
                    icon: const Icon(Icons.task_alt, size: 15),
                    label: const Text('Complete Stay'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryForest,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showRejectDialog(BookingModel booking, dynamic firestoreService) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Cancel Reservation', style: GoogleFonts.cinzel(fontWeight: FontWeight.bold)),
        content: Text('Are you sure you want to cancel the booking request for ${booking.guestName}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Dismiss'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.statusAlert),
            onPressed: () async {
              Navigator.pop(ctx);
              await firestoreService.updateBookingStatus(booking.id, BookingStatus.cancelled);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Booking for ${booking.guestName} Cancelled.')),
                );
              }
            },
            child: const Text('Confirm Cancel'),
          ),
        ],
      ),
    );
  }

  Future<void> _launchUrl(String urlString) async {
    final uri = Uri.parse(urlString);
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
      }
    } catch (_) {}
  }
}
