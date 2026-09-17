import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../services/auth_store.dart';
import '../services/booking_store.dart';
import '../services/cloud_bookings.dart';
import '../theme/app_theme.dart';

/// Owner APK gate (Android only). First launch: 1-tap Google sign-in with the
/// anak email hint pre-filled. Stays signed-in via Firebase persistence.
/// Unauthorized emails see "Not authorized" + Sign out.
class OwnerLoginScreen extends StatefulWidget {
  const OwnerLoginScreen({super.key});

  @override
  State<OwnerLoginScreen> createState() => _OwnerLoginScreenState();
}

class _OwnerLoginScreenState extends State<OwnerLoginScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthStore>().signInAnak();
      if (!mounted) return;
      // Session now carries the email token — re-attach owner stream so
      // watchAllBookings() passes isAdmin()/isAnak() instead of denied.
      await context
          .read<BookingStore>()
          .attachOwnerCloud(context.read<CloudBookings>());
    } on AuthException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Sign-in failed. Retry.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: AppTheme.forestDeep,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.lock_person,
                    color: AppTheme.goldSoft, size: 32),
              ),
              const SizedBox(height: 20),
              Text('Hacienda Owner',
                  style: GoogleFonts.cormorantGaramond(
                      fontSize: 34,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.forest900)),
              const SizedBox(height: 6),
              Text('Sign in to view bookings, tracking and lock records.',
                  style: GoogleFonts.inter(
                      fontSize: 13,
                      color: AppTheme.forest800.withOpacity(0.7))),
              const SizedBox(height: 24),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: AppTheme.cream100,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: AppTheme.forest900.withOpacity(0.12)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.account_circle_outlined,
                        color: AppTheme.forest800),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Continue as',
                              style: GoogleFonts.inter(
                                  fontSize: 11,
                                  color: AppTheme.forest800
                                      .withOpacity(0.6))),
                          Text(AuthStore.kAnakEmail,
                              style: GoogleFonts.inter(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.forest900)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(_error!,
                      style: GoogleFonts.inter(
                          fontSize: 12, color: Colors.red.shade900)),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                height: 52,
                child: ElevatedButton.icon(
                  onPressed: _busy ? null : _signIn,
                  icon: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child:
                              CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.login, size: 20),
                  label: Text(_busy
                      ? 'Signing in…'
                      : 'Continue with Google'),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Stays signed-in on this device. View-only for anak; '
                'full confirm rights for the owner email.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                    fontSize: 11,
                    color:
                        AppTheme.forest800.withOpacity(0.55)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
