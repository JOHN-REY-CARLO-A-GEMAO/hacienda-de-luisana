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
  /// Public, non-secret payment instructions shown during booking.
  static const String docPayment = 'payment';
  /// The Admin's Security PIN server copy — one doc per uid, own-doc-only
  /// in firestore.rules (ADR-0015). Not a Credential: that word is taken
  /// by the door RFID / Mobile Key (CONTEXT.md § Access).
  static const String colAdminSecurity = 'admin_security';
  /// The Guest ↔ Admin conversation, its messages, and the live-location
  /// consent (ADR-0013).
  static const String colConversations = 'conversations';
  static const String subMessages = 'messages';
  static const String colLocationSessions = 'location_sessions';

  /// The inquiry category a Guest opens first, and the one a Booking is about.
  static const String categoryBooking = 'booking';

  /// The document id a Guest's conversation for a category has.
  ///
  /// Derived, not random, and **the website derives it identically** — see
  /// `conversationDocId()` in `src/lib/chatCloud.ts`. The two apps share one
  /// Firestore project, so a Guest's thread on the website has to be the same
  /// document the Admin app opens, and a formula both sides write down is what
  /// guarantees that.
  ///
  /// It is derived rather than looked up because the rules refuse the lookup.
  /// `firestore.rules` reads membership with `isConversationMember(convoId)`,
  /// which resolves the conversation *by id*; on a `where('guest_uid','==',uid)`
  /// query the id is unbound, so Firestore cannot prove the query is safe and
  /// refuses it. The website hit exactly that and the chat page answered "Could
  /// not open the conversation."
  static String conversationId(String guestUid, String category) =>
      'inquiry-$guestUid-$category';

  /// A Guest's words about a finished stay, filed at the Booking's own id —
  /// which is what makes "one Review per stay" something `firestore.rules`
  /// enforces rather than something a form remembers (ADR-0014).
  static const String colReviews = 'reviews';
  /// What the website publishes: six fields the Admin chose out of a Review,
  /// written from scratch, in a collection a signed-out visitor may read. Not
  /// a copy of `reviews` with fields removed — see docs/REVIEWS.md.
  static const String colPublicReviews = 'public_reviews';
  /// The append-only log inside each Booking.
  static const String subActivity = 'activity';

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
