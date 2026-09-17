import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/constants/app_constants.dart';
import '../../core/utils/geo_utils.dart';
import '../../models/guest_location_model.dart';
import '../../providers/app_providers.dart';
import '../../services/notification_service.dart';
import '../../widgets/simulation_bar.dart';

class TrackingRadarScreen extends ConsumerStatefulWidget {
  const TrackingRadarScreen({super.key});

  @override
  ConsumerState<TrackingRadarScreen> createState() => _TrackingRadarScreenState();
}

class _TrackingRadarScreenState extends ConsumerState<TrackingRadarScreen> {
  GuestLocationModel? _selectedGuest;

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(trackingSessionsStreamProvider);
    final firestoreService = ref.read(firestoreServiceProvider);

    return Scaffold(
      backgroundColor: AppColors.surfaceLight,
      appBar: AppBar(
        title: Text(
          'Live Guest Tracking Radar',
          style: GoogleFonts.cinzel(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(trackingSessionsStreamProvider),
          ),
        ],
      ),
      body: sessionsAsync.when(
        data: (sessions) {
          if (sessions.isEmpty) {
            return const Center(child: Text('No active guest tracking sessions.'));
          }

          final activeGuest = _selectedGuest ?? sessions.first;

          return Column(
            children: [
              // 1. Radar Visualizer / Map Area
              Expanded(
                flex: 5,
                child: Stack(
                  children: [
                    // Visual Radar Map Display
                    Container(
                      width: double.infinity,
                      decoration: const BoxDecoration(
                        gradient: RadialGradient(
                          center: Alignment.center,
                          radius: 0.9,
                          colors: [
                            Color(0xFF1E3A2F),
                            Color(0xFF0F2B1D),
                            Color(0xFF091C12),
                          ],
                        ),
                      ),
                      child: CustomPaint(
                        painter: _RadarGridPainter(
                          guestDistKm: activeGuest.distanceRemainingKm,
                          isNearby: activeGuest.isNearResort,
                          hasArrived: activeGuest.hasArrived,
                        ),
                        child: Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              // Center Resort Pin
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                  border: Border.all(color: AppColors.accentGold, width: 2.5),
                                  boxShadow: [
                                    BoxShadow(
                                      color: AppColors.accentGold.withOpacity(0.4),
                                      blurRadius: 18,
                                      spreadRadius: 4,
                                    ),
                                  ],
                                ),
                                child: const Icon(
                                  Icons.villa_rounded,
                                  size: 28,
                                  color: AppColors.primaryForest,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.6),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  'Hacienda de LuisAna',
                                  style: GoogleFonts.cinzel(
                                    color: Colors.white,
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),

                    // Top Floating Active Guests Selector
                    Positioned(
                      top: 14,
                      left: 14,
                      right: 14,
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: sessions.map((s) {
                            final isSelected = activeGuest.bookingId == s.bookingId;
                            return Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                avatar: Icon(
                                  s.isNearResort ? Icons.location_on : Icons.navigation,
                                  size: 14,
                                  color: isSelected ? Colors.white : AppColors.primaryForest,
                                ),
                                label: Text('${s.guestName} (${s.distanceRemainingKm.toStringAsFixed(1)} km)'),
                                selected: isSelected,
                                selectedColor: s.isNearResort ? AppColors.statusAlert : AppColors.primaryForest,
                                backgroundColor: Colors.white.withOpacity(0.9),
                                onSelected: (val) {
                                  if (val) setState(() => _selectedGuest = s);
                                },
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // 2. Guest Info & Radar Controls Sheet
              Container(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                  boxShadow: [
                    BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, -2)),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Guest name & Proximity status
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                activeGuest.guestName,
                                style: GoogleFonts.cinzel(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.textDark,
                                ),
                              ),
                              Text(
                                'Kasalukuyang Area: ${activeGuest.currentArea}',
                                style: GoogleFonts.inter(fontSize: 12, color: AppColors.textMuted),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: activeGuest.hasArrived
                                ? AppColors.statusSuccess.withOpacity(0.12)
                                : activeGuest.isNearResort
                                    ? AppColors.statusAlert.withOpacity(0.12)
                                    : AppColors.statusWarning.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: activeGuest.hasArrived
                                  ? AppColors.statusSuccess
                                  : activeGuest.isNearResort
                                      ? AppColors.statusAlert
                                      : AppColors.statusWarning,
                            ),
                          ),
                          child: Text(
                            activeGuest.hasArrived
                                ? '🏁 ARRIVED'
                                : activeGuest.isNearResort
                                    ? '🟢 MALAPIT NA'
                                    : '🟡 ON THE WAY',
                            style: GoogleFonts.inter(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: activeGuest.hasArrived
                                  ? AppColors.statusSuccess
                                  : activeGuest.isNearResort
                                      ? AppColors.statusAlert
                                      : AppColors.statusWarning,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Metrics Strip: Distance & ETA
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceLight,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('REMAINING DISTANCE',
                                    style: GoogleFonts.inter(fontSize: 9, color: AppColors.textMuted)),
                                Text(
                                  '${activeGuest.distanceRemainingKm.toStringAsFixed(1)} km',
                                  style: GoogleFonts.cinzel(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.primaryForest,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceLight,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('ESTIMATED ARRIVAL (ETA)',
                                    style: GoogleFonts.inter(fontSize: 9, color: AppColors.textMuted)),
                                Text(
                                  activeGuest.hasArrived
                                      ? 'Arrived'
                                      : '~${activeGuest.estimatedMinutesRemaining} mins',
                                  style: GoogleFonts.cinzel(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.accentGoldDark,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Quick Action Buttons Row
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: () {
                              final url =
                                  'https://www.google.com/maps/dir/?api=1&origin=${activeGuest.latitude},${activeGuest.longitude}&destination=${AppConstants.resortLatitude},${AppConstants.resortLongitude}';
                              _launch(url);
                            },
                            icon: const Icon(Icons.navigation, size: 14),
                            label: const Text('Google Maps'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filledTonal(
                          icon: const Icon(Icons.phone),
                          tooltip: 'Call Guest',
                          onPressed: () => _launch('tel:${AppConstants.hostPhone}'),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filledTonal(
                          icon: const Icon(Icons.sms),
                          tooltip: 'SMS Guest',
                          onPressed: () => _launch('sms:${AppConstants.hostPhone}'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),

                    // Demo Simulation Mode Switcher Bar
                    SimulationBar(
                      onSelectCheckpoint: (cp) async {
                        final dist = GeoUtils.calculateDistanceKm(cp.latitude, cp.longitude);
                        final eta = GeoUtils.estimateEtaMinutes(dist);

                        await firestoreService.updateGuestLocation(
                          bookingId: activeGuest.bookingId,
                          latitude: cp.latitude,
                          longitude: cp.longitude,
                          area: cp.area,
                          distanceKm: dist,
                          etaMinutes: eta,
                        );

                        if (dist <= AppConstants.nearbyThresholdKm) {
                          NotificationService().showProximityGeofenceAlert(
                            activeGuest.guestName,
                            dist,
                            eta,
                          );
                        }

                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('Simulated position: ${cp.area} (${dist.toStringAsFixed(1)} km)'),
                              duration: const Duration(seconds: 2),
                            ),
                          );
                        }
                      },
                    ),
                  ],
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
      ),
    );
  }

  void _launch(String url) async {
    final uri = Uri.parse(url);
    try {
      if (await canLaunchUrl(uri)) await launchUrl(uri);
    } catch (_) {}
  }
}

class _RadarGridPainter extends CustomPainter {
  final double guestDistKm;
  final bool isNearby;
  final bool hasArrived;

  _RadarGridPainter({
    required this.guestDistKm,
    required this.isNearby,
    required this.hasArrived,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final paintRing = Paint()
      ..color = Colors.white.withOpacity(0.08)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    final paintGreenRing = Paint()
      ..color = AppColors.statusSuccess.withOpacity(0.3)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    // Concentric Radar Rings
    canvas.drawCircle(center, 40, paintRing);
    canvas.drawCircle(center, 90, paintGreenRing); // 5km "Nearby" threshold ring
    canvas.drawCircle(center, 140, paintRing);
    canvas.drawCircle(center, 190, paintRing);

    // Crosshairs
    final paintCross = Paint()
      ..color = Colors.white.withOpacity(0.05)
      ..strokeWidth = 1.0;
    canvas.drawLine(Offset(0, center.dy), Offset(size.width, center.dy), paintCross);
    canvas.drawLine(Offset(center.dx, 0), Offset(center.dx, size.height), paintCross);

    // Guest Traveling Pin Indicator
    final guestOffset = hasArrived
        ? center
        : isNearby
            ? Offset(center.dx + 45, center.dy - 55)
            : Offset(center.dx + 110, center.dy - 120);

    final paintGuestPin = Paint()
      ..color = hasArrived
          ? AppColors.statusSuccess
          : isNearby
              ? AppColors.statusAlert
              : AppColors.statusWarning
      ..style = PaintingStyle.fill;

    // Pulse animation aura around guest
    final paintAura = Paint()
      ..color = paintGuestPin.color.withOpacity(0.25)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(guestOffset, 16, paintAura);
    canvas.drawCircle(guestOffset, 8, paintGuestPin);
  }

  @override
  bool shouldRepaint(covariant _RadarGridPainter oldDelegate) {
    return oldDelegate.guestDistKm != guestDistKm ||
        oldDelegate.isNearby != isNearby ||
        oldDelegate.hasArrived != hasArrived;
  }
}
