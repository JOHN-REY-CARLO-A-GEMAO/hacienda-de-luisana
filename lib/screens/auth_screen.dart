import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../services/auth_store.dart';
import '../theme/app_theme.dart';
import '../utils/validators.dart';

/// Guest portal — Login / Register (demo-local auth).
///
/// Shown when a signed-out guest tries to book. Pops with `true` on success
/// so the caller can resume the interrupted action.
class AuthScreen extends StatefulWidget {
  final String reason;

  const AuthScreen({super.key, this.reason = ''});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _isLogin = true;
  bool _loading = false;
  bool _obscure = true;

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _confirmController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);

    final auth = context.read<AuthStore>();
    try {
      if (_isLogin) {
        await auth.login(
          email: _emailController.text,
          password: _passwordController.text,
        );
      } else {
        await auth.register(
          name: _nameController.text,
          email: _emailController.text,
          phone: Validators.normalizePhone(_phoneController.text),
          password: _passwordController.text,
        );
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Welcome, ${auth.user?.name ?? 'guest'}!')),
        );
        Navigator.of(context).pop(true);
      }
    } on AuthException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Something went wrong. Please try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _toggleMode() {
    setState(() {
      _isLogin = !_isLogin;
      _formKey.currentState?.reset();
      _confirmController.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isLogin ? 'Guest Login' : 'Create Account')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Eyebrow
                    Row(
                      children: [
                        Container(
                          width: 22,
                          height: 2,
                          decoration: BoxDecoration(
                            color: AppTheme.goldAccent,
                            borderRadius: BorderRadius.circular(1),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'GUEST PORTAL',
                          style: GoogleFonts.inter(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.8,
                            color: AppTheme.olive,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _isLogin ? 'Welcome back' : 'Join the Hacienda',
                      style: GoogleFonts.cormorantGaramond(
                        fontSize: 32,
                        height: 1.1,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.forest900,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _isLogin
                          ? 'Log in to manage your reservations and digital key.'
                          : 'One account for bookings, verification and your stay.',
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        height: 1.5,
                        color: AppTheme.forest800.withOpacity(0.75),
                      ),
                    ),

                    if (widget.reason.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: AppTheme.oliveMist.withOpacity(0.45),
                          borderRadius: BorderRadius.circular(AppTheme.radiusField),
                          border: Border.all(color: AppTheme.olive.withOpacity(0.4)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.lock_outline, size: 18, color: AppTheme.forest800),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                widget.reason,
                                style: GoogleFonts.inter(
                                  fontSize: 12,
                                  height: 1.4,
                                  color: AppTheme.forest800,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 24),

                    if (!_isLogin) ...[
                      TextFormField(
                        controller: _nameController,
                        textCapitalization: TextCapitalization.words,
                        decoration: const InputDecoration(
                          labelText: 'Full Name',
                          prefixIcon: Icon(Icons.person_outline),
                        ),
                        validator: Validators.name,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(
                          labelText: 'Mobile Number',
                          hintText: '09XX XXX XXXX',
                          prefixIcon: Icon(Icons.phone_outlined),
                        ),
                        validator: Validators.phone,
                      ),
                      const SizedBox(height: 14),
                    ],

                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(
                        labelText: 'Email',
                        hintText: 'you@example.com',
                        prefixIcon: Icon(Icons.mail_outline),
                      ),
                      validator: Validators.email,
                    ),
                    const SizedBox(height: 14),

                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscure,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(_obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: Validators.password,
                    ),
                    const SizedBox(height: 14),

                    if (!_isLogin)
                      TextFormField(
                        controller: _confirmController,
                        obscureText: _obscure,
                        decoration: const InputDecoration(
                          labelText: 'Confirm Password',
                          prefixIcon: Icon(Icons.lock_reset_outlined),
                        ),
                        validator: (v) => Validators.passwordConfirm(v, _passwordController.text),
                      ),

                    const SizedBox(height: 26),

                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _loading ? null : _submit,
                        child: Text(
                          _isLogin ? 'Log In' : 'Create Account',
                          style: const TextStyle(fontSize: 16),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    Center(
                      child: TextButton(
                        onPressed: _toggleMode,
                        child: Text.rich(
                          TextSpan(
                            text: _isLogin
                                ? "No account yet? "
                                : "Already have an account? ",
                            style: GoogleFonts.inter(fontSize: 13, color: AppTheme.forest800.withOpacity(0.7)),
                            children: [
                              TextSpan(
                                text: _isLogin ? 'Register' : 'Log in',
                                style: GoogleFonts.inter(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.forest900,
                                  decoration: TextDecoration.underline,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
