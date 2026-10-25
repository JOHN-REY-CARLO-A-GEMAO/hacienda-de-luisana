import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../constants/app_constants.dart';

/// Hacienda de LuisAna — single design-system source of truth.
///
/// Two token families live here on purpose:
/// * the `AppColors`-based ops palette (deep pine + gold) used by the
///   Dashboard/Bookings/Chat/Stays/Analytics/SmartLock/Rooms/CRM screens,
/// * the quiet-luxury forest/cream/gold tokens (`forest900`, `cream50`, …)
///   used by the Admin login and every Admin surface.
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

  /// The Admin app's display face. Two screens had reached for a serif of their
  /// own (Cormorant on the login headline, Playfair on the reviews score) while
  /// every other title used Cinzel, so they now ask for it here.
  static TextStyle serif({
    double fontSize = 18,
    FontWeight fontWeight = FontWeight.w600,
    Color? color,
    double letterSpacing = 0.2,
    double? height,
  }) =>
      GoogleFonts.cinzel(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
        height: height,
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
        toolbarHeight: 64,
        titleTextStyle: serif(
          fontSize: 20,
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
          minimumSize: const Size(48, 52),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryForest,
          side: const BorderSide(color: AppColors.cardBorder),
          minimumSize: const Size(48, 52),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          textStyle: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          textStyle: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        labelStyle: baseInter(fontSize: 16, color: AppColors.textMuted),
        hintStyle: baseInter(fontSize: 16, color: AppColors.textMuted),
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
        titleLarge: GoogleFonts.inter(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          color: AppColors.textDark,
        ),
        titleMedium: GoogleFonts.inter(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: AppColors.textDark,
        ),
        bodyLarge: GoogleFonts.inter(
          fontSize: 18,
          color: AppColors.textDark,
          height: 1.4,
        ),
        bodyMedium: GoogleFonts.inter(
          fontSize: 16,
          color: AppColors.textDark,
          height: 1.4,
        ),
        bodySmall: GoogleFonts.inter(
          fontSize: 14,
          color: AppColors.textMuted,
          height: 1.35,
        ),
      ),

      // ---------- Chips (filter rows across the app) ----------
      chipTheme: ChipThemeData(
        backgroundColor: Colors.white,
        selectedColor: AppColors.primaryForest,
        surfaceTintColor: Colors.transparent,
        labelStyle: baseInter(fontSize: 16, color: AppColors.textDark),
        secondaryLabelStyle: baseInter(fontSize: 16, color: Colors.white),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        side: const BorderSide(color: AppColors.cardBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        checkmarkColor: Colors.white,
      ),

      // ---------- Dialogs ----------
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.cardSurface,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: baseInter(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textDark),
        contentTextStyle: baseInter(fontSize: 17, color: AppColors.textDark, height: 1.4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        actionsPadding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
        insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      ),

      // ---------- Snackbars ----------
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.primaryForest,
        contentTextStyle: baseInter(fontSize: 16, color: Colors.white, height: 1.35),
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
          fontSize: 17,
          fontWeight: FontWeight.w600,
          color: AppColors.textDark,
        ),
        subtitleTextStyle: baseInter(fontSize: 15, color: AppColors.textMuted, height: 1.35),
        iconColor: AppColors.primaryForest,
        horizontalTitleGap: 16,
        minVerticalPadding: 14,
      ),
    );
  }
}
