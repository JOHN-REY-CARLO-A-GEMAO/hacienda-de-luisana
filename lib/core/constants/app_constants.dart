import 'package:flutter/material.dart';

class AppConstants {
  // Resort Info
  static const String appName = 'Hacienda de LuisAna';
  static const String appTagline = 'Admin — Resort Operations';
  static const String resortAddress = 'Luisiana, Laguna, Philippines';
  static const String resortFullAddress =
      'Luisiana–Lucban Road, Brgy. San Isidro, Luisiana, Laguna, Philippines';
  static const double resortLatitude = 14.1754304;
  static const double resortLongitude = 121.519389;
  static const String resortDirectionsUrl =
      'https://www.google.com/maps/dir/?api=1&destination=14.1754304,121.519389';
  
  // Firestore Collection Names
  static const String colBookings = 'bookings';
  /// Same collection the website writes when a Credential touches a lock
  /// (firestore.rules `access_logs`).
  static const String colSmartLockLogs = 'access_logs';
  static const String colRooms = 'rooms';
  static const String colGuestProfiles = 'guest_profiles';
  /// Payment references: the Admin's catalog of verified reference numbers,
  /// plus one row per Booking whose proof the Admin verified (reference,
  /// amount, sender, date, proof path, booking link). Admin-only in
  /// firestore.rules.
  static const String colPaymentReferences = 'payment_references';
  /// Published rates + cancellation policy the website quotes from
  /// (`site_config/rates`).
  static const String colSiteConfig = 'site_config';
  static const String docRates = 'rates';
  /// Public, non-secret payment instructions shown during booking.
  static const String docPayment = 'payment';

  /// The owner's official GCash payment QR code.
  ///
  /// The same file the website serves from `public/images/payment/` is bundled
  /// here (`assets/images/payment/`, byte-identical) so this screen can show the
  /// Admin exactly what a Guest scans. It is an image of the owner's own QR
  /// code — never draw or regenerate one, because a generated code points at a
  /// different account. Provenance: `public/images/payment/README.md`.
  static const String gcashQrAsset = 'assets/images/payment/gcash-qr.png';

  /// The path the website resolves the same asset at. This is what
  /// `site_config/payment.methods[].qr_image` publishes.
  static const String gcashQrPublishedPath = '/images/payment/gcash-qr.png';

  /// The line the website prints under the QR code when the published channel
  /// names none of its own.
  static const String gcashQrInstruction =
      'Scan this QR code using GCash to pay your downpayment.';

  /// The owner's official BDO InstaPay payment QR code, bundled alongside
  /// `gcashQrAsset` from `assets/images/payment/` (`public/images/payment/`).
  static const String bdoQrAsset = 'assets/images/payment/bdo-qr.png';
  static const String bdoQrPublishedPath = '/images/payment/bdo-qr.png';
  static const String bdoQrInstruction =
      'Scan this QR code using BDO to pay your downpayment.';
  /// The Admin's Security PIN server copy — one doc per uid, own-doc-only
  /// in firestore.rules (ADR-0015). Not a Credential: that word is taken
  /// by the door RFID / Mobile Key (CONTEXT.md § Access).
  static const String colAdminSecurity = 'admin_security';
  /// The append-only trail of a forgotten-PIN reset (ADR-0016). Exists so the
  /// evidence outlives the `admin_security` record it describes — the Firebase
  /// console can delete that record and leave no trace, this cannot be edited
  /// or erased at all. Created in the same batch as the delete it records, and
  /// never updated. `activity` is NOT used: it is a Booking subcollection with a
  /// closed `knownAction()` vocabulary, and a PIN reset belongs to no Booking.
  static const String colAdminSecurityEvents = 'admin_security_events';
  /// The Guest ↔ Admin conversation, its messages, and the live-location
  /// consent (ADR-0013).
  static const String colConversations = 'conversations';
  static const String subMessages = 'messages';
  static const String colLocationSessions = 'location_sessions';

  /// The inquiry category a Guest opens first, and the one a Booking is about.
  static const String categoryBooking = 'booking';

  /// The document id a Guest's conversation for a booking has.
  ///
  /// One continuous conversation per guest booking — no topic-based threads.
  /// Derived, not random, and **the website derives it identically** — see
  /// `ensureBookingConversation` in `src/lib/chatCloud.ts`. The two apps share
  /// one Firestore project, so a Guest's thread on the website has to be the
  /// same document the Admin app opens, and a formula both sides write down is
  /// what guarantees that.
  ///
  /// It is derived rather than looked up because the rules refuse the lookup.
  /// `firestore.rules` reads membership with `isConversationMember(convoId)`,
  /// which resolves the conversation *by id*; on a `where('guest_uid','==',uid)`
  /// query the id is unbound, so Firestore cannot prove the query is safe and
  /// refuses it.
  static String conversationId(String bookingId) => 'booking-$bookingId';

  /// Legacy deterministic topic conversation id (`inquiry-<uid>-<category>`),
  /// preserved for non-destructive backward compatibility with earlier stays.
  static String legacyConversationId(String uid, String category) =>
      'inquiry-$uid-$category';

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
  /// The Admin app's "field ledger" palette.
  ///
  /// Pine is structural, paper is the working surface, and brass is reserved
  /// for the active place or the next decision. Status colours are dark enough
  /// to remain readable as text on paper; their tinted fills are decorative
  /// only and never the sole status signal.
  static const Color primaryDark = Color(0xFF10271B);
  static const Color primaryForest = Color(0xFF1E3A2B);
  static const Color primaryForestLight = Color(0xFF3C6148);

  static const Color accentGold = Color(0xFFB88735);
  static const Color accentGoldLight = Color(0xFFEBD6A6);
  static const Color accentGoldDark = Color(0xFF7F5D1F);

  static const Color surfaceLight = Color(0xFFF5F3EC);
  static const Color surfaceSunken = Color(0xFFECEBE1);
  static const Color cardSurface = Color(0xFFFFFEF9);
  static const Color cardBorder = Color(0xFFD7DCD0);

  static const Color textDark = Color(0xFF17251A);
  static const Color textMuted = Color(0xFF5C6B5E);

  static const Color statusSuccess = Color(0xFF2F6B4F);
  static const Color statusWarning = Color(0xFF9A5F15);
  static const Color statusAlert = Color(0xFFA43D31);
  static const Color statusInfo = Color(0xFF315A69);
  static const Color statusNeutral = Color(0xFF5B675C);

  /// A pale botanical wash for quiet inner panels and selected rows.
  static const Color sageMist = Color(0xFFE9EFE4);
  static const Color goldMist = Color(0xFFF5EBD4);
  static const Color dangerMist = Color(0xFFF8E8E3);
  static const Color infoMist = Color(0xFFE4EEF1);

  // Inline alert surface — one shape for an error or a warning band, so a
  // screen cannot invent its own red (there were four different ones).
  static const Color alertDangerSurface = Color(0xFFF8E8E3);
  static const Color alertDangerBorder = Color(0xFFE7C1B8);
  static const Color alertDangerText = Color(0xFF8C2F25);
}
