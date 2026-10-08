import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/dispute_model.dart';

class DisputeService {
  final FirebaseFirestore _firestore;

  DisputeService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  Stream<List<DisputeModel>> streamAllDisputes() {
    return _firestore
        .collection('disputes')
        .snapshots()
        .map((snap) => snap.docs.map((doc) => DisputeModel.fromMap(doc.id, doc.data())).toList());
  }

  Future<void> updateDisputeStatus({
    required String disputeId,
    required String newStatus,
    required String adminUid,
    String? adminResponse,
    String? internalNotes,
  }) async {
    final docRef = _firestore.collection('disputes').doc(disputeId);
    final now = DateTime.now().toUtc();

    final patch = <String, dynamic>{
      'status': newStatus,
      'updated_at': now.toIso8601String(),
      if (adminResponse != null) 'admin_response': adminResponse,
      if (internalNotes != null) 'internal_notes': internalNotes,
      if (newStatus == 'resolved' || newStatus == 'rejected') ...{
        'resolved_at': now.toIso8601String(),
        'resolved_by': adminUid,
      },
    };

    await docRef.update(patch);
  }
}
