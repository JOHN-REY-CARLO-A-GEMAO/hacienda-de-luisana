import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../core/constants/app_constants.dart';
import '../core/utils/geo_utils.dart';

class SimulationBar extends StatelessWidget {
  final Function(SimulationCheckpoint checkpoint) onSelectCheckpoint;

  const SimulationBar({
    super.key,
    required this.onSelectCheckpoint,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.primaryDark,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(Icons.touch_app, size: 14, color: AppColors.accentGold),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'DEMO SIMULATION CONTROLLER (ONE-TAP CHECKPOINTS)',
                  style: GoogleFonts.inter(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                    color: AppColors.accentGoldLight,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: GeoUtils.demoCheckpoints.map((cp) {
                final isNearbyAlert = cp.id == 'nearby';
                final isArrived = cp.id == 'arrived';

                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ActionChip(
                    backgroundColor: isArrived
                        ? const Color(0xFF2A9D8F)
                        : isNearbyAlert
                            ? const Color(0xFFE76F51)
                            : Colors.white.withOpacity(0.12),
                    side: BorderSide.none,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    avatar: Icon(
                      isArrived
                          ? Icons.check_circle
                          : isNearbyAlert
                              ? Icons.warning_amber_rounded
                              : Icons.navigation_outlined,
                      size: 13,
                      color: Colors.white,
                    ),
                    label: Text(
                      cp.label,
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                    onPressed: () => onSelectCheckpoint(cp),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}
