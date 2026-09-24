import 'package:flutter/material.dart';

class AppConstants {
  // Resort Info
  static const String appName = 'Hacienda de LuisAna';
  static const String appTagline = 'Admin — Resort Operations';
  static const String resortAddress = 'Luisiana, Laguna, Philippines';
  
  // Firestore Collection Names
  static const String colBookings = 'bookings';
  /// Same collection the website writes when a Credential touches a lock
  /// (firestore.rules `access_logs`).
  static const String colSmartLockLogs = 'access_logs';
  static const String colRooms = 'rooms';
  static const String colGuestProfiles = 'guest_profiles';
  /// Published rates + cancellation policy the website quotes from
  /// (`site_config/rates`).
  static const String colSiteConfig = 'site_config';
  static const String docRates = 'rates';

  // Resort contact line (shown to the Admin as the number Guests dial)
  static const String resortPhone = '09258507707';
  static const String resortPhoneDisplay = '(0925) 850 7707';
  static const String resortMessengerUrl = 'https://m.me/haciendadeluisana';
}

class AppColors {
  // Luxurious Nature-Resort Palette
  static const Color primaryDark = Color(0xFF0D2818);
  static const Color primaryForest = Color(0xFF1E3A2F);
  static const Color primaryForestLight = Color(0xFF2D5A46);

  static const Color accentGold = Color(0xFFD4AF37);
  static const Color accentGoldLight = Color(0xFFF3E5AB);
  static const Color accentGoldDark = Color(0xFFA67C00);

  static const Color surfaceLight = Color(0xFFF8F9FA);
  static const Color cardSurface = Colors.white;
  static const Color cardBorder = Color(0xFFE2E8F0);

  static const Color textDark = Color(0xFF0F172A);
  static const Color textMuted = Color(0xFF64748B);

  static const Color statusSuccess = Color(0xFF2A9D8F);
  static const Color statusWarning = Color(0xFFE76F51);
  static const Color statusAlert = Color(0xFFE63946);
  static const Color statusInfo = Color(0xFF264653);
}
