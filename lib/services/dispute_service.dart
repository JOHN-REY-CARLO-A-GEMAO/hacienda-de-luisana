import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:crypto/crypto.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/dispute_model.dart';

class CaseFile {
  final String name;
  final String type;
  final Uint8List bytes;
  CaseFile(this.name, this.type, this.bytes);
}

/// Native Android SAF: no broad storage permission or permanent local copy.
class CaseFiles {
  static const _channel = MethodChannel('hacienda/case-files');
  static Future<CaseFile?> pick() async {
    final result = await _channel.invokeMapMethod<String, dynamic>('pick');
    if (result == null) return null;
    return CaseFile(result['name'] as String, result['type'] as String,
        base64Decode(result['base64'] as String));
  }
  static Future<void> save(String name, String type, String base64) async {
    await _channel.invokeMethod('save', {'name': name, 'type': type, 'base64': base64});
  }
}

class DisputeService {
  final FirebaseFirestore _firestore;
  DisputeService({FirebaseFirestore? firestore}) : _firestore = firestore ?? FirebaseFirestore.instance;
  static const categories = ['booking', 'payment', 'charges_refunds', 'availability', 'access', 'cleanliness_amenities', 'damage_safety', 'conduct_rules', 'communication', 'technical', 'other'];
  static const statuses = ['submitted', 'under_review', 'awaiting_guest', 'awaiting_staff', 'escalated', 'resolution_proposed', 'resolved', 'closed', 'reopened'];
  String _operationId() => List.generate(24, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  Future<Map<String, dynamic>> _call(String function, Map<String, dynamic> payload) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) throw StateError('A recoverable Admin account is required.');
    final token = await user.getIdToken();
    const emulatorOrigin = String.fromEnvironment('DISPUTE_FUNCTIONS_ORIGIN');
    final origin = kDebugMode && emulatorOrigin.isNotEmpty
        ? emulatorOrigin
        : 'https://asia-southeast1-${Firebase.app().options.projectId}.cloudfunctions.net';
    final response = await http.post(Uri.parse('$origin/$function'), headers: {
      'Authorization': 'Bearer $token', 'Content-Type': 'application/json',
    }, body: jsonEncode({'data': payload})).timeout(const Duration(seconds: 125));
    final envelope = jsonDecode(response.body) as Map<String, dynamic>;
    if (envelope['error'] != null) {
      final error = envelope['error'] as Map<String, dynamic>;
      throw StateError('${error['status']}: ${error['message']}');
    }
    if (response.statusCode != 200) throw StateError('Action not confirmed. Retry unchanged information.');
    return Map<String, dynamic>.from(envelope['result'] as Map);
  }
  Future<Map<String, dynamic>> command(Map<String, dynamic> command) async {
    final fingerprint = sha256.convert(utf8.encode(jsonEncode([FirebaseAuth.instance.currentUser?.uid, command]))).toString();
    final preferences = await SharedPreferences.getInstance();
    final key = 'case_operation_$fingerprint';
    final operation = preferences.getString(key) ?? _operationId();
    await preferences.setString(key, operation); // Opaque ID only: no drafts, tokens or case contents.
    return _call('disputeCommand', {...command, 'operationId': operation});
  }
  Stream<List<DisputeModel>> streamAllDisputes() => _firestore.collection('cases')
      .orderBy('updated_at', descending: true).limit(100).snapshots()
      .map((snap) => snap.docs.map((d) => DisputeModel.fromMap(d.id, d.data())).toList());
  Stream<DisputeModel> streamCase(String id) => _firestore.doc('cases/$id').snapshots()
      .map((doc) { if (!doc.exists) throw StateError('Case not found or removed under retention policy.'); return DisputeModel.fromMap(doc.id, doc.data()!); });
  Future<List<DisputeModel>> olderCases(String id) async {
    final cursor = await _firestore.doc('cases/$id').get();
    final snap = await _firestore.collection('cases').orderBy('updated_at', descending: true).startAfterDocument(cursor).limit(100).get();
    return snap.docs.map((d) => DisputeModel.fromMap(d.id, d.data())).toList();
  }
  Stream<QuerySnapshot<Map<String, dynamic>>> activity(String id) => _firestore.collection('cases/$id/activity').orderBy('created_at', descending: true).limit(40).snapshots();
  Future<QuerySnapshot<Map<String, dynamic>>> olderActivity(String id, DocumentSnapshot cursor) => _firestore.collection('cases/$id/activity').orderBy('created_at', descending: true).startAfterDocument(cursor).limit(40).get();
  Stream<QuerySnapshot<Map<String, dynamic>>> notes(String id) => _firestore.collection('casePrivate/$id/notes').orderBy('created_at', descending: true).limit(40).snapshots();
  Stream<DocumentSnapshot<Map<String, dynamic>>> privateRecord(String id) => _firestore.doc('casePrivate/$id').snapshots();
  Stream<QuerySnapshot<Map<String, dynamic>>> evidence(String id) => _firestore.collection('cases/$id/evidence').limit(50).snapshots();
  Future<List<Map<String, dynamic>>> inbox([String? cursor]) async => List<Map<String, dynamic>>.from((await _call('disputeInbox', {'action': 'list', if (cursor != null) 'cursor': cursor}))['items'] as List);
  Future<void> readNotification(String id) async { await _call('disputeInbox', {'action': 'read', 'notificationId': id}); }
  Future<List<Map<String, dynamic>>> directory() async => List<Map<String, dynamic>>.from((await _call('disputeDirectory', {}))['admins'] as List);
  Future<void> downloadEvidence(String id) async {
    final result = await _call('disputeEvidence', {'action': 'download', 'uploadId': id});
    await CaseFiles.save(result['name'] as String, result['type'] as String, result['base64'] as String);
  }
  Future<String> uploadEvidence(DisputeModel c, CaseFile file, void Function(String) progress) async {
    if (file.bytes.isEmpty || file.bytes.length > 10 * 1024 * 1024) throw StateError('Evidence must be 1 byte to 10 MB.');
    final started = await _call('disputeEvidence', {'action': 'begin', 'operationId': _operationId(), 'caseId': c.id, 'expectedVersion': c.version, 'name': file.name, 'type': file.type, 'size': file.bytes.length});
    final uploadId = started['uploadId'] as String; final chunk = (started['chunkSize'] as num).toInt();
    for (int start = 0, index = 0; start < file.bytes.length; start += chunk, index++) {
      final end = min(start + chunk, file.bytes.length);
      final payload = {'action': 'chunk', 'uploadId': uploadId, 'index': index, 'base64': base64Encode(file.bytes.sublist(start, end))};
      try { await _call('disputeEvidence', payload); } catch (_) { await _call('disputeEvidence', payload); }
      progress('Uploading ${file.name}: ${(100 * end / file.bytes.length).round()}%');
    }
    progress('Validating ${file.name}…');
    await _call('disputeEvidence', {'action': 'finalize', 'uploadId': uploadId});
    return uploadId;
  }
}
