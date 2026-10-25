import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';

/// The Security gate's second tier (ADR-0015): one confirm modal, built once,
/// that every "requires a confirm" action goes through — the stay
/// transitions, the recorded expiry, sign-out, the live-location reader
/// grant, room status and price overrides, payment-reference changes.
///
/// This absorbs the Booking detail screen's private `_confirm`, so the
/// wording, the Cinzel title and the `Bumalik` / confirm pair are the same at
/// every call site. `danger` turns the confirm button statusAlert for the
/// actions whose mistake is a deletion or a lockout.
///
/// The actions stack so long labels remain readable at larger text sizes.
Future<bool> showSecureConfirm(
  BuildContext context, {
  required String title,
  required String body,
  String confirm = 'Kumpirmahin',
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title,
          style: GoogleFonts.cinzel(
              fontWeight: FontWeight.bold, fontSize: 20, height: 1.25)),
      content: Text(body),
      actions: [
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Bumalik'),
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
      ],
    ),
  );
  return ok ?? false;
}
