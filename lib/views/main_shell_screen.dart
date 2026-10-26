import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:provider/provider.dart' as legacy;
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';
import '../services/auth_store.dart';
import '../services/notification_service.dart';
import '../providers/app_providers.dart';
import 'security/secure_action_sheet.dart';
import 'security/setup_pin_sheet.dart';
import '../tutorial/tutorial_controller.dart';
import '../tutorial/tutorial_keys.dart';
import '../widgets/admin_ui.dart';
import '../widgets/animated_badge.dart';
import '../widgets/animated_tab_page.dart';
import '../widgets/hacienda_card.dart';
import 'dashboard/dashboard_screen.dart';
import 'bookings/bookings_screen.dart';
import 'inbox/inbox_screen.dart';
import 'payments/payment_refs_screen.dart';
import 'reviews/reviews_screen.dart';
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
      TourBus.tab(_currentIndex);
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
    final wide = MediaQuery.sizeOf(context).width >= AppTheme.navigationBreakpoint;

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
      AnimatedTabPage(isActive: _currentIndex == 10, child: const ReviewsScreen()),
    ];

    return Scaffold(
      body: Row(
        children: [
          if (wide) _buildNavigationRail(stats),
          Expanded(
            child: IndexedStack(
              index: _currentIndex,
              children: screens,
            ),
          ),
        ],
      ),
      bottomNavigationBar: wide ? null : _buildBottomNavigation(stats),
    );
  }

  Widget _buildNavigationRail(DashboardStats stats) {
    final selected = _currentIndex >= 5 ? 5 : _currentIndex;
    return SizedBox(
      key: TourKeys.bottomNav,
      child: NavigationRail(
        selectedIndex: selected,
        minWidth: 82,
        labelType: NavigationRailLabelType.all,
        groupAlignment: -0.15,
        onDestinationSelected: (index) {
          if (index == 5) {
            TourBus.event('more-opened');
            _showMoreModal(context);
          } else {
            _navigateToTab(index);
          }
        },
        destinations: [
          const NavigationRailDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: Text('Dashboard'),
          ),
          NavigationRailDestination(
            icon: Stack(
              key: TourKeys.tabBookings,
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.confirmation_number_outlined),
                Positioned(
                  top: -5,
                  right: -7,
                  child: AnimatedBadge(count: stats.pendingRequests),
                ),
              ],
            ),
            selectedIcon: const Icon(Icons.confirmation_number),
            label: const Text('Bookings'),
          ),
          NavigationRailDestination(
            icon: Icon(Icons.chat_bubble_outline, key: TourKeys.tabChat),
            selectedIcon: const Icon(Icons.chat_bubble),
            label: const Text('Chat'),
          ),
          NavigationRailDestination(
            icon: Icon(Icons.hourglass_bottom_outlined, key: TourKeys.tabStays),
            selectedIcon: const Icon(Icons.hourglass_bottom),
            label: const Text('Stays'),
          ),
          const NavigationRailDestination(
            icon: Icon(Icons.analytics_outlined),
            selectedIcon: Icon(Icons.analytics),
            label: Text('Analytics'),
          ),
          NavigationRailDestination(
            icon: Icon(Icons.grid_view_rounded, key: TourKeys.tabMore),
            label: const Text('More'),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomNavigation(DashboardStats stats) {
    return Container(
      key: TourKeys.bottomNav,
      decoration: const BoxDecoration(
        color: AppColors.primaryDark,
        border: Border(top: BorderSide(color: AppColors.accentGold, width: 0.8)),
      ),
      child: BottomNavigationBar(
        currentIndex: _currentIndex >= 4 ? 4 : _currentIndex,
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
    );
  }

  /// Ask Android for notifications, out loud, and then say what it decided.
  Future<void> _askForNotificationPermission(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final outcome = await NotificationService().requestPermission();
    final String message;
    switch (outcome) {
      case NotificationPermission.granted:
        message =
            'Alerts are on. This device will tell you about a new Booking or a refused door.';
      case NotificationPermission.denied:
        message =
            'Notifications are turned off for this app, so nothing will interrupt you. You can turn them on in Android Settings, then Apps, then Hacienda Admin, then Notifications.';
      case NotificationPermission.unknown:
        message =
            'This device did not answer the request. Alerts stay off until it does.';
      case NotificationPermission.notAsked:
        message = 'This platform does not ask for notification permission.';
    }
    messenger.showMaterialBanner(MaterialBanner(
      content: Text(message, style: AppTheme.body(fontSize: 13)),
      backgroundColor: AppColors.cardSurface,
      actions: [
        TextButton(
          onPressed: messenger.hideCurrentMaterialBanner,
          child: const Text('Dismiss'),
        ),
      ],
    ));
  }

  void _showMoreModal(BuildContext context) {
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);

    final daily = <_MoreDestination>[
      _MoreDestination(
        title: 'Revenue & stays',
        subtitle: 'Financial KPIs and occupancy breakdown',
        icon: Icons.analytics_outlined,
        tabIndex: 4,
      ),
      _MoreDestination(
        title: 'Smart lock logs',
        subtitle: 'Real-time door audit trail and simulator',
        icon: Icons.lock_clock_outlined,
        tabIndex: 5,
        key: TourKeys.moreSmartLock,
        tourEvent: 'open-smartlock',
      ),
      _MoreDestination(
        title: 'Accommodation status',
        subtitle: 'Record availability, occupancy or maintenance',
        icon: Icons.hotel_outlined,
        tabIndex: 6,
      ),
      _MoreDestination(
        title: 'Guest CRM',
        subtitle: 'Past guest history, VIP notes and preferences',
        icon: Icons.people_outline,
        tabIndex: 7,
      ),
      _MoreDestination(
        title: 'Guest reviews',
        subtitle: 'Respond, moderate and publish post-stay reviews',
        icon: Icons.rate_review_outlined,
        tabIndex: 10,
      ),
    ];

    final publishing = <_MoreDestination>[
      _MoreDestination(
        title: 'Rates & cancellation policy',
        subtitle: 'Publish the prices and refund terms the website quotes',
        icon: Icons.payments_outlined,
        tabIndex: 8,
        key: TourKeys.moreRates,
        tourEvent: 'open-rates',
      ),
      _MoreDestination(
        title: 'Payment references',
        subtitle: 'Verify valid references; never trust OCR alone',
        icon: Icons.receipt_long_outlined,
        tabIndex: 9,
      ),
    ];

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      constraints: BoxConstraints(
        maxWidth: 560,
        maxHeight: MediaQuery.sizeOf(context).height * 0.88,
      ),
      builder: (sheetContext) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('More tools', style: AppTheme.display(fontSize: 22)),
                    const SizedBox(height: 3),
                    Text(
                      auth.sessionEmail ?? 'Admin session',
                      style: AppTheme.body(fontSize: 12, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              const AdminSectionHeading(title: 'Daily operations'),
              for (final destination in daily)
                _MoreTile(
                  destination: destination,
                  onTap: () {
                    if (destination.tourEvent != null) {
                      TourBus.event(destination.tourEvent!);
                    }
                    Navigator.pop(sheetContext);
                    _navigateToTab(destination.tabIndex);
                  },
                ),
              const SizedBox(height: 12),
              const AdminSectionHeading(title: 'Publishing & verification'),
              for (final destination in publishing)
                _MoreTile(
                  destination: destination,
                  onTap: () {
                    if (destination.tourEvent != null) {
                      TourBus.event(destination.tourEvent!);
                    }
                    Navigator.pop(sheetContext);
                    _navigateToTab(destination.tabIndex);
                  },
                ),
              const SizedBox(height: 12),
              const AdminSectionHeading(title: 'Account'),
              HaciendaCard(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(
                  children: [
                    ListTile(
                      leading: const Icon(Icons.school_outlined),
                      title: const Text('Replay the guided tour'),
                      subtitle: const Text('Walk through the Admin app again'),
                      onTap: () {
                        Navigator.pop(sheetContext);
                        ref.read(tutorialControllerProvider).replay();
                      },
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.shield_outlined),
                      title: const Text('Change Security PIN'),
                      subtitle: const Text('Required before approvals and publishes'),
                      onTap: () {
                        Navigator.pop(sheetContext);
                        showChangePinSheet(context);
                      },
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.notifications_active_outlined),
                      title: const Text('Booking & door alerts'),
                      subtitle: const Text('Choose whether Android interrupts you'),
                      onTap: () async {
                        Navigator.pop(sheetContext);
                        await _askForNotificationPermission(context);
                      },
                    ),
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(
                        Icons.logout,
                        color: AppColors.statusAlert,
                      ),
                      title: Text(
                        'Sign out',
                        style: AppTheme.title(
                          fontSize: 15,
                          color: AppColors.statusAlert,
                        ),
                      ),
                      subtitle: Text(auth.sessionEmail ?? 'End this Admin session'),
                      onTap: () async {
                        Navigator.pop(sheetContext);
                        final ok = await showSecureConfirm(
                          context,
                          title: 'Sign out?',
                          body:
                              'The session ends and the Security PIN is asked for again on return.',
                          confirm: 'Sign out',
                          danger: true,
                        );
                        if (!ok) return;
                        await auth.signOut();
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MoreDestination {
  final String title;
  final String subtitle;
  final IconData icon;
  final int tabIndex;
  final Key? key;
  final String? tourEvent;

  const _MoreDestination({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.tabIndex,
    this.key,
    this.tourEvent,
  });
}

class _MoreTile extends StatelessWidget {
  final _MoreDestination destination;
  final VoidCallback onTap;

  const _MoreTile({required this.destination, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Semantics(
        button: true,
        label: '${destination.title}. ${destination.subtitle}',
        child: HaciendaCard(
          key: destination.key,
          padding: EdgeInsets.zero,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppTheme.radiusCard),
            onTap: onTap,
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              leading: Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.sageMist,
                  borderRadius: BorderRadius.circular(AppTheme.radiusPanel),
                ),
                child: Icon(destination.icon, size: 20, color: AppColors.primaryForest),
              ),
              title: Text(destination.title),
              subtitle: Text(destination.subtitle),
              trailing: const Icon(Icons.chevron_right, size: 19),
            ),
          ),
        ),
      ),
    );
  }
}
