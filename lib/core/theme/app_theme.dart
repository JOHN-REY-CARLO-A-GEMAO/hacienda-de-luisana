import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../constants/app_constants.dart';

/// Hacienda de LuisAna — single design-system source of truth.
///
/// The visual direction is a working estate ledger: deep pine mastheads, warm
/// paper surfaces, brass for the active place or the next decision, and ruled
/// information rather than a wall of identical cards. Two typefaces carry the
/// whole app: Cinzel for short titles and reference numerals, Inter for the
/// dense operational copy and tabular figures.
class AppTheme {
  // ---- Quiet-luxury brand tokens, unified with AppColors ----
  static const Color forest900 = AppColors.primaryDark;
  static const Color forest800 = AppColors.primaryForest;
  static const Color forest700 = AppColors.primaryForestLight;
  static const Color olive = Color(0xFF70845A);
  static const Color oliveMist = AppColors.sageMist;
  static const Color cream50 = AppColors.surfaceLight;
  static const Color cream100 = AppColors.cardSurface;
  static const Color cream200 = AppColors.surfaceSunken;
  static const Color goldAccent = AppColors.accentGold;
  static const Color goldSoft = AppColors.accentGoldLight;

  // ---- Semantic helpers ----
  static const Color ink = AppColors.textDark;
  static const Color inkMuted = AppColors.textMuted;
  static const Color hairline = AppColors.cardBorder;
  static const Color softShadow = Color(0x0F10271B);
  static const Color focusRing = Color(0x667F5D1F);

  // ---- Layout and radii ----
  static const double pageMaxWidth = 1080;
  static const double compactBreakpoint = 720;
  static const double navigationBreakpoint = 900;
  static const double gutter = 16;
  static const double radiusCard = 18;
  static const double radiusPanel = 14;
  static const double radiusField = 12;
  static const double radiusPill = 999;

  // ---- Typography helpers ----
  static TextStyle serif({
    double fontSize = 18,
    FontWeight fontWeight = FontWeight.w600,
    Color? color,
    double letterSpacing = 0.1,
    double? height,
  }) =>
      GoogleFonts.cinzel(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: letterSpacing,
        height: height,
      );

  static TextStyle display({
    double fontSize = 26,
    Color color = ink,
    FontWeight fontWeight = FontWeight.w700,
  }) =>
      serif(fontSize: fontSize, color: color, fontWeight: fontWeight);

  static TextStyle title({
    double fontSize = 18,
    Color color = ink,
    FontWeight fontWeight = FontWeight.w700,
  }) =>
      GoogleFonts.inter(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: 1.3,
      );

  static TextStyle body({
    double fontSize = 14,
    Color color = ink,
    FontWeight fontWeight = FontWeight.normal,
    double height = 1.42,
  }) =>
      GoogleFonts.inter(
        fontSize: fontSize,
        color: color,
        fontWeight: fontWeight,
        height: height,
      );

  static TextStyle label({
    double fontSize = 12,
    Color color = inkMuted,
    FontWeight fontWeight = FontWeight.w600,
  }) =>
      GoogleFonts.inter(
        fontSize: fontSize,
        color: color,
        fontWeight: fontWeight,
        height: 1.3,
      );

  static TextStyle metric({
    double fontSize = 28,
    Color color = ink,
  }) =>
      GoogleFonts.cinzel(
        fontSize: fontSize,
        fontWeight: FontWeight.w700,
        color: color,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  static ThemeData get lightTheme {
    final baseInter = GoogleFonts.inter;
    final baseTextTheme = GoogleFonts.interTextTheme();
    final fieldRadius = BorderRadius.circular(radiusField);

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      primaryColor: AppColors.primaryForest,
      scaffoldBackgroundColor: AppColors.surfaceLight,
      canvasColor: AppColors.surfaceLight,
      focusColor: focusRing,
      hoverColor: AppColors.sageMist,
      splashColor: AppColors.sageMist,
      colorScheme: const ColorScheme.light(
        primary: AppColors.primaryForest,
        onPrimary: Colors.white,
        secondary: AppColors.accentGold,
        onSecondary: Colors.white,
        surface: AppColors.cardSurface,
        onSurface: AppColors.textDark,
        error: AppColors.statusAlert,
        onError: Colors.white,
        outline: AppColors.cardBorder,
        surfaceTint: Colors.transparent,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.primaryDark,
        foregroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        toolbarHeight: 68,
        titleSpacing: 20,
        shape: const Border(
          bottom: BorderSide(color: AppColors.accentGold, width: 0.8),
        ),
        titleTextStyle: serif(
          fontSize: 19,
          fontWeight: FontWeight.w700,
          color: Colors.white,
          letterSpacing: 0.2,
        ),
        actionsIconTheme: const IconThemeData(color: Colors.white, size: 22),
        iconTheme: const IconThemeData(color: Colors.white, size: 22),
      ),
      cardTheme: CardThemeData(
        color: AppColors.cardSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusCard),
          side: const BorderSide(color: AppColors.cardBorder),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primaryForest,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.cardBorder,
          disabledForegroundColor: AppColors.textMuted,
          overlayColor: Colors.white.withValues(alpha: 0.12),
          elevation: 0,
          minimumSize: const Size(48, 50),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusField),
          ),
          textStyle: baseInter(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryForest,
          disabledForegroundColor: AppColors.textMuted,
          overlayColor: AppColors.sageMist,
          side: const BorderSide(color: AppColors.cardBorder),
          minimumSize: const Size(48, 50),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusField),
          ),
          textStyle: baseInter(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 50),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusField),
          ),
          textStyle: baseInter(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primaryForest,
          disabledForegroundColor: AppColors.textMuted,
          overlayColor: AppColors.sageMist,
          minimumSize: const Size(48, 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          textStyle: baseInter(fontSize: 14, fontWeight: FontWeight.w700),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: AppColors.primaryForest,
          disabledForegroundColor: AppColors.textMuted,
          focusColor: focusRing,
          hoverColor: AppColors.sageMist,
          highlightColor: AppColors.sageMist,
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.cardSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
        border: OutlineInputBorder(
          borderRadius: fieldRadius,
          borderSide: const BorderSide(color: AppColors.cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: fieldRadius,
          borderSide: const BorderSide(color: AppColors.cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: fieldRadius,
          borderSide: const BorderSide(color: AppColors.accentGoldDark, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: fieldRadius,
          borderSide: const BorderSide(color: AppColors.statusAlert),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: fieldRadius,
          borderSide: const BorderSide(color: AppColors.statusAlert, width: 1.6),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: fieldRadius,
          borderSide: const BorderSide(color: AppColors.cardBorder),
        ),
        labelStyle: baseInter(fontSize: 14, color: AppColors.textMuted),
        floatingLabelStyle: baseInter(
          fontSize: 13,
          color: AppColors.accentGoldDark,
          fontWeight: FontWeight.w700,
        ),
        hintStyle: baseInter(fontSize: 14, color: AppColors.textMuted),
        helperStyle: baseInter(fontSize: 12, color: AppColors.textMuted, height: 1.35),
        errorStyle: baseInter(fontSize: 12, color: AppColors.alertDangerText),
        prefixIconColor: AppColors.primaryForest,
        suffixIconColor: AppColors.textMuted,
      ),
      textTheme: baseTextTheme.copyWith(
        displaySmall: display(fontSize: 30),
        headlineLarge: display(fontSize: 26),
        headlineMedium: display(fontSize: 22),
        titleLarge: title(fontSize: 20),
        titleMedium: title(fontSize: 17),
        titleSmall: title(fontSize: 15),
        bodyLarge: body(fontSize: 16),
        bodyMedium: body(fontSize: 14),
        bodySmall: body(fontSize: 12, color: AppColors.textMuted),
        labelLarge: label(fontSize: 13, color: ink),
        labelMedium: label(),
        labelSmall: label(fontSize: 11),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.cardSurface,
        selectedColor: AppColors.primaryForest,
        surfaceTintColor: Colors.transparent,
        labelStyle: baseInter(fontSize: 13, color: AppColors.textDark),
        secondaryLabelStyle: baseInter(
          fontSize: 13,
          color: Colors.white,
          fontWeight: FontWeight.w700,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        side: const BorderSide(color: AppColors.cardBorder),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPill),
        ),
        checkmarkColor: Colors.white,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.cardSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleTextStyle: title(fontSize: 20),
        contentTextStyle: body(fontSize: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusCard),
        ),
        actionsPadding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.primaryDark,
        contentTextStyle: body(fontSize: 14, color: Colors.white),
        actionTextColor: AppColors.accentGoldLight,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusField),
        ),
        insetPadding: const EdgeInsets.all(16),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.cardSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.cardBorder,
        thickness: 1,
        space: 1,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.primaryForest,
        linearTrackColor: AppColors.surfaceSunken,
        circularTrackColor: AppColors.surfaceSunken,
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.primaryForest,
        foregroundColor: Colors.white,
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPanel),
        ),
      ),
      listTileTheme: ListTileThemeData(
        titleTextStyle: title(fontSize: 15),
        subtitleTextStyle: body(fontSize: 12, color: AppColors.textMuted),
        iconColor: AppColors.primaryForest,
        horizontalTitleGap: 14,
        minVerticalPadding: 12,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusPanel),
        ),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: AppColors.primaryDark,
        selectedItemColor: AppColors.accentGoldLight,
        unselectedItemColor: Colors.white.withValues(alpha: 0.62),
        selectedLabelStyle: baseInter(fontSize: 11, fontWeight: FontWeight.w700),
        unselectedLabelStyle: baseInter(fontSize: 11),
        selectedIconTheme: const IconThemeData(size: 23),
        unselectedIconTheme: const IconThemeData(size: 23),
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        showUnselectedLabels: true,
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: AppColors.primaryDark,
        indicatorColor: AppColors.accentGold,
        selectedIconTheme: const IconThemeData(color: Colors.white, size: 23),
        unselectedIconTheme:
            IconThemeData(color: Colors.white.withValues(alpha: 0.62), size: 23),
        selectedLabelTextStyle:
            baseInter(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w700),
        unselectedLabelTextStyle: baseInter(
          fontSize: 12,
          color: Colors.white.withValues(alpha: 0.62),
        ),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: AppColors.primaryDark,
          borderRadius: BorderRadius.circular(8),
        ),
        textStyle: baseInter(fontSize: 12, color: Colors.white),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
    );
  }
}
