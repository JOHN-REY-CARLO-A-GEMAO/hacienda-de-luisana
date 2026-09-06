import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/booking.dart';
import '../services/auth_store.dart';
import '../services/booking_store.dart';
import '../services/esp32_service.dart';
import '../theme/app_theme.dart';
import 'auth_screen.dart';

/// Guest Dashboard / Account tab.
///
/// Proper flow states:
/// - Signed out, no booking   → browse prompt + sign-in card
/// - Signed in, no booking    → "no upcoming stay" + book CTA
/// - Booking pending          → status card (For Host Review) + timeline + cancel
/// - Booking confirmed        → digital key unlocks
class DashboardScreen extends StatelessWidget {
  final VoidCallback? onNavigateBook;

  const DashboardScreen({super.key, this.onNavigateBook});

  Future<void> _makeCall(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  Future<void> _openMessenger() async {
    final uri = Uri.parse('https://m.me/haciendadeluisana');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  int _flowStep(Booking b) {
    if (b.status == 'checked_in' || b.status == 'completed') return 3;
    if (b.status == 'confirmed') return 2;
    return b.kycStatus == 'submitted' ? 1 : 0;
  }

  Color _statusColor(Booking? b) {
    switch (b?.status) {
      case 'confirmed':
      case 'checked_in':
        return Colors.green.shade700;
      case 'cancelled':
        return Colors.red.shade700;
      case 'completed':
        return AppTheme.olive;
      default:
        return Colors.amber.shade800;
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthStore>();
    final store = context.watch<BookingStore>();
    final user = auth.user;
    final booking = store.currentBooking;
    final isConfirmed = booking?.isConfirmed ?? false;

    final pastStays = store.bookings
        .where((b) => !b.isActive && b.referenceId != booking?.referenceId)
        .toList()
        .reversed
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Guest Dashboard'),
        actions: [
          if (user != null)
            IconButton(
              tooltip: 'Log out',
              icon: const Icon(Icons.logout),
              onPressed: () async {
                await auth.logout();
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('You have been logged out.')),
                  );
                }
              },
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ---- Welcome header ----
            Text(
              'Good to see you,',
              style: GoogleFonts.inter(
                fontSize: 12,
                color: AppTheme.forest800.withOpacity(0.6),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              'Welcome, ${user?.name ?? booking?.guestName ?? "Guest"}',
              style: GoogleFonts.cormorantGaramond(
                fontSize: 30,
                height: 1.1,
                fontWeight: FontWeight.w700,
                color: AppTheme.forest900,
              ),
            ),
            const SizedBox(height: 7),
            Text(
              user == null
                  ? 'Your Hacienda guest hub — sign in to book, track stays and unlock your digital key.'
                  : 'Your Hacienda guest hub — reservation, digital key and host support.',
              style: GoogleFonts.inter(
                fontSize: 13,
                height: 1.45,
                color: AppTheme.olive,
              ),
            ),
            const SizedBox(height: 22),

            // ---- Sign-in prompt (guest mode) ----
            if (user == null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: AppTheme.cream100,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: const Icon(Icons.person_outline,
                                color: AppTheme.forest800, size: 24),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'You are browsing as a guest',
                              style: GoogleFonts.inter(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: AppTheme.forest900,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'You can explore freely — we\'ll only ask you to sign in or register when you book your stay.',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          height: 1.5,
                          color: AppTheme.forest800.withOpacity(0.7),
                        ),
                      ),
                      const SizedBox(height: 14),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => const AuthScreen(
                                reason: 'Log in or create an account to manage your bookings.',
                              ),
                            ),
                          ),
                          icon: const Icon(Icons.login, size: 18),
                          label: const Text('Sign In / Register'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 22),
            ],

            // ---- Reservation status / empty state ----
            if (booking == null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 48,
                            height: 48,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              gradient: AppTheme.forestDeep,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: const Icon(Icons.cottage_outlined,
                                color: AppTheme.goldSoft, size: 26),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              'No upcoming stay yet',
                              style: GoogleFonts.cormorantGaramond(
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                                color: AppTheme.forest900,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'When you book, your reservation status, digital key and host contact will live here.',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          height: 1.5,
                          color: AppTheme.forest800.withOpacity(0.7),
                        ),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: onNavigateBook,
                          icon: const Icon(Icons.calendar_month, size: 18),
                          label: const Text('Book Your Stay'),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else ...[
              // Status card (dark)
              Card(
                color: AppTheme.forest900,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusCard),
                  side: const BorderSide(color: AppTheme.forest900),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(22.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'RESERVATION STATUS',
                            style: GoogleFonts.inter(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 1.5,
                              color: AppTheme.cream50.withOpacity(0.7),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: _statusColor(booking),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              booking.statusLabel.toUpperCase(),
                              style: GoogleFonts.inter(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Text(
                        booking.accommodationTitle,
                        style: GoogleFonts.cormorantGaramond(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.cream50,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Ref: ${booking.referenceId} • ${booking.guestCount} Guests',
                        style: GoogleFonts.inter(
                            fontSize: 13, color: AppTheme.cream50.withOpacity(0.8)),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          const Icon(Icons.calendar_month, color: AppTheme.goldAccent, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            '${DateFormat('MMM d').format(booking.checkInDate)} - ${DateFormat('MMM d, yyyy').format(booking.checkOutDate)}',
                            style: GoogleFonts.inter(fontSize: 13, color: AppTheme.cream50),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      _FlowTimeline(currentStep: _flowStep(booking)),
                      if (booking.isPending) ...[
                        const SizedBox(height: 12),
                        Text(
                          booking.kycStatus == 'submitted'
                              ? 'Host is reviewing your ID & deposit — you\'ll be confirmed shortly.'
                              : 'Complete KYC verification to send your booking to the host.',
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            height: 1.45,
                            color: AppTheme.goldSoft.withOpacity(0.9),
                          ),
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: TextButton.icon(
                            style: TextButton.styleFrom(
                              foregroundColor: AppTheme.cream50.withOpacity(0.85),
                            ),
                            onPressed: () async {
                              final ok = await showDialog<bool>(
                                context: context,
                                builder: (ctx) => AlertDialog(
                                  title: const Text('Cancel this request?'),
                                  content: const Text(
                      'Your pending reservation will be withdrawn. This cannot be undone.'),
                                  actions: [
                                    TextButton(
                                      onPressed: () => Navigator.pop(ctx, false),
                                      child: const Text('Keep'),
                                    ),
                                    TextButton(
                                      onPressed: () => Navigator.pop(ctx, true),
                                      child: const Text('Cancel Booking'),
                                    ),
                                  ],
                                ),
                              );
                              if (ok == true) {
                                store.cancelBooking();
                              }
                            },
                            icon: const Icon(Icons.close, size: 16),
                            label: const Text('Cancel request'),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // ---- Digital Key card ----
              Card(
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 52,
                            height: 52,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              gradient: AppTheme.forestDeep,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: const Icon(Icons.lock_person,
                                color: AppTheme.goldSoft, size: 26),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Digital Key',
                                  style: GoogleFonts.cormorantGaramond(
                                    fontSize: 21,
                                    fontWeight: FontWeight.w700,
                                    color: AppTheme.forest900,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'ESP32 Smart Lock access',
                                  style: GoogleFonts.inter(
                                    fontSize: 12,
                                    color: AppTheme.forest800.withOpacity(0.7),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            width: 9,
                            height: 9,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isConfirmed ? AppTheme.olive : Colors.amber.shade600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        isConfirmed
                            ? 'Your key is active — press & hold to unlock your stay.'
                            : 'Locked while your booking awaits host confirmation.',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          height: 1.45,
                          color: AppTheme.forest800.withOpacity(0.72),
                        ),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: isConfirmed
                              ? () {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => const DigitalKeyScreen(),
                                    ),
                                  );
                                }
                              : null,
                          icon: const Icon(Icons.key, size: 18),
                          label: const Text('Open My Digital Key'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 28),

            // ---- Past stays ----
            if (pastStays.isNotEmpty) ...[
              Text(
                'Past Stays',
                style: GoogleFonts.cormorantGaramond(
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.forest900,
                ),
              ),
              const SizedBox(height: 10),
              ...pastStays.map(
                (b) => Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    leading: const Icon(Icons.history, color: AppTheme.forest800),
                    title: Text(
                      b.accommodationTitle,
                      style: GoogleFonts.inter(
                          fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.forest900),
                    ),
                    subtitle: Text(
                      '${DateFormat('MMM d').format(b.checkInDate)} – ${DateFormat('MMM d, yyyy').format(b.checkOutDate)} • Ref ${b.referenceId}',
                      style: GoogleFonts.inter(fontSize: 12, color: AppTheme.forest800.withOpacity(0.7)),
                    ),
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppTheme.cream100,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        b.statusLabel,
                        style: GoogleFonts.inter(
                            fontSize: 10, fontWeight: FontWeight.w700, color: AppTheme.forest800),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
            ],

            // ---- Host contact ----
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
                  'Contact Host',
                  style: GoogleFonts.cormorantGaramond(
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.forest900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Questions before or during your stay? We\'re a call away.',
              style: GoogleFonts.inter(
                fontSize: 12,
                color: AppTheme.forest800.withOpacity(0.6),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _makeCall('+639258507707'),
                    icon: const Icon(Icons.phone),
                    label: const Text('Call Host'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _openMessenger,
                    icon: const Icon(Icons.chat_bubble_outline),
                    label: const Text('Messenger'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Quiet-luxury progress timeline shown inside the dark status card.
class _FlowTimeline extends StatelessWidget {
  final int currentStep; // 0 reserved · 1 kyc · 2 confirmed · 3 check-in

  const _FlowTimeline({required this.currentStep});

  static const _labels = ['Reserved', 'Verification', 'Confirmed', 'Check-in'];

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (int i = 0; i < _labels.length; i++) ...[
          if (i > 0)
            Expanded(
              child: Container(
                height: 2,
                color: i <= currentStep
                    ? AppTheme.goldAccent
                    : AppTheme.cream50.withOpacity(0.18),
              ),
            ),
          Column(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: i <= currentStep ? AppTheme.goldAccent : Colors.transparent,
                  border: Border.all(
                color: i <= currentStep
                    ? AppTheme.goldAccent
                    : AppTheme.cream50.withOpacity(0.4),
                width: 1.5,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                _labels[i],
                style: GoogleFonts.inter(
                  fontSize: 9.5,
                  fontWeight: i <= currentStep ? FontWeight.w700 : FontWeight.w500,
                  letterSpacing: 0.3,
                  color: i <= currentStep
                      ? AppTheme.cream50
                      : AppTheme.cream50.withOpacity(0.5),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

// ESP32 Smart Lock press-and-hold screen (unchanged behavior).
class DigitalKeyScreen extends StatefulWidget {
  const DigitalKeyScreen({super.key});

  @override
  State<DigitalKeyScreen> createState() => _DigitalKeyScreenState();
}

class _DigitalKeyScreenState extends State<DigitalKeyScreen>
    with SingleTickerProviderStateMixin {
  double _holdProgress = 0.0;
  Timer? _holdTimer;
  bool _isUnlocked = false;
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  void _startHold() {
    _holdTimer?.cancel();
    _holdTimer = Timer.periodic(const Duration(milliseconds: 60), (timer) {
      setState(() {
        _holdProgress += 0.05; // 20 steps x 60ms = 1.2s total hold required
        if (_holdProgress >= 1.0) {
          _holdProgress = 1.0;
          timer.cancel();
          _triggerUnlock();
        }
      });
    });
  }

  void _cancelHold() {
    _holdTimer?.cancel();
    if (!_isUnlocked) {
      setState(() {
        _holdProgress = 0.0;
      });
    }
  }

  void _triggerUnlock() async {
    final esp32 = Provider.of<Esp32Service>(context, listen: false);
    final success = await esp32.unlock();

    if (mounted) {
      if (success) {
        setState(() {
          _isUnlocked = true;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('🔓 Smart Lock Unlocked! Door opened successfully.'),
            backgroundColor: AppTheme.forest800,
          ),
        );

        // Auto relock state in UI after 5 seconds
        Timer(const Duration(seconds: 5), () {
          if (mounted) {
            setState(() {
              _isUnlocked = false;
              _holdProgress = 0.0;
            });
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final esp32 = Provider.of<Esp32Service>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Key Smart Lock'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // ESP32 Status Header
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: esp32.connected
                      ? Colors.green.withOpacity(0.15)
                      : Colors.red.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: esp32.connected ? Colors.green : Colors.red,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      esp32.connected
                          ? Icons.bluetooth_connected
                          : Icons.bluetooth_disabled,
                      color: esp32.connected ? Colors.green : Colors.red,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      esp32.connected ? 'ESP32 Lock Connected' : 'ESP32 Lock Disconnected',
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color:
                            esp32.connected ? Colors.green.shade900 : Colors.red.shade900,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 40),

              Text(
                _isUnlocked ? 'DOOR UNLOCKED' : 'PRESS & HOLD TO UNLOCK',
                style: GoogleFonts.cormorantGaramond(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                  color: AppTheme.forest900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _isUnlocked
                    ? 'Door will automatically relock in 5 seconds.'
                    : 'Hold button down firmly for 1.2 seconds',
                style: GoogleFonts.inter(fontSize: 13, color: Colors.black54),
              ),
              const SizedBox(height: 50),

              // Circular Press & Hold Button with CircularProgressIndicator + SpinKitPulse
              GestureDetector(
                onTapDown: (_) => _startHold(),
                onTapUp: (_) => _cancelHold(),
                onTapCancel: () => _cancelHold(),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // SpinKit Ripple when unlocked or holding
                    if (_isUnlocked || _holdProgress > 0)
                      SpinKitPulse(
                        color: _isUnlocked ? AppTheme.olive : AppTheme.goldAccent,
                        size: 220,
                      ),

                    // Outer Circular Progress Indicator
                    SizedBox(
                      width: 170,
                      height: 170,
                      child: CircularProgressIndicator(
                        value: _holdProgress,
                        strokeWidth: 8,
                        backgroundColor: AppTheme.cream100,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          _isUnlocked ? AppTheme.olive : AppTheme.forest900,
                        ),
                      ),
                    ),

                    // Main Inner Circular Lock Button
                    Container(
                      width: 140,
                      height: 140,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _isUnlocked ? AppTheme.forest900 : AppTheme.forest800,
                        boxShadow: [
                          BoxShadow(
                            color: AppTheme.forest900.withOpacity(0.3),
                            blurRadius: 15,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                      child: Icon(
                        _isUnlocked ? Icons.lock_open : Icons.lock,
                        size: 60,
                        color: _isUnlocked ? AppTheme.goldAccent : AppTheme.cream50,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 50),

              // Status indicator footer
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 16,
                    color: AppTheme.forest800.withOpacity(0.7),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Bluetooth 5.0 Low Energy encrypted handshake',
                    style: GoogleFonts.inter(fontSize: 12, color: Colors.black54),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
