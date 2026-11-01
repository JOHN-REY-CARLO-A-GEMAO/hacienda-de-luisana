// The Admin-side read of a payment proof (ADR-0011).
//
// A Booking's `payment_proof_url` is a Supabase *storage path*
// (`payments/{uid}/{ref}/proof-1.jpg`), not a link. The bucket is private and
// grants the `anon` role write and nothing else, so there is no URL the app can
// simply open, and the `anon` key cannot sign one either — that is deliberate:
// an anon read policy would publish every Guest's GCash or Maya reference to
// anyone who loads the website.
//
// So the app asks the `admin-payment-proof` function, which verifies the
// caller's Firebase ID token, requires `profiles/{uid}.role == 'admin'`, and
// returns a URL good for 60 seconds. Short-lived on purpose: long enough to
// open the screenshot, not long enough to forward.
//
// The value sent is whatever the Booking holds, and that field has carried more
// than one shape over the years (an older uploader wrote `proof.{ext}`, and a
// stored address can be a URL instead of a key). The function reduces it to the
// key it names — the reasoning is in `supabase/functions/_shared/proof-path.ts`
// — and when the value is not something it can sign at all, it says what the
// value *is*: that sentence is the only way an Admin can tell a missing upload
// from a receipt stranded in the old Firebase bucket.
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../core/constants/app_constants.dart';

/// What the function said, or why it could not say.
class PaymentProofResult {
  final String? url;
  final String? error;

  const PaymentProofResult._({this.url, this.error});

  const PaymentProofResult.ok(String url) : this._(url: url);
  const PaymentProofResult.failed(String message) : this._(error: message);
}

class PaymentProofService {
  const PaymentProofService._();

  static final PaymentProofService instance = const PaymentProofService._();

  static final _client = http.Client();

  /// Ask for a viewable copy of the proof stored at [path].
  ///
  /// Never throws: a phone screen is a bad place for a stack trace, and every
  /// failure here is something the Admin can read and act on.
  static Future<PaymentProofResult> signedUrl(String path) async {
    // The stored value, not a value this app built: it can carry a stray space
    // from a hand-edited document, and an empty one means there is nothing to
    // ask for at all.
    final stored = path.trim();
    if (stored.isEmpty) {
      return const PaymentProofResult.failed(
          'Walang nakalakip na patunay sa Booking na ito.');
    }

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return const PaymentProofResult.failed('Sign in again to open a proof.');
    }

    // A stale token is the likeliest reason a real Admin gets turned away after
    // a long shift, so force a refresh rather than sending whatever is cached.
    String token;
    try {
      token = await user.getIdToken(true) ?? '';
    } catch (_) {
      return const PaymentProofResult.failed(
          'Could not confirm your sign-in. Sign in again.');
    }
    if (token.isEmpty) {
      return const PaymentProofResult.failed(
          'Could not confirm your sign-in. Sign in again.');
    }

    final uri = Uri.parse(
        '${AppConstants.supabaseUrl}/functions/v1/${AppConstants.paymentProofFunction}');

    try {
      final response = await _client
          .post(uri,
              headers: {
                'authorization': 'Bearer $token',
                'content-type': 'application/json',
              },
              body: jsonEncode({'path': stored}))
          .timeout(const Duration(seconds: 20));

      if (response.statusCode != 200) {
        return PaymentProofResult.failed(_explain(response));
      }

      final decoded = jsonDecode(response.body);
      final url = decoded is Map ? decoded['url'] : null;
      if (url is! String || url.isEmpty) {
        return const PaymentProofResult.failed(
            'The proof service returned no link. Try again in a moment.');
      }
      return PaymentProofResult.ok(url);
    } catch (_) {
      return const PaymentProofResult.failed(
          'Could not reach the proof service. Check the connection and try again.');
    }
  }

  /// The function's own words where it gave any, and a next step where it did
  /// not — a bare HTTP status tells the Admin nothing they can act on.
  ///
  /// The 404 is deliberately split in two. Supabase's own gateway answers an
  /// undeployed function with `{"code":"NOT_FOUND","message":"Requested function
  /// was not found"}`, and the function itself answers a missing proof with
  /// `{"error":"No proof is stored at that path."}`. Both are a 404, and they
  /// are opposite problems: telling an Admin their receipt is gone when the
  /// service simply has not been deployed yet sends them looking in the wrong
  /// place entirely. So the body decides, not the status.
  ///
  /// The exception to "the function's own words" is `NOT_A_PROOF_PATH`: there
  /// the function is describing the *stored record*, and the record is the one
  /// thing the Admin standing at the door needs to see.
  static String _explain(http.Response response) {
    final body = _body(response);

    // The function refused the *stored value* rather than the request: the
    // receipt the Admin is trying to open is recorded as something that is not
    // an object in the proofs bucket. The value itself is the only thing that
    // makes this fixable, so it goes on the screen — shortened, because a
    // SnackBar is two lines — instead of the function's terse English.
    if (body != null && body['code'] == 'NOT_A_PROOF_PATH') {
      final problem = (body['problem'] as String?)?.trim() ?? '';
      final recorded = (body['recorded'] as String?)?.trim() ?? '';
      if (problem == 'empty') {
        return 'Walang nakalakip na patunay sa Booking na ito.';
      }
      if (problem == 'legacy-storage') {
        return 'Nasa lumang storage (Firebase) ang patunay na ito, kaya hindi '
            'ito mabubuksan dito. Ipa-resend sa bisita.';
      }
      if (recorded.isEmpty) {
        return 'Hindi mabuksan ang patunay: ang naka-record na link ay hindi '
            'wastong storage path (dapat payments/…).';
      }
      final shown =
          recorded.length > 80 ? '${recorded.substring(0, 80)}…' : recorded;
      return 'Hindi ito mabuksan: ang naka-record na "$shown" ay hindi storage '
          'path ng patunay (dapat payments/…). Ipa-resend sa bisita.';
    }

    final said = _errorField(body);
    if (said != null) return said;

    final notDeployed = response.statusCode == 404 &&
        response.body.contains('NOT_FOUND') &&
        !response.body.contains('"error"');

    return switch (response.statusCode) {
      400 => 'Hindi mabuksan ang patunay: hindi tinanggap ng service ang '
          'naka-record na path.',
      401 => 'That sign-in could not be verified. Sign in again.',
      403 => 'Only the Admin may open a payment proof.',
      404 when notDeployed =>
        'The payment proof service is not deployed yet, so no proof can be opened.',
      404 => 'No proof is stored at that path.',
      _ => 'The proof service is unavailable (${response.statusCode}).',
    };
  }

  /// The body as JSON, when it is JSON.
  static Map<String, dynamic>? _body(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) return decoded.cast<String, dynamic>();
    } catch (_) {
      // Not JSON — the gateway's own error page, for instance.
    }
    return null;
  }

  /// The `error` the function wrote, if this body is the function's own.
  static String? _errorField(Map<String, dynamic>? body) {
    final said = body?['error'];
    if (said is String && said.isNotEmpty) return said;
    return null;
  }
}
