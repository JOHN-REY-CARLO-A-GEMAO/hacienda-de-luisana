import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

/// P3 real KYC uploads — ID + receipt images to /kyc/{uid}/{refId}/.
///
/// Rules (storage.rules): write own-uid only, 5MB, image/*; read own +
/// owner allowlist. Client pre-validates size/type so failures surface
/// before bytes leave the phone. Offline or unconfigured Firebase throws
/// [KycUploadException] and the caller keeps local placeholders.
class KycUploadException implements Exception {
  final String message;
  const KycUploadException(this.message);
  @override
  String toString() => message;
}

class KycStorage {
  static const maxBytes = 5 * 1024 * 1024;

  final FirebaseStorage _storage;
  KycStorage({FirebaseStorage? storage})
      : _storage = storage ?? FirebaseStorage.instance;

  static String objectPath({
    required String uid,
    required String bookingRefId,
    required String kind, // 'id' | 'receipt'
    required String filename,
  }) {
    final ext = _extOf(filename);
    final safeRef =
        bookingRefId.replaceAll(RegExp(r'[^A-Za-z0-9\-]'), '').toUpperCase();
    return 'kyc/$uid/$safeRef/$kind.$ext';
  }

  static String _extOf(String filename) {
    final dot = filename.lastIndexOf('.');
    final raw = dot >= 0 ? filename.substring(dot + 1).toLowerCase() : 'jpg';
    return ['jpg', 'jpeg', 'png', 'webp', 'heic'].contains(raw) ? raw : 'jpg';
  }

  static String _contentTypeFor(String filename) {
    final ext = _extOf(filename);
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'heic':
        return 'image/heic';
      default:
        return 'image/jpeg';
    }
  }

  /// Uploads one KYC file and returns its download URL.
  Future<String> uploadKycFile({
    required String uid,
    required String bookingRefId,
    required String kind,
    required XFile file,
  }) async {
    if (uid.isEmpty || uid.startsWith('local-')) {
      throw const KycUploadException(
          'Cloud sign-in not ready — connect online and retry.');
    }
    late final Uint8List bytes;
    try {
      bytes = await file.readAsBytes();
    } catch (e) {
      throw KycUploadException('Could not read ${file.name}: $e');
    }
    if (bytes.isEmpty) {
      throw const KycUploadException('That file looks empty — pick another.');
    }
    if (bytes.length > maxBytes) {
      throw const KycUploadException(
          'Image must be under 5MB — pick a smaller photo.');
    }
    final path = objectPath(
        uid: uid, bookingRefId: bookingRefId, kind: kind, filename: file.name);
    try {
      final ref = _storage.ref(path);
      await ref.putData(
        bytes,
        SettableMetadata(contentType: _contentTypeFor(file.name)),
      );
      return await ref.getDownloadURL();
    } catch (e) {
      throw KycUploadException('Upload failed ($kind): $e');
    }
  }
}
