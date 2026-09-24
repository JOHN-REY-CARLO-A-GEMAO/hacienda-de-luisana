import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart' as legacy;
import 'core/theme/app_theme.dart';
import 'firebase_options.dart';
import 'services/auth_store.dart';
import 'services/notification_service.dart';
import 'views/auth/admin_login_screen.dart';
import 'views/main_shell_screen.dart';

/// Hacienda de LuisAna — **Admin** mobile app.
///
/// One of the two applications in the system (ADR-0007): the Admin runs the
/// whole operation from here — bookings and their lifecycle, KYC and payment
/// review, refunds, rates, stays, guest arrival radar, smart-lock logs, rooms,
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
      home: const AuthGate(),
    );
  }
}

/// First screen of the app: the auth gate.
///
/// Signed-out (or non-Admin) sessions see [AdminLoginScreen]; the Admin goes
/// straight into [MainShellScreen].
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

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
