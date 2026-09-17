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
  });

  factory SmartLockEventModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    final actStr = (json['action'] ?? (json['result'] == 'granted' ? 'unlock' : 'denied')).toString();
    final action = LockActionX.fromString(actStr);

    return SmartLockEventModel(
      id: docId ?? json['id'] ?? 'log-${DateTime.now().millisecondsSinceEpoch}',
      doorName: json['doorName'] ?? json['door_name'] ?? 'Villa LuisAna Front Door',
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
    };
  }
}
