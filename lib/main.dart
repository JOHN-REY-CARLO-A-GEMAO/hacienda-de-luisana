import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart' as legacy;
import 'core/theme/app_theme.dart';
import 'firebase_options.dart';
import 'providers/app_providers.dart';
import 'services/auth_store.dart';
import 'services/notification_service.dart';
import 'tutorial/tutorial_keys.dart';
import 'views/auth/admin_login_screen.dart';
import 'views/main_shell_screen.dart';

/// Hacienda de LuisAna — **Admin** mobile app.
///
/// One of the two applications in the system (ADR-0007): the Admin runs the
/// whole operation from here — bookings and their lifecycle, payment
/// review, refunds, rates, stays, guest chat, smart-lock logs, rooms,
/// CRM and analytics. Guests never use this app; they book on the website.
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Local notifications (new booking / approaching guest alerts).
  try {
    await NotificationService().initialize();
  } catch (_) {}

  // 2. Firebase — gracefully bypassed when unconfigured in local dev, in which
  //    case every screen runs on the in-memory demo data.
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (_) {
    try {
      // google-services.json present but no generated options: let the
      // Android plugin pick the defaults up.
      await Firebase.initializeApp();
    } catch (_) {}
  }

  runApp(
    ProviderScope(
      child: legacy.ChangeNotifierProvider(
        create: (_) => AuthStore(),
        child: const HaciendaAdminApp(),
      ),
    ),
  );
}

class HaciendaAdminApp extends StatelessWidget {
  const HaciendaAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hacienda de LuisAna — Admin',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      // The guided tour floats its spotlight through this navigator's overlay
      // and steps between rooms by popping routes it did not open.
      navigatorKey: TourKeys.rootNavigator,
      navigatorObservers: [TourKeys.routeObserver],
      home: const AuthGate(),
    );
  }
}

/// First screen of the app: the auth gate.
///
/// Signed-out (or non-Admin) sessions see [AdminLoginScreen]; the Admin goes
/// straight into [MainShellScreen].
///
/// It is also the boundary of "signed in" for the Security gate (ADR-0015):
/// an observer wipes the PIN ticket the moment the app is backgrounded, so
/// a session left on the table re-asks the PIN after the next suspension —
/// the same line signing out draws, short of actually signing out.
class AuthGate extends ConsumerStatefulWidget {
  const AuthGate({super.key});

  @override
  ConsumerState<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends ConsumerState<AuthGate>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      ref.read(pinGateProvider).clearTicket();
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthStore>();
    if (auth.isResolving) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (!auth.isAdmin) return const AdminLoginScreen();
    return const MainShellScreen();
  }
}
