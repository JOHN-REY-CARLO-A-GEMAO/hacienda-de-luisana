enum LockAction {
  unlock,
  lock,
  autoRelock,
  denied,
  masterOverride,
}

extension LockActionX on LockAction {
  String get name {
    switch (this) {
      case LockAction.unlock:
        return 'unlock';
      case LockAction.lock:
        return 'lock';
      case LockAction.autoRelock:
        return 'auto_relock';
      case LockAction.denied:
        return 'denied';
      case LockAction.masterOverride:
        return 'master_override';
    }
  }

  String get displayName {
    switch (this) {
      case LockAction.unlock:
        return 'UNLOCK';
      case LockAction.lock:
        return 'LOCK';
      case LockAction.autoRelock:
        return 'AUTO-RELOCK';
      case LockAction.denied:
        return 'ACCESS DENIED';
      case LockAction.masterOverride:
        return 'MASTER KEY';
    }
  }

  static LockAction fromString(String val) {
    switch (val.toLowerCase()) {
      case 'unlock':
        return LockAction.unlock;
      case 'lock':
        return LockAction.lock;
      case 'auto_relock':
      case 'autorelock':
        return LockAction.autoRelock;
      case 'denied':
        return LockAction.denied;
      case 'master_override':
      case 'masteroverride':
      case 'master':
        return LockAction.masterOverride;
      default:
        return LockAction.unlock;
    }
  }
}

enum LockMethod {
  rfidKeycard,
  mobileBle,
  keypadPin,
  autoTimer,
  physicalKey,
}

extension LockMethodX on LockMethod {
  String get displayName {
    switch (this) {
      case LockMethod.rfidKeycard:
        return 'RFID Keycard';
      case LockMethod.mobileBle:
        return 'Mobile BLE Key';
      case LockMethod.keypadPin:
        return 'Keypad PIN';
      case LockMethod.autoTimer:
        return 'Auto-Relock Timer';
      case LockMethod.physicalKey:
        return 'Master Physical Key';
    }
  }

  static LockMethod fromString(String val) {
    switch (val.toLowerCase()) {
      case 'rfid_keycard':
      case 'rfid_card':
      case 'rfid':
        return LockMethod.rfidKeycard;
      case 'mobile_ble':
      case 'mobile_key':
      case 'ble':
        return LockMethod.mobileBle;
      case 'keypad_pin':
      case 'pin':
        return LockMethod.keypadPin;
      case 'auto_timer':
      case 'timer':
        return LockMethod.autoTimer;
      case 'physical_key':
      case 'master_key':
      default:
        return LockMethod.physicalKey;
    }
  }
}

class SmartLockEventModel {
  final String id;
  final String doorName;
  final LockAction action;
  final LockMethod method;
  final String triggeredBy;
  final String? cardUid;
  final DateTime timestamp;
  final bool isSuccess;
  final String? notes;

  /// The uid the rules require on every `access_logs` create
  /// (`request.resource.data.uid == request.auth.uid`). The simulator rows
  /// and a real Mobile Key write both carry it.
  final String? uid;

  /// The Booking reference the touch was about, when there was one.
  final String? refId;

  /// True for the simulator's demonstration rows. They are tagged so the
  /// audit trail says what they are instead of passing as real RFID
  /// history (ADR-0015's bundled fixes); `firestore.rules` allows the extra
  /// key because `access_logs` create checks `hasAll`, not `hasOnly`.
  final bool simulated;

  SmartLockEventModel({
    required this.id,
    required this.doorName,
    required this.action,
    required this.method,
    required this.triggeredBy,
    this.cardUid,
    required this.timestamp,
    required this.isSuccess,
    this.notes,
    this.uid,
    this.refId,
    this.simulated = false,
  });

  factory SmartLockEventModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    final actStr = (json['action'] ?? (json['result'] == 'granted' ? 'unlock' : 'denied')).toString();
    final action = LockActionX.fromString(actStr);

    return SmartLockEventModel(
      id: docId ?? json['id'] ?? 'log-${DateTime.now().millisecondsSinceEpoch}',
      // An event with no door recorded says so. Defaulting to a named door invented
      // one the lock never opened, and the Access log is the record of which
      // doors a Credential actually opened.
      doorName: _doorName(json),
      action: action,
      method: LockMethodX.fromString((json['method'] ?? 'mobile_ble').toString()),
      triggeredBy: json['triggeredBy'] ?? json['guest_name'] ?? 'Guest',
      cardUid: json['cardUid'] ?? json['rfid_uid'],
      timestamp: json['timestamp'] != null
          ? (json['timestamp'] is String
              ? DateTime.parse(json['timestamp'])
              : (json['timestamp'] as dynamic).toDate())
          : DateTime.now(),
      isSuccess: (json['isSuccess'] ?? json['success'] ?? (action != LockAction.denied)) as bool,
      notes: json['notes'] ?? json['reason'],
      uid: json['uid'],
      refId: json['ref_id'] ?? json['refId'],
      simulated: json['simulated'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'doorName': doorName,
      'action': action.name,
      'method': method.name,
      'triggeredBy': triggeredBy,
      'cardUid': cardUid,
      'timestamp': timestamp.toIso8601String(),
      'isSuccess': isSuccess,
      'notes': notes,
      // The keys `firestore.rules` holds every access_logs create to.
      'uid': uid,
      'ref_id': refId,
      'result': isSuccess ? 'granted' : 'denied',
      // Written as-is; absent (not false) when this is a real row, so the
      // historical shape stays the historical shape.
      if (simulated) 'simulated': true,
    };
  }

  /// The door this event names, or an explicit "not recorded".
  ///
  /// A door is an operational fact, not something to infer. This used to fall
  /// back to a named door that no lock in the system opens.
  static String _doorName(Map<String, dynamic> json) {
    final raw = json['doorName'] ?? json['door_name'];
    if (raw is! String) return 'Unrecorded door';
    final trimmed = raw.trim();
    return trimmed.isEmpty ? 'Unrecorded door' : trimmed;
  }
}
