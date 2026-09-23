import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/constants/app_constants.dart';
import '../providers/app_providers.dart';
import '../widgets/animated_badge.dart';
import '../widgets/animated_tab_page.dart';
import '../widgets/pressable_card.dart';
import '../widgets/section_header.dart';
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
      AnimatedTabPage(
        isActive: _currentIndex == 0,
        child: DashboardScreen(onNavigateTab: _navigateToTab),
      ),
      AnimatedTabPage(isActive: _currentIndex == 1, child: const BookingsScreen()),
      AnimatedTabPage(isActive: _currentIndex == 2, child: const TrackingRadarScreen()),
      AnimatedTabPage(isActive: _currentIndex == 3, child: const StayDurationScreen()),
      AnimatedTabPage(isActive: _currentIndex == 4, child: const AnalyticsScreen()),
      AnimatedTabPage(isActive: _currentIndex == 5, child: const SmartLockScreen()),
      AnimatedTabPage(isActive: _currentIndex == 6, child: const RoomsScreen()),
      AnimatedTabPage(isActive: _currentIndex == 7, child: const GuestCrmScreen()),
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
                  Positioned(
                    top: -4,
                    right: -6,
                    child: AnimatedBadge(count: stats.pendingRequests),
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
                  Positioned(
                    top: -3,
                    right: -4,
                    child: AnimatedScale(
                      scale: approachingGuest != null ? 1.0 : 0.0,
                      duration: const Duration(milliseconds: 250),
                      curve: Curves.easeOutBack,
                      child: AnimatedOpacity(
                        opacity: approachingGuest != null ? 1.0 : 0.0,
                        duration: const Duration(milliseconds: 180),
                        child: Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(
                            color: AppColors.statusSuccess,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
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
            padding: const EdgeInsets.fromLTRB(12, 16, 12, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.cardBorder,
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const SectionHeader(
                  title: 'Resort operations & tools',
                  padding: EdgeInsets.symmetric(horizontal: 8),
                ),
                const SizedBox(height: 4),
                PressableCard(
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(5); // Smart lock
                  },
                  child: const ListTile(
                    leading: Icon(Icons.lock_clock_rounded),
                    title: Text('Smart Lock Security Logs'),
                    subtitle: Text('Real-time door access audit trail & simulator'),
                  ),
                ),
                PressableCard(
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(4); // Analytics
                  },
                  child: const ListTile(
                    leading: Icon(Icons.analytics_outlined),
                    title: Text('Revenue & Stay Analytics'),
                    subtitle: Text('Financial charts, KPIs & occupancy breakdown'),
                  ),
                ),
                PressableCard(
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(6); // Rooms
                  },
                  child: const ListTile(
                    leading: Icon(Icons.hotel_outlined),
                    title: Text('Rooms & Accommodations'),
                    subtitle: Text('Manage status (Available/Occupied) & pricing'),
                  ),
                ),
                PressableCard(
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(7); // CRM
                  },
                  child: const ListTile(
                    leading: Icon(Icons.people_outline),
                    title: Text('Guest CRM & History'),
                    subtitle: Text('Past guest lookups, VIP badges & preferences'),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
