// The emailed code that lets a locked-out Admin set a forgotten Security PIN
// aside (ADR-0027).
//
// ADR-0016 closed the permanent lockout by letting the Admin's own signed-in
// session delete `admin_security/{uid}` after a 24 h cooldown, and it said
// plainly what that cost: anyone holding a signed-in, unlocked phone could wipe
// the record and choose a new PIN. This file is the far side of the replacement
// door. The delete now happens on the server, and only after this app has shown
// that the person holding the phone can read the Admin's own verified email:
//
//   requestCode()  ──► admin-pin-reset { action: 'request' }
//                      the function mints six digits, keeps a salted hash, and
//                      mails them; this app only learns the masked address
//   confirmCode()  ──► admin-pin-reset { action: 'verify', code }
//                      the function checks the digest, spends the code, and
//                      disposes of the PIN record
//
// The app never sees, stores, or hashes a code: six digits typed in go straight
// up the wire over TLS and are compared where they were made. That is on
// purpose — a verifier on the phone is a verifier a patched phone can skip.
//
// The vocabulary (`PinResetRemote`, `PinResetRequest`, `PinResetCheck`,
// `PinResetOutcome`) lives in `pin_reset_types.dart` and is re-exported here, so
// a caller imports this one file and `pin_store.dart` stays import-free.
//
// Nothing here throws: every failure is a sentence the sheet can show, because a
// phone screen is a bad place for a stack trace. The one thing this never does
// is claim a reset that did not happen.

import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:http/http.dart' as http;

import '../core/constants/app_constants.dart';
import 'pin_reset_types.dart';

export 'pin_reset_types.dart';

/// The real remote: Firebase ID token, then plain JSON over HTTPS to Supabase.
///
/// The shape and the reasons mirror `PaymentProofService` (ADR-0011): a forced
/// token refresh, a 20-second ceiling, and every failure turned into a sentence.
class PinResetService implements PinResetRemote {
  const PinResetService._();

  static final PinResetService instance = const PinResetService._();

  static final _client = http.Client();

  bool get _hasFirebase {
    try {
      return Firebase.apps.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  /// The bearer token, refreshed rather than cached: an Admin reaching this
  /// screen has usually been in the app for a while, and a stale hour-old token
  /// is the likeliest reason a real person gets turned away.
  Future<String?> _idToken() async {
    if (!_hasFirebase) return null;
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) return null;
      final token = await user.getIdToken(true) ?? '';
      return token.isEmpty ? null : token;
    } catch (_) {
      return null;
    }
  }

  Uri get _endpoint => Uri.parse(
      '${AppConstants.supabaseUrl}/functions/v1/$kPinResetFunction');

  @override
  Future<PinResetRequest> requestCode() async {
    final token = await _idToken();
    if (token == null) {
      return const PinResetRequest.refused(
          'Sign in again before resetting the PIN.');
    }

    http.Response response;
    try {
      response = await _client
          .post(
            _endpoint,
            headers: {
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode({'action': 'request'}),
          )
          .timeout(const Duration(seconds: 20));
    } catch (_) {
      return const PinResetRequest.refused(
          'Could not reach the reset service. Check the connection and try '
          'again.');
    }

    final body = _decode(response.body);
    if (response.statusCode == 200) {
      final masked = body?['maskedEmail'];
      final seconds = body?['expiresIn'];
      return PinResetRequest.sentTo(
        masked is String && masked.isNotEmpty ? masked : 'your registered email',
        expiresIn: seconds is int && seconds > 0
            ? Duration(seconds: seconds)
            : kPinResetCodeTtl,
      );
    }

    final message = body?['error'];
    final retryMs = body?['retryAfterMs'];
    return PinResetRequest.refused(
      message is String && message.isNotEmpty
          ? message
          : _explainStatus(response.statusCode),
      retryAfter: retryMs is int && retryMs > 0
          ? Duration(milliseconds: retryMs)
          : null,
    );
  }

  @override
  Future<PinResetCheck> confirmCode(String code) async {
    final token = await _idToken();
    if (token == null) {
      return const PinResetCheck(PinResetOutcome.unavailable,
          'Sign in again before resetting the PIN.');
    }

    http.Response response;
    try {
      response = await _client
          .post(
            _endpoint,
            headers: {
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode({'action': 'verify', 'code': code}),
          )
          .timeout(const Duration(seconds: 20));
    } catch (_) {
      return const PinResetCheck(PinResetOutcome.unavailable,
          'Could not reach the reset service. Nothing was changed — check the '
          'connection and try again.');
    }

    final body = _decode(response.body);
    if (response.statusCode == 200 && body?['reset'] == true) {
      return const PinResetCheck(
          PinResetOutcome.reset, 'The old PIN is set aside.');
    }

    final reason = body?['reason'];
    final message = body?['error'];
    final text = message is String && message.isNotEmpty
        ? message
        : _explainStatus(response.statusCode);

    if (reason == 'mismatch') {
      return PinResetCheck(PinResetOutcome.wrongCode, text);
    }
    if (reason == 'spent' || reason == 'expired' || reason == 'consumed') {
      return PinResetCheck(PinResetOutcome.unusable, text);
    }
    return PinResetCheck(PinResetOutcome.unavailable, text);
  }

  /// The function's own words where it gave any. A bare status is only the
  /// fallback, because "500" is not a next step.
  String _explainStatus(int status) {
    switch (status) {
      case 401:
        return 'That sign-in could not be verified. Sign in again.';
      case 403:
        return 'Only the Admin may reset a Security PIN.';
      case 429:
        return 'Too many codes have been asked for. Wait a few minutes.';
      case 503:
        return 'The reset service is not available just now. Try again in a '
            'moment.';
      default:
        return 'The reset service answered unexpectedly. Nothing was changed.';
    }
  }

  Map<String, dynamic>? _decode(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }
}
