import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

/// Hacienda de LuisAna — "Quiet Luxury" design system.
///
/// Refined forest-green + warm cream + aged-gold palette with a serif
/// (Cormorant) display voice and a quiet sans (Inter) for UI. Every screen in
/// the guest app draws from this single source of truth so the refresh stays
/// cohesive across Home, Stay, Explore, Book, the Dashboard and the Smart Key.
class AppTheme {
  // ---- Core brand palette (kept stable across the refresh) ----
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
    final ColorScheme colorScheme = ColorScheme.fromSeed(
      seedColor: forest700,
      primary: forest900,
      onPrimary: cream50,
      secondary: goldAccent,
      onSecondary: forest900,
      surface: cream50,
      onSurface: forest900,
      error: Color(0xFFB4452F),
      brightness: Brightness.light,
    );

    final baseInter = GoogleFonts.inter;

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: cream50,

      // ---------- AppBar (deep green, quiet luxury) ----------
      appBarTheme: AppBarTheme(
        backgroundColor: forest900,
        foregroundColor: cream50,
        centerTitle: true,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        titleSpacing: 20,
        titleTextStyle: GoogleFonts.cormorantGaramond(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          color: cream50,
          letterSpacing: 0.4,
        ),
      ),

      // ---------- Typography (Cormorant display + Inter UI) ----------
      textTheme: TextTheme(
        displayLarge: GoogleFonts.cormorantGaramond(
          fontSize: 40,
          height: 1.05,
          fontWeight: FontWeight.w700,
          color: forest900,
        ),
        displayMedium: GoogleFonts.cormorantGaramond(
          fontSize: 32,
          height: 1.1,
          fontWeight: FontWeight.w700,
          color: forest900,
        ),
        displaySmall: GoogleFonts.cormorantGaramond(
          fontSize: 26,
          height: 1.15,
          fontWeight: FontWeight.w700,
          color: forest900,
        ),
        headlineMedium: GoogleFonts.cormorantGaramond(
          fontSize: 24,
          height: 1.15,
          fontWeight: FontWeight.w700,
          color: forest900,
        ),
        headlineSmall: GoogleFonts.cormorantGaramond(
          fontSize: 21,
          height: 1.2,
          fontWeight: FontWeight.w600,
          color: forest900,
        ),
        titleLarge: GoogleFonts.cormorantGaramond(
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: forest900,
        ),
        titleMedium: GoogleFonts.inter(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: forest900,
        ),
        titleSmall: GoogleFonts.inter(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: forest900,
        ),
        bodyLarge: GoogleFonts.inter(
          fontSize: 16,
          color: forest900,
          height: 1.55,
        ),
        bodyMedium: GoogleFonts.inter(
          fontSize: 14,
          color: forest800,
          height: 1.5,
        ),
        bodySmall: GoogleFonts.inter(
          fontSize: 12,
          color: inkMuted,
          height: 1.45,
        ),
        labelLarge: GoogleFonts.inter(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
        labelMedium: GoogleFonts.inter(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
        labelSmall: GoogleFonts.inter(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.6,
        ),
      ),

      // ---------- Cards: soft white, gentle radius & depth ----------
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        shadowColor: forest900,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusCard),
          side: BorderSide(color: forest900.withOpacity(0.06)),
        ),
      ),

      // ---------- Primary buttons: deep green pill-ish CTA ----------
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: forest900,
          foregroundColor: cream50,
          elevation: 0,
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusField),
          ),
          textStyle: baseInter(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.2,
          ),
        ).copyWith(
          elevation: WidgetStateProperty.resolveWith((states) =>
              states.contains(WidgetState.pressed) ? 0.0 : 2.0),
          shadowColor: WidgetStateProperty.all(forest900.withOpacity(0.35)),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return forest900.withOpacity(0.35);
            }
            return forest900;
          }),
          foregroundColor:
              WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.disabled)) return cream50;
                return cream50;
              }),
        ),
      ),

      // ---------- Secondary buttons ----------
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: forest900,
          backgroundColor: Colors.transparent,
          side: BorderSide(color: forest900.withOpacity(0.25), width: 1.2),
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusField),
          ),
          textStyle: baseInter(
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: forest800,
          textStyle: baseInter(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),

      // ---------- Inputs: soft cream fields with sage focus ----------
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        hintStyle: baseInter(fontSize: 14, color: forest900.withOpacity(0.38)),
        labelStyle: baseInter(fontSize: 14, color: forest800.withOpacity(0.8)),
        prefixIconColor: forest800.withOpacity(0.7),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: BorderSide(color: forest900.withOpacity(0.12)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: BorderSide(color: forest900.withOpacity(0.12)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: const BorderSide(color: forest700, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: const BorderSide(color: Color(0xFFB4452F)),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusField),
          borderSide: const BorderSide(color: Color(0xFFB4452F), width: 1.6),
        ),
      ),

      // ---------- ChoiceChips ----------
      chipTheme: ChipThemeData(
        backgroundColor: Colors.white,
        selectedColor: forest800,
        surfaceTintColor: Colors.transparent,
        secondarySelectedColor: forest900,
        disabledColor: cream100,
        labelStyle: baseInter(fontSize: 13, color: forest900),
        secondaryLabelStyle: baseInter(fontSize: 13, color: cream50),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPill),
          side: BorderSide(color: forest900.withOpacity(0.14)),
        ),
      ),

      // ---------- Navigation bar: deep green with gold indicator ----------
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        backgroundColor: forest900,
        surfaceTintColor: Colors.transparent,
        indicatorColor: forest700.withOpacity(0.55),
        elevation: 0,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return baseInter(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: goldSoft,
              letterSpacing: 0.2,
            );
          }
          return baseInter(
            fontSize: 10,
            fontWeight: FontWeight.w500,
            color: cream50.withOpacity(0.72),
            letterSpacing: 0.2,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const IconThemeData(color: goldSoft, size: 25);
          }
          return IconThemeData(color: cream50.withOpacity(0.72), size: 23);
        }),
      ),

      // ---------- Tabs (used by Explore) ----------
      tabBarTheme: TabBarThemeData(
        labelColor: cream50,
        unselectedLabelColor: cream50.withOpacity(0.6),
        indicatorColor: goldAccent,
        indicatorSize: TabBarIndicatorSize.label,
        labelStyle: baseInter(fontSize: 13, fontWeight: FontWeight.w600),
        unselectedLabelStyle:
            baseInter(fontSize: 13, fontWeight: FontWeight.w500),
      ),

      // ---------- Slider ----------
      sliderTheme: SliderThemeData(
        activeTrackColor: forest700,
        inactiveTrackColor: forest900.withOpacity(0.12),
        thumbColor: forest900,
        overlayColor: forest700.withOpacity(0.12),
        trackHeight: 4,
        thumbShape:
            const RoundSliderThumbShape(enabledThumbRadius: 10),
      ),

      // ---------- Checkbox (terms + KYC) ----------
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) return forest800;
          return cream100;
        }),
        checkColor: const WidgetStatePropertyAll(cream50),
        side: BorderSide(color: forest900.withOpacity(0.3)),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(5),
        ),
      ),

      // ---------- Dialogs ----------
      dialogTheme: DialogThemeData(
        backgroundColor: cream50,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPanel),
        ),
      ),

      // ---------- Snackbar ----------
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: forest800,
        contentTextStyle: baseInter(fontSize: 14, color: cream50),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPanel),
        ),
      ),

      // ---------- Misc ----------
      dividerTheme: DividerThemeData(
        color: forest900.withOpacity(0.08),
        thickness: 1,
        space: 1,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPanel),
        ),
      ),
    );
  }
}
