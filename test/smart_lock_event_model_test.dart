import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/smart_lock_event_model.dart';

SmartLockEventModel event({
  LockAction action = LockAction.unlock,
  String? notes,
  String? reason,
}) =>
    SmartLockEventModel(
      id: 'event-1',
      doorName: 'Simulated door',
      action: action,
      method: LockMethod.rfidKeycard,
      triggeredBy: 'Admin',
      timestamp: DateTime.utc(2026, 10, 30),
      isSuccess: action != LockAction.denied,
      notes: notes,
      reason: reason,
      uid: 'admin-uid',
      refId: 'simulated',
      simulated: true,
    );

void main() {
  group('SmartLockEventModel access-log serialization', () {
    test('writes the explicit reason while retaining display notes', () {
      final json = event(
        notes: 'Simulator demonstration; not a real credential use',
        reason: 'Simulated unlock by Admin',
      ).toJson();

      expect(json['reason'], 'Simulated unlock by Admin');
      expect(json['notes'], 'Simulator demonstration; not a real credential use');
      expect(json['timestamp'], isA<String>());
      expect(json['uid'], 'admin-uid');
      expect(json['ref_id'], 'simulated');
      expect(json['result'], 'granted');
      expect(json['simulated'], isTrue);
    });

    test('falls back to notes or a non-empty generic reason', () {
      expect(event(notes: 'Legacy note').toJson()['reason'], 'Legacy note');
      expect(event().toJson()['reason'], isNotEmpty);
      expect(
        event(action: LockAction.denied).toJson()['reason'],
        'Access denied',
      );
    });

    test('reads a rules-contract reason and keeps it available for display', () {
      final parsed = SmartLockEventModel.fromJson({
        'timestamp': '2026-10-30T00:00:00.000Z',
        'uid': 'admin-uid',
        'ref_id': 'simulated',
        'result': 'granted',
        'reason': 'Simulated unlock by Admin',
      });

      expect(parsed.reason, 'Simulated unlock by Admin');
      expect(parsed.notes, 'Simulated unlock by Admin');
      expect(parsed.toJson()['reason'], 'Simulated unlock by Admin');
    });
  });
}
