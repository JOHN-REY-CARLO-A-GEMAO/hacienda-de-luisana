// Full-screen view of one payment proof.
//
// The Admin's whole job at this moment is to read a GCash or Maya screenshot —
// a reference number, an amount, a date — and decide. So it opens as a photo,
// zoomable with two fingers, rather than a preview in a list: the numbers have
// to be legible on a phone held at arm's length.
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';

class PaymentProofViewer extends StatelessWidget {
  final String url;

  const PaymentProofViewer({super.key, required this.url});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text('Payment proof',
            style: GoogleFonts.inter(
                fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white)),
      ),
      // The signed URL lives 60 seconds, so a failed load usually means it
      // expired under the viewer rather than that the proof is gone. Say which.
      body: Center(
        child: InteractiveViewer(
          maxScale: 6,
          minScale: 1,
          child: Image.network(
            url,
            fit: BoxFit.contain,
            loadingBuilder: (context, child, progress) {
              if (progress == null) return child;
              return const Center(
                child: CircularProgressIndicator(color: Colors.white),
              );
            },
            errorBuilder: (context, error, stack) => _Expired(
              onClose: () => Navigator.of(context).maybePop(),
            ),
          ),
        ),
      ),
    );
  }
}

class _Expired extends StatelessWidget {
  final VoidCallback onClose;

  const _Expired({required this.onClose});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.image_not_supported_outlined,
              color: Colors.white70, size: 40),
          const SizedBox(height: 14),
          Text('That link has expired',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                  fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white)),
          const SizedBox(height: 8),
          Text(
            'Payment proof links last 60 seconds so they cannot be forwarded. Close this and tap the button again.',
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: onClose,
            style: FilledButton.styleFrom(
                backgroundColor: AppColors.accentGold, foregroundColor: Colors.black),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}
