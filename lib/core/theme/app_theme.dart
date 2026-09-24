import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../constants/app_constants.dart';

/// Hacienda de LuisAna — single design-system source of truth.
///
/// Two token families live here on purpose:
/// * the `AppColors`-based ops palette (deep pine + gold) used by the
///   Dashboard/Bookings/Radar/Stays/Analytics/SmartLock/Rooms/CRM screens,
/// * the quiet-luxury forest/cream/gold tokens (`forest900`, `cream50`, …)
///   used by the owner login and admin surfaces.
///
/// Admin surfaces live in `lib/views/admin/` and auth in `lib/views/auth/`.
class AppTheme {
  // ---- Quiet-luxury brand tokens (login + admin surfaces) ----
  static const Color forest900 = Color(0xFF0F1C11); // deepest pine-ink
  static const Color forest800 = Color(0xFF243B26); // rich evergreen
  static const Color forest700 = Color(0xFF33522F); // softer leaf
  static const Color olive = Color(0xFF8A9A5B); // sage-olive accent
  static const Color oliveMist = Color(0xFFD8DFC4); // pale sage tint
  static const Color cream50 = Color(0xFFFBF9F3); // warm paper
  static const Color cream100 = Color(0xFFF3EFE0); // soft parchment
  static const Color cream200 = Color(0xFFE7E0CB); // warmer sand
  static const Color goldAccent = Color(0xFFC5A059); // aged gold
  static const Color goldSoft = Color(0xFFE2C896); // champagne gold

  // ---- Semantic helpers ----
  static const Color inkMuted = Color(0xCC0F1C11); // forest-ink at 80%
  static const Color hairline = Color(0x1A0F1C11); // subtle forest hairlines
  static const Color softShadow = Color(0x0F0F1C11); // faint depth shadow

  // ---- Radii ----
  static const double radiusCard = 22;
  static const double radiusPanel = 16;
  static const double radiusField = 14;
  static const double radiusPill = 999;

  /// Brand gradient used on the deep-green hero surfaces.
  static const LinearGradient forestDeep = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [forest800, forest900],
  );

  /// Signature "quiet-luxury" wash for imagery: transparent → deep pine.
  static const LinearGradient heroShade = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Colors.transparent, Color(0xD90F1C11)],
  );

  /// Warm gold wash for confirmation / celebratory surfaces.
  static const LinearGradient goldShade = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [goldSoft, goldAccent],
  );

  static ThemeData get lightTheme {
    final baseInter = GoogleFonts.inter;
    final baseTextTheme = GoogleFonts.interTextTheme();

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      primaryColor: AppColors.primaryForest,
      scaffoldBackgroundColor: AppColors.surfaceLight,
      colorScheme: ColorScheme.light(
        primary: AppColors.primaryForest,
        onPrimary: Colors.white,
        secondary: AppColors.accentGold,
        onSecondary: AppColors.primaryDark,
        surface: AppColors.cardSurface,
        onSurface: AppColors.textDark,
        error: AppColors.statusAlert,
        onError: Colors.white,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.primaryDark,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: GoogleFonts.cinzel(
          fontSize: 18,
          fontWeight: FontWeight.bold,
          color: Colors.white,
          letterSpacing: 0.5,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.cardSurface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: const BorderSide(color: AppColors.cardBorder, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primaryForest,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryForest,
          side: const BorderSide(color: AppColors.cardBorder),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
      textTheme: baseTextTheme.copyWith(
        headlineLarge: GoogleFonts.cinzel(
          fontSize: 26,
          fontWeight: FontWeight.bold,
          color: AppColors.textDark,
        ),
        headlineMedium: GoogleFonts.cinzel(
          fontSize: 20,
          fontWeight: FontWeight.bold,
          color: AppColors.textDark,
        ),
        titleMedium: GoogleFonts.inter(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: AppColors.textDark,
        ),
        bodyMedium: GoogleFonts.inter(
          fontSize: 13,
          color: AppColors.textDark,
        ),
        bodySmall: GoogleFonts.inter(
          fontSize: 11,
          color: AppColors.textMuted,
        ),
      ),

      // ---------- Chips (filter rows across the app) ----------
      chipTheme: ChipThemeData(
        backgroundColor: Colors.white,
        selectedColor: AppColors.primaryForest,
        surfaceTintColor: Colors.transparent,
        labelStyle: baseInter(fontSize: 12, color: AppColors.textDark),
        secondaryLabelStyle: baseInter(fontSize: 12, color: Colors.white),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        side: const BorderSide(color: AppColors.cardBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        checkmarkColor: Colors.white,
      ),

      // ---------- Dialogs ----------
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.cardSurface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        actionsPadding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      ),

      // ---------- Snackbars ----------
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.primaryForest,
        contentTextStyle: baseInter(fontSize: 13, color: Colors.white),
        actionTextColor: AppColors.accentGoldLight,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),

      // ---------- Bottom sheets ----------
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: AppColors.cardSurface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),

      // ---------- Dividers ----------
      dividerTheme: const DividerThemeData(
        color: AppColors.cardBorder,
        thickness: 1,
        space: 1,
      ),

      // ---------- Progress indicators ----------
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: AppColors.primaryForest,
      ),

      // ---------- Floating action buttons ----------
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.primaryForest,
        foregroundColor: Colors.white,
        elevation: 4,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),

      // ---------- List tiles (More sheet, etc.) ----------
      listTileTheme: ListTileThemeData(
        titleTextStyle: baseInter(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.textDark,
        ),
        subtitleTextStyle: baseInter(fontSize: 12, color: AppColors.textMuted),
        iconColor: AppColors.primaryForest,
        horizontalTitleGap: 16,
      ),
    );
  }
}
