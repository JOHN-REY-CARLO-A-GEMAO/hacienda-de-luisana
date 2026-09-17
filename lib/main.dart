import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import 'theme/app_theme.dart';
import 'services/auth_store.dart';
import 'services/booking_store.dart';
import 'services/cloud_bookings.dart';
import 'services/esp32_service.dart';
import 'screens/admin_bookings_screen.dart';
import 'screens/admin_tracking_screen.dart';
import 'screens/admin_records_screen.dart';
import 'screens/owner_login_screen.dart';

/// Hacienda de LuisAna — OWNER APP, Android only (no iOS work).
///
/// First launch: 1-tap Google sign-in (anak email hint), stays signed-in.
/// Tabs: Bookings (anak = view-only triage) / Tracking (pickup -> drop-off) /
/// Records (smart-lock SIM mode until hardware arrives).
/// Bookers use the website /book; this APK is owner-side only.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthStore()),
        ChangeNotifierProvider(create: (_) => BookingStore()),
        Provider(create: (_) => CloudBookings()),
        ChangeNotifierProvider(create: (_) => Esp32Service()),
      ],
      child: const HaciendaOwnerApp(),
    ),
  );
}

class HaciendaOwnerApp extends StatelessWidget {
  const HaciendaOwnerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hacienda Owner',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const OwnerShell(),
    );
  }
}

class OwnerShell extends StatefulWidget {
  final int initialTab;
  const OwnerShell({super.key, this.initialTab = 0});

  @override
  State<OwnerShell> createState() => _OwnerShellState();
}

class _OwnerShellState extends State<OwnerShell> {
  late int _currentIndex;
  bool _attached = false;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialTab;
    // Owner mode: attach cloud in ALL-bookings mode (not uid-scoped).
    // Before login this runs anonymous (read denied until Google session);
    // after login OwnerLoginScreen re-attaches with the email token.
    Future.microtask(() => _attachOwner());
  }

  Future<void> _attachOwner() async {
    if (!mounted || _attached) return;
    _attached = true;
    try {
      final auth = context.read<AuthStore>();
      final anonUid = await auth.ensureAnonUid();
      if (!mounted) return;
      final cloud = context.read<CloudBookings>();
      final store = context.read<BookingStore>();
      await store.attachOwnerCloud(cloud, anonUid: anonUid);
      if (!mounted) return;
      store.setOwnerSession(auth.isOwner);
    } catch (_) {
      // Local-only mode — screens reflect this.
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthStore>();

    // Gate: no Google session yet → login screen.
    if (!auth.isSignedInGoogle) {
      return const OwnerLoginScreen();
    }

    // Gate: signed in but not allowlisted → not authorized.
    if (!auth.isAuthorizedRole) {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Not authorized',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.cormorantGaramond(
                        fontSize: 30,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.forest900)),
                const SizedBox(height: 8),
                Text(
                  '${auth.sessionEmail ?? 'This account'} is not an owner/anak account on this property.',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(
                      fontSize: 13,
                      color: AppTheme.forest800.withOpacity(0.7)),
                ),
                const SizedBox(height: 20),
                OutlinedButton.icon(
                  onPressed: () => auth.signOutGoogle(),
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // Keep owner flag fresh (e.g. owner logs in after anak).
    final store = context.read<BookingStore>();
    if (store.isOwnerSession != auth.isOwner) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        store.setOwnerSession(auth.isOwner);
      });
    }

    final roleLabel = auth.isOwner ? 'Owner' : 'View only · Anak';
    const screens = [
      AdminBookingsScreen(),
      AdminTrackingScreen(),
      AdminRecordsScreen(),
    ];

    return Scaffold(
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(40),
        child: AppBar(
          automaticallyImplyLeading: false,
          titleSpacing: 16,
          title: Text(roleLabel,
              style: GoogleFonts.inter(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.4)),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(auth.sessionEmail ?? '',
                      style: GoogleFonts.inter(fontSize: 11)),
                  IconButton(
                    tooltip: 'Sign out',
                    icon: const Icon(Icons.logout, size: 18),
                    onPressed: () => auth.signOutGoogle(),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: IndexedStack(
        index: _currentIndex,
        children: screens,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (i) => setState(() => _currentIndex = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.inbox_outlined),
            selectedIcon: Icon(Icons.inbox),
            label: 'Bookings',
          ),
          NavigationDestination(
            icon: Icon(Icons.delivery_dining_outlined),
            selectedIcon: Icon(Icons.delivery_dining),
            label: 'Tracking',
          ),
          NavigationDestination(
            icon: Icon(Icons.lock_outline),
            selectedIcon: Icon(Icons.lock),
            label: 'Records',
          ),
        ],
      ),
    );
  }
}
