import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';

/// The Security gate's second tier (ADR-0015): one confirm modal, built once,
/// that every "requires a confirm" action goes through — the stay
/// transitions, the recorded expiry, sign-out, the live-location reader
/// grant, room status and price overrides, payment-reference changes.
///
/// This absorbs the Booking detail screen's private `_confirm`, so the
/// wording, the Cinzel title and the `Back` / confirm pair are the same at
/// every call site. `danger` turns the confirm button statusAlert for the
/// actions whose mistake is a deletion or a lockout.
///
/// The cancel word is `Back`, as the rest of the app's dialogs.
Future<bool> showSecureConfirm(
  BuildContext context, {
  required String title,
  required String body,
  String confirm = 'Confirm',
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title,
          style: GoogleFonts.cinzel(
              fontWeight: FontWeight.bold, fontSize: 16)),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Back'),
        ),
        ElevatedButton(
          style: danger
              ? ElevatedButton.styleFrom(backgroundColor: AppColors.statusAlert)
              : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirm),
        ),
      ],
    ),
  );
  return ok ?? false;
}
