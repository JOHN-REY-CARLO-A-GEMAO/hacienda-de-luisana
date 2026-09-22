import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart' as legacy;
import 'core/theme/app_theme.dart';
import 'services/auth_store.dart';
import 'services/booking_store.dart';
import 'services/cloud_bookings.dart';
import 'services/notification_service.dart';
import 'screens/owner_login_screen.dart';
import 'views/main_shell_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Initialize Local Notifications
  try {
    await NotificationService().initialize();
  } catch (_) {}

  // 2. Safe Firebase initialization (gracefully bypasses when unconfigured in local dev)
  try {
    await Firebase.initializeApp();
  } catch (_) {}

  runApp(
    ProviderScope(
      child: legacy.MultiProvider(
        providers: [
          legacy.ChangeNotifierProvider(create: (_) => AuthStore()),
          legacy.ChangeNotifierProvider(create: (_) => BookingStore()),
          legacy.Provider(create: (_) => CloudBookings()),
        ],
        child: const HaciendaClientApp(),
      ),
    ),
  );
}

class HaciendaClientApp extends StatelessWidget {
  const HaciendaClientApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Hacienda de LuisAna - Client App',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: const AuthGate(),
    );
  }
}

/// First screen of the app: the auth gate.
///
/// Signed-out (or non-allowlisted) sessions see [OwnerLoginScreen]; an
/// authorized owner/anak session forwards into [MainShellScreen] and
/// attaches the owner cloud stream once per session.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _cloudAttached = false;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthStore>();
    if (!auth.isAuthorizedRole) {
      _cloudAttached = false;
      return const OwnerLoginScreen();
    }
    if (!_cloudAttached) {
      _cloudAttached = true;
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) return;
        final store = context.read<BookingStore>();
        store.setOwnerSession(auth.isOwner);
        try {
          await store.attachOwnerCloud(context.read<CloudBookings>());
        } catch (_) {}
      });
    }
    return const MainShellScreen();
  }
}
