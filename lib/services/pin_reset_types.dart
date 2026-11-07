// The vocabulary of a forgotten-PIN reset (ADR-0027), with no imports at all.
//
// These four types are the seam between the PIN policy in `pin_store.dart` and
// the HTTP in `pin_reset_service.dart`. They live in their own file so that
// `pin_store.dart` keeps the promise its header makes — *no Flutter imports, and
// every policy decision testable against a MemoryPinStore* — without dragging
// `firebase_auth`, `http` and a network into a unit test about a lockout ladder.
//
// The flow they describe, in one place:
//
//   requestCode()  → the server mails six digits to the Admin's verified email
//   confirmCode()  → the server checks them, then deletes the PIN record
//
// Nothing here deletes anything, and nothing here can be satisfied by the PIN
// itself: the PIN is what was forgotten.

/// How long a mailed reset code stays usable. Mirrors `PIN_RESET_CODE_TTL_MS` in
/// `supabase/functions/_shared/pin-reset-code.ts`; `test/web/pin-reset.test.ts`
/// fails if the two drift, because the sheet prints this number as a promise.
const Duration kPinResetCodeTtl = Duration(minutes: 15);

/// Wrong entries a code survives before it is spent. Mirrors
/// `PIN_RESET_MAX_ATTEMPTS`.
const int kPinResetMaxAttempts = 5;

/// The Edge Function that mints and checks the code (ADR-0027).
const String kPinResetFunction = 'admin-pin-reset';

/// The two calls the app makes. Implemented by `PinResetService`.
///
/// Neither method throws: every failure is a value the sheet can show. That is
/// deliberate — this is the one screen an Admin reaches *because* something has
/// gone wrong, and a stack trace there is worse than useless.
abstract class PinResetRemote {
  /// Ask the function to mail a code to the Admin's verified address.
  Future<PinResetRequest> requestCode();

  /// Hand six digits back to the function, which either disposes of the PIN
  /// record or says why not.
  Future<PinResetCheck> confirmCode(String code);
}

/// What asking for a code produced.
class PinResetRequest {
  /// True only when the function confirmed the mail left.
  final bool sent;

  /// `g***s@gmail.com` — enough for the Admin to recognise the inbox, not
  /// enough for anybody else holding the phone to harvest it.
  final String? maskedEmail;

  /// How long the code that was mailed will last.
  final Duration? expiresIn;

  /// When the server asked us to wait, how long. Null otherwise.
  final Duration? retryAfter;

  /// The sentence to show when [sent] is false.
  final String? error;

  const PinResetRequest._({
    required this.sent,
    this.maskedEmail,
    this.expiresIn,
    this.retryAfter,
    this.error,
  });

  const PinResetRequest.sentTo(
    String this.maskedEmail, {
    required Duration this.expiresIn,
  })  : sent = true,
        retryAfter = null,
        error = null;

  const PinResetRequest.refused(String this.error, {this.retryAfter})
      : sent = false,
        maskedEmail = null,
        expiresIn = null;
}

/// How checking a code ended.
enum PinResetOutcome {
  /// The server disposed of the PIN record. The device copy may now go, and the
  /// gate asks for a new PIN.
  reset,

  /// Six digits that are not the code.
  wrongCode,

  /// The code was right once, or wrong too often, or too old.
  unusable,

  /// The server could not be reached, or refused for a reason that is ours to
  /// fix. Nothing changed.
  unavailable,
}

class PinResetCheck {
  final PinResetOutcome outcome;

  /// What to show the Admin. Always set, including on success, because the
  /// sheet says which of the two happened in words rather than in a colour.
  final String message;

  const PinResetCheck(this.outcome, this.message);
}
