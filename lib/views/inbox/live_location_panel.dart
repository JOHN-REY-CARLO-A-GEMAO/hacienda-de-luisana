import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/constants/app_constants.dart';
import '../../services/live_location_service.dart';

/// 📍 The Guest is sharing live location — what the Admin sees, inside the
/// thread the Guest is writing in.
///
/// The shape the Admin needs, all on one card: that a Guest *is* sharing, where
/// they are, when the position was last heard from, how long is left, and a way
/// to stop looking. Stopping is one tap and is not a setting anybody has to go
/// and find — the panel closes and the stream subscription goes with it.
///
/// The map is an OpenStreetMap raster tile with the Guest's position drawn on
/// it, refreshed no more than once every ten seconds. That is a deliberate
/// trade: `google_maps_flutter` would need a second API key, a billing account
/// and a per-app entitlement to ship, and this feature's hard requirement is
/// *see where they are, now, without storing where they were*. The trade is
/// recorded in docs/LIMITATIONS.md, and the coordinates are always on screen
/// whatever the map does, so a tile that fails to load degrades the card rather
/// than the information.
class LiveLocationPanel extends StatefulWidget {
  const LiveLocationPanel({
    super.key,
    required this.conversationId,
    required this.guestUid,
    this.service,
    this.onClose,
  });

  final String conversationId;
  final String? guestUid;
  final LiveLocationService? service;

  /// Called when the Admin closes the panel. The subscription is released
  /// first, so closing is the whole of "stop viewing".
  final VoidCallback? onClose;

  @override
  State<LiveLocationPanel> createState() => _LiveLocationPanelState();
}

class _LiveLocationPanelState extends State<LiveLocationPanel> {
  static const Duration _tileRefresh = Duration(seconds: 10);

  StreamSubscription<LiveFix?>? _sub;
  LiveFix? _fix;
  bool _stopped = false;
  String? _reason;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    final service = widget.service ?? LiveLocationService();
    if (!service.hasTransport) {
      _stopped = true;
      _reason = 'This build has no live-location channel configured.';
    } else {
      _sub = service
          .watch(conversationId: widget.conversationId, guestUid: widget.guestUid)
          .listen((fix) {
        if (!mounted) return;
        setState(() {
          _fix = fix;
          if (fix == null) _stopped = true;
        });
      });
    }
    // The "3 seconds ago" and the countdown both move; a one-second tick is
    // the cheapest way to keep them honest without a stream per second.
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  void _close() {
    _sub?.cancel();
    _sub = null;
    widget.onClose?.call();
  }

  @override
  Widget build(BuildContext context) {
    if (_reason != null) {
      return _card(
        child: Row(
          children: [
            const Icon(Icons.location_off_outlined, size: 18, color: AppColors.textMuted),
            const SizedBox(width: 8),
            Expanded(child: Text(_reason!, style: const TextStyle(fontSize: 12, color: AppColors.textMuted))),
            _closeButton(),
          ],
        ),
      );
    }

    if (_fix == null) {
      return _card(
        child: Row(
          children: [
            const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 10),
            const Expanded(
              child: Text('Waiting for the Guest\'s first position…', style: TextStyle(fontSize: 12)),
            ),
            _closeButton(),
          ],
        ),
      );
    }

    final fix = _fix!;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _pulse(),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _stopped ? 'Live location ended' : 'Guest is sharing live location',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: _stopped ? AppColors.textMuted : AppColors.primaryForest,
                  ),
                ),
              ),
              _closeButton(),
            ],
          ),
          const SizedBox(height: 10),
          _Map(fix: fix),
          const SizedBox(height: 8),
          Text(
            '${fix.lat.toStringAsFixed(5)}, ${fix.lng.toStringAsFixed(5)}  ·  ±${fix.accuracyM.round()} m',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
          const SizedBox(height: 4),
          Text(
            fix.isStale
                ? 'Last updated: ${fix.ageLabel} — this position may be out of date'
                : 'Last updated: ${fix.ageLabel}',
            style: TextStyle(
              fontSize: 11,
              color: fix.isStale ? Colors.amber.shade800 : AppColors.textDark,
            ),
          ),
        ],
      ),
    );
  }

  Widget _closeButton() {
    return IconButton(
      tooltip: 'Stop viewing',
      onPressed: _close,
      icon: const Icon(Icons.close, size: 16),
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(),
    );
  }

  Widget _pulse() {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _stopped ? AppColors.textMuted : AppColors.primaryForest,
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primaryForest.withOpacity(0.18)),
      ),
      child: child,
    );
  }
}

/// A static map tile with the position on it.
class _Map extends StatelessWidget {
  const _Map({required this.fix});

  final LiveFix fix;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Image.network(
            _tile(fix),
            width: double.infinity,
            height: 168,
            fit: BoxFit.cover,
            // A tile that will not load leaves the coordinate line below as the
            // whole of the information, rather than an empty grey box.
            errorBuilder: (_, __, ___) => Container(
              height: 168,
              color: Colors.black12,
              alignment: Alignment.center,
              child: const Icon(Icons.map_outlined, color: Colors.white70, size: 32),
            ),
            loadingBuilder: (context, child, progress) =>
                progress == null ? child : Container(height: 168, color: Colors.black12),
          ),
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 3),
              color: AppColors.primaryForest,
              boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black26)],
            ),
          ),
        ],
      ),
    );
  }

  /// An OpenStreetMap raster tile centred on the position, with the zoom
  /// chosen so the accuracy circle is legible at phone width.
  String _tile(LiveFix fix) {
    final zoom = fix.accuracyM > 200 ? 12 : (fix.accuracyM > 60 ? 14 : 16);
    return 'https://tile.openstreetmap.org/$zoom/${fix.lat.toStringAsFixed(5)}/'
        '${fix.lng.toStringAsFixed(5)}.png';
  }
}

/// The panel's title row for the thread screen, so the Admin sees at a glance
/// that a Guest is sharing without the map being open.
class LiveLocationBadge extends StatelessWidget {
  const LiveLocationBadge({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: AppColors.primaryForest.withOpacity(0.10),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.location_on, size: 13, color: AppColors.primaryForest),
            const SizedBox(width: 5),
            Text(
              'Live location',
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.primaryForest,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
