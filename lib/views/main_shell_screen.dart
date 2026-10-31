import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:provider/provider.dart' as legacy;
import '../core/constants/app_constants.dart';
import '../core/theme/app_theme.dart';
import '../models/booking_model.dart';
import '../services/auth_store.dart';
import '../services/notification_contract.dart';
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
import 'bookings/booking_detail_screen.dart';
import 'bookings/bookings_screen.dart';
import 'bookings/payment_verification_queue_screen.dart';
import 'bookings/refund_management_screen.dart';
import 'inbox/inbox_screen.dart';
import 'notifications/notifications_screen.dart';
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
    NotificationService()
        .intentCoordinator
        .attachExecutor(_executePendingNotificationRoute);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _tutorial = ref.read(tutorialControllerProvider);
      _tutorial?.attachTabNavigator(_navigateToTab);
      TourBus.tab(_currentIndex);
      unawaited(_runFirstOpenPrompts());
    });
  }

  /// Requests the native phone notification permission once after the Admin
  /// first opens the unlocked app. Android/iOS owns the Allow/Don't allow dialog.
  Future<void> _runFirstOpenPrompts() async {
    final notifications = NotificationService();
    final wasRequested = await notifications.hasPromptedForPermission();
    final permission = await notifications.currentPermission();

    if (!mounted) return;
    if (!wasRequested &&
        permission == NotificationPermission.notAsked &&
        !notifications.intentCoordinator.hasPendingIntent) {
      await _askForNotificationPermission(context);
    }

    if (!mounted) return;
    await _tutorial?.maybeOfferTutorial();
  }

  @override
  void dispose() {
    NotificationService()
        .intentCoordinator
        .detachExecutor(_executePendingNotificationRoute);
    _tutorial?.detachTabNavigator(_navigateToTab);
    super.dispose();
  }

  /// Executes a validated notification destination strictly after `AuthGate`,
  /// Admin role verification, and `PinGateScreen` unlock have all succeeded.
  Future<void> _executePendingNotificationRoute(
    ValidatedNotificationPayload payload,
  ) async {
    if (!mounted) return;
    final auth = legacy.Provider.of<AuthStore>(context, listen: false);
    if (auth.isResolving || !auth.isAdmin || auth.uid == null) {
      return;
    }

    final rootNav = TourKeys.rootNavigator.currentState;
    if (rootNav == null) return;

    // Clear any open modal sheets or stacked detail routes so the destination
    // is never obscured and Back returns cleanly to MainShellScreen.
    rootNav.popUntil((route) => route.isFirst);
    if (!mounted) return;

    final dest = payload.destination;
    switch (dest) {
      case BookingDetailDestination(:final bookingId):
        _navigateToTab(1);
        await rootNav.push<void>(
          MaterialPageRoute(
            builder: (_) => BookingDetailScreen(bookingId: bookingId),
          ),
        );
      case PaymentVerificationQueueDestination():
        _navigateToTab(1);
        await rootNav.push<void>(
          MaterialPageRoute(
            builder: (_) => const PaymentVerificationQueueScreen(),
          ),
        );
      case RefundManagementDestination():
        _navigateToTab(1);
        await rootNav.push<void>(
          MaterialPageRoute(
            builder: (_) => const RefundManagementScreen(),
          ),
        );
      case ChatThreadDestination(
          :final conversationId,
          :final bookingId,
          :final guestUid,
        ):
        _navigateToTab(2);
        BookingModel? matched;
        final cachedBookings = ref.read(bookingsStreamProvider).valueOrNull;
        if (cachedBookings != null && bookingId != null) {
          for (final b in cachedBookings) {
            if (b.id == bookingId) {
              matched = b;
              break;
            }
          }
        }
        await rootNav.push<void>(
          MaterialPageRoute(
            builder: (_) => ThreadScreen(
              convoId: conversationId,
              guestUid: guestUid ?? matched?.uid ?? '',
              guestName: matched?.guestName ?? 'Guest',
              bookingId: bookingId ?? matched?.id,
              bookingReference: matched?.refId,
              propertyName: matched?.accommodation,
            ),
          ),
        );
      case SmartLockDestination():
        _navigateToTab(5);
      case NotificationsCenterDestination():
        _navigateToTab(0);
        await rootNav.push<void>(
          MaterialPageRoute(
            builder: (_) => const NotificationsScreen(),
          ),
        );
    }
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

  /// Requests the native phone notification permission and refreshes the
  /// Admin's FCM token. Once denied, Android/iOS requires changing permission
  /// in system settings rather than repeating the OS prompt indefinitely.
  Future<void> _askForNotificationPermission(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final service = NotificationService();
    final existing = await service.currentPermission();
    if (!context.mounted) return;

    var outcome = existing;
    if (existing == NotificationPermission.notAsked) {
      outcome = await service.requestPermission();
    } else if (existing == NotificationPermission.granted ||
        existing == NotificationPermission.provisional) {
      await service.refreshTokenRegistration();
    }

    if (!context.mounted) return;
    final String message;
    switch (outcome) {
      case NotificationPermission.granted:
      case NotificationPermission.provisional:
        message = 'Phone notifications are allowed on this device.';
      case NotificationPermission.denied:
        message =
            'Phone notifications are blocked. Re-enable them in Android Settings → Apps → Hacienda Admin → Notifications.';
      case NotificationPermission.unknown:
        message = 'This phone could not report notification permission status.';
      case NotificationPermission.notAsked:
        message = 'Phone notifications are not enabled yet.';
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
                      title: const Text('Phone notifications'),
                      subtitle: const Text('Manage this app’s phone notification permission'),
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
