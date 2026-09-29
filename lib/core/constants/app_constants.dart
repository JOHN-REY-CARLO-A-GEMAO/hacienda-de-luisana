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
  /// The Guest ↔ Admin conversation, its messages, and the live-location
  /// consent (ADR-0013).
  static const String colConversations = 'conversations';
  static const String subMessages = 'messages';
  static const String colLocationSessions = 'location_sessions';

  /// The longest a chat message may be, in characters.
  ///
  /// The same 1,000 as `MESSAGE_MAX` in `src/lib/validation.ts` and as
  /// `text.size() <= 1000` in `firestore.rules`. The rules are the enforcement;
  /// this is the field.
  static const int messageMax = 1000;

  /// How many messages a thread opens with, and how many one "load earlier"
  /// fetches. The website opens on 40 and steps back 30; the Admin reads the
  /// same thread, so it opens on the same page.
  static const int threadPageSize = 40;
  static const int olderPageSize = 30;

  // Resort contact line (shown to the Admin as the number Guests dial)
  static const String resortPhone = '09258507707';
  static const String resortPhoneDisplay = '(0925) 850 7707';
  static const String resortMessengerUrl = 'https://m.me/haciendadeluisana';

  /// The Supabase project the website uploads payment proofs to.
  ///
  /// Public by construction: the anon key ships inside the Vite bundle, so the
  /// host is public too. No key is kept here \u2014 the app proves who it is with
  /// its own Firebase ID token instead.
  static const String supabaseUrl = 'https://xgcjjzwdkxykdosxdzhn.supabase.co';

  /// The one function the Admin calls to read a proof (ADR-0011).
  ///
  /// Proofs live in a private bucket that grants non write and nothing else,
  /// so the app cannot fetch one with a key. It asks this function, which
  /// verifies the caller's token, requires profiles role admin, and hands back
  /// a URL that expires in 60 seconds.
  static const String paymentProofFunction = 'admin-payment-proof';
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
