import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/services.dart';

/// The same contract as src/lib/chatAttachments.ts and storage.rules.
const int kChatImageMaxBytes = 5 * 1024 * 1024;
const List<String> kChatImageTypes = <String>['image/jpeg', 'image/png', 'image/webp'];

class ChatImage {
  const ChatImage({required this.name, required this.type, required this.bytes});

  final String name;
  final String type;
  final Uint8List bytes;
}

/// Uses Android's Storage Access Framework. Selection is explicit and per-image;
/// no gallery-wide permission is requested.
class ChatImagePicker {
  static const MethodChannel _channel = MethodChannel('hacienda/message-attachments');

  static Future<ChatImage?> pick() async {
    final result = await _channel.invokeMapMethod<String, dynamic>('pick');
    if (result == null) return null;
    final name = (result['name'] as String?) ?? 'image';
    final declared = ((result['type'] as String?) ?? '').toLowerCase();
    final type = _imageType(name, declared);
    if (type == null) {
      throw StateError('Choose a JPEG, PNG, or WebP image. PDF, HEIC, GIF, and other files are not supported.');
    }
    final bytes = base64Decode(result['base64'] as String);
    if (bytes.isEmpty || bytes.length > kChatImageMaxBytes) {
      throw StateError('Images must be between 1 byte and 5 MB.');
    }
    return ChatImage(name: name, type: type, bytes: bytes);
  }

  static String? _imageType(String name, String declared) {
    if (declared == 'image/jpg') return 'image/jpeg';
    if (kChatImageTypes.contains(declared)) return declared;
    if (declared.isNotEmpty) return null;
    final lower = name.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return null;
  }
}

class ChatAttachment {
  const ChatAttachment({required this.path, required this.contentType, required this.size});

  final String path;
  final String contentType;
  final int size;

  Map<String, dynamic> toMap() => <String, dynamic>{
        'path': path,
        'content_type': contentType,
        'size': size,
      };

  static ChatAttachment? fromMessage(Map<String, dynamic> message) {
    final raw = message['attachment'];
    if (raw is! Map) return null;
    final path = raw['path'];
    final type = raw['content_type'];
    final size = raw['size'];
    if (path is! String ||
        !RegExp(r'^messageAttachments/[^/]+/[^/]+$').hasMatch(path) ||
        type is! String ||
        !kChatImageTypes.contains(type) ||
        size is! num ||
        size <= 0 ||
        size > kChatImageMaxBytes) {
      return null;
    }
    return ChatAttachment(path: path, contentType: type, size: size.toInt());
  }
}

class ChatAttachmentService {
  ChatAttachmentService({FirebaseStorage? storage}) : _storage = storage;

  final FirebaseStorage? _storage;
  FirebaseStorage get _client => _storage ?? FirebaseStorage.instance;

  static String pathFor(String conversationId, String messageId) =>
      'messageAttachments/$conversationId/$messageId';

  /// Stable-path, create-only upload. A retry whose first response was lost
  /// reuses the existing object instead of replacing it or making another.
  Future<ChatAttachment> upload({
    required String conversationId,
    required String messageId,
    required ChatImage image,
  }) async {
    if (image.bytes.isEmpty || image.bytes.length > kChatImageMaxBytes || !kChatImageTypes.contains(image.type)) {
      throw StateError('Choose a JPEG, PNG, or WebP image no larger than 5 MB.');
    }
    final path = pathFor(conversationId, messageId);
    final reference = _client.ref(path);
    try {
      final metadata = await reference.getMetadata();
      if (metadata.size != image.bytes.length || metadata.contentType != image.type) {
        throw StateError('This upload id is already in use. Remove the image and select it again.');
      }
    } on FirebaseException catch (error) {
      if (error.code != 'object-not-found') rethrow;
      await reference.putData(
        image.bytes,
        SettableMetadata(contentType: image.type, cacheControl: 'private, no-store'),
      );
    }
    return ChatAttachment(path: path, contentType: image.type, size: image.bytes.length);
  }

  /// Authenticated byte read. No getDownloadURL and no public object token.
  Future<Uint8List> read(ChatAttachment attachment) async {
    final bytes = await _client.ref(attachment.path).getData(kChatImageMaxBytes);
    if (bytes == null) throw StateError('This private image is unavailable.');
    return bytes;
  }
}

String chatAttachmentFailure(Object error) {
  if (error is FirebaseException &&
      <String>{'unauthenticated', 'unauthorized', 'permission-denied'}.contains(error.code)) {
    return 'Your session or conversation access has expired. Sign in again before retrying this private image.';
  }
  if (error is StateError) return error.message;
  return 'The image could not be sent. Check the connection and retry; the image and caption are still here.';
}
