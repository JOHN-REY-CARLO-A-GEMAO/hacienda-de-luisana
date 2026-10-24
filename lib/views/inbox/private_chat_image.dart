import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/constants/app_constants.dart';
import '../../services/chat_attachment_service.dart';

/// Loads a private message image with Firebase Auth, then keeps only its bytes
/// in memory. There is no public URL to copy out of the message.
class PrivateChatImage extends StatefulWidget {
  const PrivateChatImage({
    super.key,
    required this.attachment,
    this.caption,
    this.service,
  });

  final ChatAttachment attachment;
  final String? caption;
  final ChatAttachmentService? service;

  @override
  State<PrivateChatImage> createState() => _PrivateChatImageState();
}

class _PrivateChatImageState extends State<PrivateChatImage> {
  late final ChatAttachmentService _service = widget.service ?? ChatAttachmentService();
  Uint8List? _bytes;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PrivateChatImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.path != widget.attachment.path) {
      _bytes = null;
      _error = null;
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final bytes = await _service.read(widget.attachment);
      if (mounted) setState(() => _bytes = bytes);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'This private image could not be loaded. Check your connection and access.');
      }
    }
  }

  void _retry() {
    setState(() {
      _bytes = null;
      _error = null;
    });
    _load();
  }

  void _enlarge() {
    final bytes = _bytes;
    if (bytes == null) return;
    showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(16),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 1000,
            maxHeight: MediaQuery.of(dialogContext).size.height * 0.88,
          ),
          child: Stack(
            children: [
              Positioned.fill(
                child: InteractiveViewer(
                  minScale: 1,
                  maxScale: 4,
                  child: Center(child: Image.memory(bytes, fit: BoxFit.contain)),
                ),
              ),
              Positioned(
                top: 8,
                right: 8,
                child: IconButton.filled(
                  tooltip: 'Close larger image',
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  icon: const Icon(Icons.close),
                ),
              ),
              if (widget.caption?.isNotEmpty == true)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    color: Colors.black87,
                    padding: const EdgeInsets.all(12),
                    child: Text(widget.caption!, style: const TextStyle(color: Colors.white)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    if (error != null) {
      return Container(
        width: 240,
        padding: const EdgeInsets.all(12),
        color: AppColors.surfaceLight,
        child: Column(
          children: [
            Text(error, style: const TextStyle(fontSize: 12, color: AppColors.textDark)),
            TextButton.icon(
              onPressed: _retry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Retry image'),
            ),
          ],
        ),
      );
    }
    final bytes = _bytes;
    if (bytes == null) {
      return Container(
        width: 240,
        height: 120,
        alignment: Alignment.center,
        color: AppColors.surfaceLight,
        child: const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    return Semantics(
      button: true,
      label: 'Private image attachment. Double tap to enlarge.',
      child: InkWell(
        onTap: _enlarge,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(9),
          child: Image.memory(
            bytes,
            width: 240,
            height: 180,
            fit: BoxFit.cover,
            gaplessPlayback: true,
            errorBuilder: (_, __, ___) => Container(
              width: 240,
              height: 120,
              alignment: Alignment.center,
              color: AppColors.surfaceLight,
              child: const Text('The selected file is not a displayable image.'),
            ),
          ),
        ),
      ),
    );
  }
}
