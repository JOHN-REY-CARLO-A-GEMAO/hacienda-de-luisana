import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'core/theme/app_theme.dart';
import 'services/notification_service.dart';
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
    const ProviderScope(
      child: HaciendaClientApp(),
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
      home: const MainShellScreen(),
    );
  }
}
