import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../../services/auth_store.dart';
import '../../services/booking_store.dart';
import '../../services/cloud_bookings.dart';
import '../../core/theme/app_theme.dart';
import '../../utils/validators.dart';
import '../../widgets/staggered_entrance.dart';

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
  bool _obscure = true;
  late final TextEditingController _email =
      TextEditingController(text: AuthStore.kAnakEmail);
  final TextEditingController _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _checkAllowlistAndEnter() async {
    final auth = context.read<AuthStore>();
    // Only the allowlisted owner/anak emails may use this APK. Anyone
    // else is signed straight back out with a "Not authorized" message.
    if (!auth.isAuthorizedRole) {
      final email = auth.sessionEmail ?? 'unknown email';
      await auth.signOutGoogle();
      throw AuthException(
          'Not authorized ($email). This app is for the hacienda owner only.');
    }
    // Session now carries the email token — re-attach owner stream so
    // watchAllBookings() passes isAdmin()/isAnak() instead of denied.
    await context
        .read<BookingStore>()
        .attachOwnerCloud(context.read<CloudBookings>());
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = context.read<AuthStore>();
      await auth.signInAnak();
      if (!mounted) return;
      await _checkAllowlistAndEnter();
    } on AuthException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Sign-in failed. Retry.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signInEmail() async {
    final emailErr = Validators.email(_email.text);
    final passErr = Validators.password(_password.text);
    if (emailErr != null || passErr != null) {
      setState(() => _error = emailErr ?? passErr);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = context.read<AuthStore>();
      await auth.signInOwnerEmail(
          email: _email.text.trim(), password: _password.text);
      if (!mounted) return;
      await _checkAllowlistAndEnter();
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
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    StaggeredEntrance(
                      index: 0,
                      child: Container(
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
                    ),
                    const SizedBox(height: 20),
                    StaggeredEntrance(
                      index: 1,
                      child: Text('Hacienda Owner',
                          style: GoogleFonts.cormorantGaramond(
                              fontSize: 34,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.forest900)),
                    ),
                    const SizedBox(height: 6),
                    StaggeredEntrance(
                      index: 2,
                      child: Text('Sign in to view bookings, tracking and lock records.',
                          style: GoogleFonts.inter(
                              fontSize: 13,
                              color: AppTheme.forest800.withOpacity(0.7))),
                    ),
                    const SizedBox(height: 24),
                    StaggeredEntrance(
                      index: 3,
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: _busy ? null : _signIn,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 14, vertical: 12),
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
                                const Icon(Icons.arrow_forward_ios,
                                    size: 14, color: AppTheme.forest800),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      StaggeredEntrance(
                        index: 4,
                        child: Container(
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
                      ),
                    ],
                    const SizedBox(height: 16),
                    StaggeredEntrance(
                      index: 5,
                      child: SizedBox(
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
                          label: Text(
                              _busy ? 'Signing in…' : 'Continue with Google'),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    StaggeredEntrance(
                      index: 6,
                      child: Row(
                        children: [
                          const Expanded(child: Divider()),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            child: Text('or use owner password',
                                style: GoogleFonts.inter(
                                    fontSize: 11,
                                    color: AppTheme.forest800.withOpacity(0.55))),
                          ),
                          const Expanded(child: Divider()),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    StaggeredEntrance(
                      index: 7,
                      child: TextField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        enabled: !_busy,
                        decoration: const InputDecoration(
                          labelText: 'Owner email',
                          prefixIcon: Icon(Icons.mail_outlined),
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    StaggeredEntrance(
                      index: 8,
                      child: TextField(
                        controller: _password,
                        obscureText: _obscure,
                        enabled: !_busy,
                        onSubmitted: (_) => _signInEmail(),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.key_outlined),
                          border: const OutlineInputBorder(),
                          suffixIcon: Tooltip(
                            message:
                                _obscure ? 'Show password' : 'Hide password',
                            child: IconButton(
                              icon: Icon(_obscure
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined),
                              onPressed:
                                  () => setState(() => _obscure = !_obscure),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    StaggeredEntrance(
                      index: 9,
                      child: SizedBox(
                        height: 52,
                        child: OutlinedButton.icon(
                          onPressed: _busy ? null : _signInEmail,
                          icon: const Icon(Icons.login, size: 20),
                          label: const Text('Sign in with email'),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    StaggeredEntrance(
                      index: 10,
                      child: Text(
                      'Google button needs the new app ID registered in the '
                      'Firebase console — email works right away. Stays signed-in '
                      'on this device. View-only for anak; full confirm rights '
                      'for the owner email.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(
                          fontSize: 11,
                          color: AppTheme.forest800.withOpacity(0.55)),
                      ),
                    ),
                  ],
                ), // Column
              ), // Padding
            ), // ConstrainedBox
          ), // SingleChildScrollView
        ), // LayoutBuilder
      ), // SafeArea
    ); // Scaffold
  }
}
