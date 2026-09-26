import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart' as legacy;
import '../core/constants/app_constants.dart';
import '../services/auth_store.dart';
import '../providers/app_providers.dart';
import '../tutorial/tutorial_controller.dart';
import '../tutorial/tutorial_keys.dart';
import '../widgets/animated_badge.dart';
import '../widgets/animated_tab_page.dart';
import '../widgets/pressable_card.dart';
import '../widgets/section_header.dart';
import 'dashboard/dashboard_screen.dart';
import 'bookings/bookings_screen.dart';
import 'inbox/inbox_screen.dart';
import 'payments/payment_refs_screen.dart';
import 'stays/stay_duration_screen.dart';
import 'smartlock/smart_lock_screen.dart';
import 'analytics/analytics_screen.dart';
import 'rooms/rooms_screen.dart';
import 'crm/guest_crm_screen.dart';
import 'rates/rates_screen.dart';

class MainShellScreen extends ConsumerStatefulWidget {
  const MainShellScreen({super.key});

  @override
  ConsumerState<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends ConsumerState<MainShellScreen> {
  int _currentIndex = 0;
  TutorialController? _tutorial;

  void _navigateToTab(int index) {
    setState(() => _currentIndex = index);
    // The guided tour hears every tab change through the Bus, however it came
    // — bottom bar, dashboard shortcut, More sheet or the tour itself.
    TourBus.tab(index);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _tutorial = ref.read(tutorialControllerProvider);
      _tutorial?.attachTabNavigator(_navigateToTab);
      // Sync the current tab so the tour knows where the app already is.
      TourBus.tab(_currentIndex);
      // First launch as the Admin: offer the interactive guided tour.
      _tutorial?.maybeOfferTutorial();
    });
  }

  @override
  void dispose() {
    _tutorial?.detachTabNavigator(_navigateToTab);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final stats = ref.watch(dashboardStatsProvider);

    final List<Widget> screens = [
      AnimatedTabPage(
        isActive: _currentIndex == 0,
        child: DashboardScreen(onNavigateTab: _navigateToTab),
      ),
      AnimatedTabPage(isActive: _currentIndex == 1, child: const BookingsScreen()),
      AnimatedTabPage(isActive: _currentIndex == 2, child: const InboxScreen()),
      AnimatedTabPage(isActive: _currentIndex == 3, child: const StayDurationScreen()),
      AnimatedTabPage(isActive: _currentIndex == 4, child: const AnalyticsScreen()),
      AnimatedTabPage(isActive: _currentIndex == 5, child: const SmartLockScreen()),
      AnimatedTabPage(isActive: _currentIndex == 6, child: const RoomsScreen()),
      AnimatedTabPage(isActive: _currentIndex == 7, child: const GuestCrmScreen()),
      AnimatedTabPage(isActive: _currentIndex == 8, child: const RatesScreen()),
      AnimatedTabPage(isActive: _currentIndex == 9, child: const PaymentRefsScreen()),
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
          currentIndex: _currentIndex >= 4 ? 4 : _currentIndex,
          backgroundColor: AppColors.primaryDark,
          selectedItemColor: AppColors.accentGoldLight,
          unselectedItemColor: Colors.white.withOpacity(0.5),
          selectedLabelStyle: GoogleFonts.inter(fontSize: 10, fontWeight: FontWeight.bold),
          unselectedLabelStyle: GoogleFonts.inter(fontSize: 10),
          type: BottomNavigationBarType.fixed,
          elevation: 0,
          onTap: (index) {
            if (index == 4) {
              TourBus.event('more-opened');
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
                key: TourKeys.tabBookings,
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
              icon: Icon(Icons.chat_bubble_outline, key: TourKeys.tabChat),
              activeIcon: const Icon(Icons.chat_bubble),
              label: 'Chat',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.hourglass_bottom_outlined, key: TourKeys.tabStays),
              activeIcon: const Icon(Icons.hourglass_bottom),
              label: 'Stays',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.grid_view_rounded, key: TourKeys.tabMore),
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
        final auth = legacy.Provider.of<AuthStore>(context, listen: false);
        return SafeArea(
          child: SingleChildScrollView(
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
                  key: TourKeys.moreRates,
                  onTap: () {
                    TourBus.event('open-rates');
                    Navigator.pop(ctx);
                    _navigateToTab(8); // Rates
                  },
                  child: const ListTile(
                    leading: Icon(Icons.payments_outlined),
                    title: Text('Rates & Cancellation Policy'),
                    subtitle: Text('Publish the prices and refund terms the website quotes'),
                  ),
                ),
                PressableCard(
                  onTap: () {
                    Navigator.pop(ctx);
                    _navigateToTab(9);
                  },
                  child: const ListTile(
                    leading: Icon(Icons.receipt_long_outlined),
                    title: Text('Payment references'),
                    subtitle: Text('Valid GCash/bank refs — verify, never trust OCR alone'),
                  ),
                ),
                PressableCard(
                  key: TourKeys.moreSmartLock,
                  onTap: () {
                    TourBus.event('open-smartlock');
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
                const Divider(height: 20),
                ListTile(
                  leading: const Icon(Icons.school_outlined, color: AppColors.primaryForest),
                  title: const Text('Replay the guided tour'),
                  subtitle: const Text('An interactive walkthrough of the app’s screens'),
                  onTap: () {
                    Navigator.pop(ctx);
                    ref.read(tutorialControllerProvider).replay();
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.logout, color: AppColors.statusAlert),
                  title: const Text('Sign out'),
                  subtitle: Text(auth.sessionEmail ?? 'Admin session'),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await auth.signOut();
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
