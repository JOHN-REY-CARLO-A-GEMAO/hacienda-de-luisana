import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../services/auth_store.dart';
import '../../utils/error_utils.dart';
import '../../utils/validators.dart';
import '../../widgets/admin_ui.dart';
import '../../widgets/hacienda_card.dart';
import '../../widgets/staggered_entrance.dart';

/// Admin sign-in gate.
///
/// One-tap Google sign-in with the Admin email shown, or email + password.
/// Only the Admin may use this app; anyone else is signed straight back out
/// with "Not authorized". The visual identity is deliberate and quiet: a
/// single pine masthead, a paper form, and brass only on the active control.
class AdminLoginScreen extends StatefulWidget {
  const AdminLoginScreen({super.key});

  @override
  State<AdminLoginScreen> createState() => _AdminLoginScreenState();
}

class _AdminLoginScreenState extends State<AdminLoginScreen> {
  bool _busy = false;
  String? _error;
  bool _obscure = true;
  late final TextEditingController _email =
      TextEditingController(text: AuthStore.kDefaultAdminEmail);
  final TextEditingController _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Only the Admin may use this app.
  Future<void> _requireAdmin() => context.read<AuthStore>().requireAdmin();

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = context.read<AuthStore>();
      await auth.signInWithGoogle();
      if (!mounted) return;
      await _requireAdmin();
    } on AuthException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) {
        setState(() => _error = ErrorUtils.toUserMessage(
              e,
              fallback: 'Sign-in failed. Please try again.',
            ));
      }
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
      await auth.signInWithEmail(
        email: _email.text.trim(),
        password: _password.text,
      );
      if (!mounted) return;
      await _requireAdmin();
    } on AuthException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) {
        setState(() => _error = ErrorUtils.toUserMessage(
              e,
              fallback: 'Sign-in failed. Please try again.',
            ));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final minHeight = constraints.maxHeight > AppTheme.gutter * 2
                ? constraints.maxHeight - AppTheme.gutter * 2
                : 0.0;
            return SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.gutter),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: minHeight,
                maxWidth: 480,
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _brandPanel(),
                    Transform.translate(
                      offset: const Offset(0, -18),
                      child: StaggeredEntrance(
                        child: _signInPanel(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
          },
        ),
      ),
    );
  }

  Widget _brandPanel() {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 44),
      decoration: BoxDecoration(
        color: AppColors.primaryDark,
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(AppTheme.radiusCard),
        ),
        border: Border.all(color: AppColors.accentGold.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppTheme.radiusPanel),
                  border: Border.all(
                    color: AppColors.accentGold.withValues(alpha: 0.6),
                  ),
                ),
                child: const Icon(
                  Icons.lock_person_outlined,
                  color: AppColors.accentGoldLight,
                  size: 23,
                ),
              ),
              const Spacer(),
              Text(
                'Admin',
                style: AppTheme.label(
                  fontSize: 12,
                  color: AppColors.accentGoldLight,
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            'Hacienda de LuisAna',
            style: AppTheme.serif(
              fontSize: 26,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            'Estate operations, in one place.',
            style: AppTheme.body(
              fontSize: 13,
              color: Colors.white.withValues(alpha: 0.72),
            ),
          ),
        ],
      ),
    );
  }

  Widget _signInPanel() {
    return HaciendaCard(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Admin sign in', style: AppTheme.display(fontSize: 22)),
          const SizedBox(height: 5),
          Text(
            'Manage bookings, payments, rates, stays and door records.',
            style: AppTheme.body(fontSize: 13, color: AppColors.textMuted),
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.sageMist,
              borderRadius: BorderRadius.circular(AppTheme.radiusPanel),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Row(
              children: [
                const Icon(Icons.account_circle_outlined,
                    color: AppColors.primaryForest, size: 21),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Google account', style: AppTheme.label(fontSize: 11)),
                      const SizedBox(height: 2),
                      Text(
                        AuthStore.kDefaultAdminEmail,
                        style: AppTheme.title(fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _busy ? null : _signIn,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.login, size: 19),
              label: Text(_busy ? 'Signing in…' : 'Continue with Google'),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            AdminInlineNotice(
              title: 'Sign-in failed',
              message: _error!,
              tone: AdminNoticeTone.danger,
            ),
          ],
          const SizedBox(height: 18),
          Row(
            children: [
              const Expanded(child: Divider()),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: Text(
                  'or use the Admin password',
                  style: AppTheme.label(fontSize: 11),
                ),
              ),
              const Expanded(child: Divider()),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            textInputAction: TextInputAction.next,
            enabled: !_busy,
            decoration: const InputDecoration(
              labelText: 'Admin email',
              prefixIcon: Icon(Icons.mail_outlined, size: 19),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _password,
            obscureText: _obscure,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            enabled: !_busy,
            onSubmitted: _busy ? null : (_) => _signInEmail(),
            decoration: InputDecoration(
              labelText: 'Password',
              prefixIcon: const Icon(Icons.key_outlined, size: 19),
              suffixIcon: Semantics(
                button: true,
                label: _obscure ? 'Show password' : 'Hide password',
                child: IconButton(
                  tooltip: _obscure ? 'Show password' : 'Hide password',
                  icon: Icon(
                    _obscure
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                    size: 19,
                  ),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 50,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : _signInEmail,
              icon: const Icon(Icons.lock_open_outlined, size: 18),
              label: const Text('Sign in with email'),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'This app is for the Hacienda Admin only. Guests book on the website. '
            'Your session stays signed in on this device.',
            textAlign: TextAlign.center,
            style: AppTheme.body(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}
