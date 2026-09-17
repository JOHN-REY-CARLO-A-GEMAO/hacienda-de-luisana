import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/constants/app_constants.dart';
import '../providers/app_providers.dart';
import 'dashboard/dashboard_screen.dart';
import 'bookings/bookings_screen.dart';
import 'tracking/tracking_radar_screen.dart';
import 'stays/stay_duration_screen.dart';
import 'smartlock/smart_lock_screen.dart';
import 'analytics/analytics_screen.dart';
import 'rooms/rooms_screen.dart';
import 'crm/guest_crm_screen.dart';

class MainShellScreen extends ConsumerStatefulWidget {
  const MainShellScreen({super.key});

  @override
  ConsumerState<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends ConsumerState<MainShellScreen> {
  int _currentIndex = 0;

  void _navigateToTab(int index) {
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    final approachingGuest = ref.watch(approachingGuestProvider);
    final stats = ref.watch(dashboardStatsProvider);

    final List<Widget> screens = [
      DashboardScreen(onNavigateTab: _navigateToTab),
      const BookingsScreen(),
      const TrackingRadarScreen(),
      const StayDurationScreen(),
      const AnalyticsScreen(),
      const SmartLockScreen(),
      const RoomsScreen(),
      const GuestCrmScreen(),
    ];

    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: screens,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppColors.primaryDark,
          border: Border(top: BorderSide(color: Colors.white.withOpacity(0.1))),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.15),
              blurRadius: 10,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex >= 5 ? 0 : _currentIndex,
          backgroundColor: AppColors.primaryDark,
          selectedItemColor: AppColors.accentGoldLight,
          unselectedItemColor: Colors.white.withOpacity(0.5),
          selectedLabelStyle: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold),
          unselectedLabelStyle: GoogleFonts.inter(fontSize: 10),
          type: BottomNavigationBarType.fixed,
          elevation: 0,
          onTap: (index) {
            if (index == 4) {
              _showMoreModal(context);
            } else {
              _navigateToTab(index);
            }
          },
          items: [
            const BottomNavigationBarItem(
              icon: Icon(Icons.home_outlined),
              activeIcon: Icon(Icons.home),
              label: 'Dashboard',
            ),
            BottomNavigationBarItem(
              icon: Stack(
                clipBehavior: Clip.none,
                children: [
                  const Icon(Icons.confirmation_number_outlined),
                  if (stats.pendingRequests > 0)
                    Positioned(
                      top: -4,
                      right: -6,
                      child: Container(
                        padding: const EdgeInsets.all(3),
                        decoration: const BoxDecoration(color: AppColors.statusAlert, shape: BoxShape.circle),
                        child: Text(
                          '${stats.pendingRequests}',
                          style: const TextStyle(fontSize: 8, color: Colors.white, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                ],
              ),
              activeIcon: const Icon(Icons.confirmation_number),
              label: 'Bookings',
            ),
            BottomNavigationBarItem(
              icon: Stack(
                clipBehavior: Clip.none,
                children: [
                  const Icon(Icons.radar_outlined),
                  if (approachingGuest != null)
                    Positioned(
                      top: -3,
                      right: -4,
                      child: Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(color: AppColors.statusSuccess, shape: BoxShape.circle),
                      ),
                    ),
                ],
              ),
              activeIcon: const Icon(Icons.radar),
              label: 'Radar',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.hourglass_bottom_outlined),
              activeIcon: Icon(Icons.hourglass_bottom),
              label: 'Stays',
            ),
            const BottomNavigationBarItem(
              icon: Icon(Icons.grid_view_rounded),
              label: 'More',
            ),
          ],
        ),
      ),
    );
  }

  void _showMoreModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'RESORT OPERATIONS & TOOLS',
                  style: GoogleFonts.inter(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.8,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  leading: const Icon(Icons.lock_clock_rounded, color: AppColors.primaryForest),
                  title: const Text('Smart Lock Security Logs'),
                  subtitle: const Text('Real-time door access audit trail & simulator'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(5); // Smart lock
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.analytics_outlined, color: AppColors.primaryForest),
                  title: const Text('Revenue & Stay Analytics'),
                  subtitle: const Text('Financial charts, KPIs & occupancy breakdown'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(4); // Analytics
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.hotel_outlined, color: AppColors.primaryForest),
                  title: const Text('Rooms & Accommodations'),
                  subtitle: const Text('Manage status (Available/Occupied) & pricing'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(6); // Rooms
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.people_outline, color: AppColors.primaryForest),
                  title: const Text('Guest CRM & History'),
                  subtitle: const Text('Past guest lookups, VIP badges & preferences'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(7); // CRM
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
