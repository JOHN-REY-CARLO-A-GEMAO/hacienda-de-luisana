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
              body: jsonEncode({'path': path}))
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
  static String _explain(http.Response response) {
    final said = _errorField(response);
    if (said != null) return said;

    final notDeployed = response.statusCode == 404 &&
        response.body.contains('NOT_FOUND') &&
        !response.body.contains('"error"');

    return switch (response.statusCode) {
      401 => 'That sign-in could not be verified. Sign in again.',
      403 => 'Only the Admin may open a payment proof.',
      404 when notDeployed =>
        'The payment proof service is not deployed yet, so no proof can be opened.',
      404 => 'No proof is stored at that path.',
      _ => 'The proof service is unavailable (${response.statusCode}).',
    };
  }

  /// The `error` the function wrote, if this body is the function's own.
  static String? _errorField(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map && decoded['error'] is String) {
        final said = decoded['error'] as String;
        if (said.isNotEmpty) return said;
      }
    } catch (_) {
      // Not JSON, or not the shape we expect: fall through to the status.
    }
    return null;
  }
}
