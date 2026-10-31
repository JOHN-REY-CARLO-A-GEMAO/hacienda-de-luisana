import 'dart:collection';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

/// Versioned delivery contract between the trusted Firebase Functions sender
/// (`functions/src/notifications.ts`) and the Flutter Admin app.
const String kNotificationContractVersion = '1';

/// Monochrome Android status-bar resource (`android/app/src/main/res/drawable/ic_stat_notification.xml`).
const String kAndroidNotificationSmallIcon = '@drawable/ic_stat_notification';

/// Durable Android notification channel contract.
///
/// Channel IDs are user-visible OS contracts once created on Android 8+ and
/// must never be randomized or rotated to override user settings.
class AdminChannelSpec {
  final String id;
  final String name;
  final String description;
  final bool criticalSecurity;

  const AdminChannelSpec({
    required this.id,
    required this.name,
    required this.description,
    this.criticalSecurity = false,
  });
}

class AdminNotificationChannels {
  AdminNotificationChannels._();

  static const String bookings = 'hdl_admin_bookings';
  static const String payments = 'hdl_admin_payments';
  static const String messages = 'hdl_admin_messages';
  static const String security = 'hdl_admin_security';

  static const List<AdminChannelSpec> all = [
    AdminChannelSpec(
      id: bookings,
      name: 'Booking Requests & Updates',
      description:
          'New booking submissions, guest cancellations, reschedule requests, and stay lifecycle changes.',
    ),
    AdminChannelSpec(
      id: payments,
      name: 'Payment Verification & Refunds',
      description:
          'Uploaded payment proofs awaiting Admin verification and pending refund settlements.',
    ),
    AdminChannelSpec(
      id: messages,
      name: 'Guest Messages',
      description: 'New messages and image attachments from Guests in booking conversations.',
    ),
    AdminChannelSpec(
      id: security,
      name: 'Smart Lock Security Alerts',
      description:
          'Denied door access attempts and physical override security events.',
      criticalSecurity: true,
    ),
  ];

  static bool isKnown(String? channelId) =>
      channelId != null && all.any((c) => c.id == channelId);

  static AdminChannelSpec specFor(String channelId) {
    for (final spec in all) {
      if (spec.id == channelId) return spec;
    }
    return all.first;
  }
}

/// Allowlisted notification event types supported by the Admin app.
enum AdminPushEventType {
  bookingSubmitted('booking_submitted', AdminNotificationChannels.bookings),
  paymentProofSubmitted('payment_proof_submitted', AdminNotificationChannels.payments),
  guestMessage('guest_message', AdminNotificationChannels.messages),
  guestCancellation('guest_cancellation', AdminNotificationChannels.bookings),
  rescheduleRequest('reschedule_request', AdminNotificationChannels.bookings),
  bookingStatusChanged('booking_status_changed', AdminNotificationChannels.bookings),
  smartLockSecurity('smart_lock_security', AdminNotificationChannels.security);

  final String wireValue;
  final String defaultChannelId;

  const AdminPushEventType(this.wireValue, this.defaultChannelId);

  static AdminPushEventType? fromWire(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    for (final value in AdminPushEventType.values) {
      if (value.wireValue == raw) return value;
    }
    return null;
  }
}

/// Validated, typed destination handed to the navigation owner ONLY after
/// authentication, Admin role verification, and PIN gate unlock succeed.
sealed class AdminNotificationDestination {
  const AdminNotificationDestination();
}

final class BookingDetailDestination extends AdminNotificationDestination {
  final String bookingId;
  const BookingDetailDestination(this.bookingId);

  @override
  bool operator ==(Object other) =>
      other is BookingDetailDestination && other.bookingId == bookingId;

  @override
  int get hashCode => Object.hash('booking_detail', bookingId);
}

final class PaymentVerificationQueueDestination
    extends AdminNotificationDestination {
  final String? bookingId;
  const PaymentVerificationQueueDestination({this.bookingId});

  @override
  bool operator ==(Object other) =>
      other is PaymentVerificationQueueDestination &&
      other.bookingId == bookingId;

  @override
  int get hashCode => Object.hash('payment_queue', bookingId);
}

final class RefundManagementDestination extends AdminNotificationDestination {
  final String? bookingId;
  const RefundManagementDestination({this.bookingId});

  @override
  bool operator ==(Object other) =>
      other is RefundManagementDestination && other.bookingId == bookingId;

  @override
  int get hashCode => Object.hash('refund_queue', bookingId);
}

final class ChatThreadDestination extends AdminNotificationDestination {
  final String conversationId;
  final String? bookingId;
  final String? guestUid;

  const ChatThreadDestination({
    required this.conversationId,
    this.bookingId,
    this.guestUid,
  });

  @override
  bool operator ==(Object other) =>
      other is ChatThreadDestination &&
      other.conversationId == conversationId &&
      other.bookingId == bookingId &&
      other.guestUid == guestUid;

  @override
  int get hashCode =>
      Object.hash('chat_thread', conversationId, bookingId, guestUid);
}

final class SmartLockDestination extends AdminNotificationDestination {
  const SmartLockDestination();

  @override
  bool operator ==(Object other) => other is SmartLockDestination;

  @override
  int get hashCode => 'smart_lock'.hashCode;
}

final class NotificationsCenterDestination
    extends AdminNotificationDestination {
  const NotificationsCenterDestination();

  @override
  bool operator ==(Object other) => other is NotificationsCenterDestination;

  @override
  int get hashCode => 'notifications'.hashCode;
}

/// Validated, immutable representation of an incoming push or local tap payload.
class ValidatedNotificationPayload {
  static final RegExp _safeDocId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
  static final RegExp _safeConvoId = RegExp(r'^[A-Za-z0-9_:-]{1,160}$');
  static final RegExp _safeEventId = RegExp(r'^[\x21-\x7E]{3,200}$');
  static const Set<String> _canonicalAccommodations = {
    'main-house',
    'annex',
    'house-a-camping',
  };

  /// Maximum age accepted for a notification tap payload before treating it as stale.
  static const Duration maxPayloadAge = Duration(days: 30);

  final String eventId;
  final AdminPushEventType type;
  final String channelId;
  final AdminNotificationDestination destination;
  final String title;
  final String body;
  final DateTime? sentAt;
  final String? accommodation;

  const ValidatedNotificationPayload({
    required this.eventId,
    required this.type,
    required this.channelId,
    required this.destination,
    required this.title,
    required this.body,
    this.sentAt,
    this.accommodation,
  });

  /// Deterministic non-colliding positive 31-bit notification ID for Android/iOS.
  int get notificationId => deterministicNotificationId(notificationScopeKey);

  /// Grouping key so unrelated bookings/threads never overwrite each other,
  /// while repeated delivery of the exact same event maps deterministically.
  String get notificationScopeKey {
    final dest = destination;
    return switch (dest) {
      BookingDetailDestination(:final bookingId) =>
        '${type.wireValue}:booking:$bookingId:$eventId',
      PaymentVerificationQueueDestination(:final bookingId) =>
        '${type.wireValue}:payment:${bookingId ?? eventId}',
      RefundManagementDestination(:final bookingId) =>
        '${type.wireValue}:refund:${bookingId ?? eventId}',
      ChatThreadDestination(:final conversationId) =>
        '${type.wireValue}:chat:$conversationId:$eventId',
      SmartLockDestination() => '${type.wireValue}:lock:$eventId',
      NotificationsCenterDestination() => '${type.wireValue}:center:$eventId',
    };
  }

  String toWireTarget() {
    final dest = destination;
    return switch (dest) {
      BookingDetailDestination() => 'booking_detail',
      PaymentVerificationQueueDestination() => 'payment_queue',
      RefundManagementDestination() => 'refund_queue',
      ChatThreadDestination() => 'chat_thread',
      SmartLockDestination() => 'smart_lock',
      NotificationsCenterDestination() => 'notifications',
    };
  }

  Map<String, String> toDataMap() {
    final dest = destination;
    final map = <String, String>{
      'v': kNotificationContractVersion,
      'event_id': eventId,
      'type': type.wireValue,
      'channel_id': channelId,
      'target': toWireTarget(),
      'title': title,
      'body': body,
      if (sentAt != null) 'sent_at': sentAt!.toUtc().toIso8601String(),
      if (accommodation != null) 'accommodation': accommodation!,
    };
    if (dest is BookingDetailDestination) {
      map['booking_id'] = dest.bookingId;
    } else if (dest is PaymentVerificationQueueDestination &&
        dest.bookingId != null) {
      map['booking_id'] = dest.bookingId!;
    } else if (dest is RefundManagementDestination && dest.bookingId != null) {
      map['booking_id'] = dest.bookingId!;
    } else if (dest is ChatThreadDestination) {
      map['conversation_id'] = dest.conversationId;
      if (dest.bookingId != null) map['booking_id'] = dest.bookingId!;
      if (dest.guestUid != null) map['guest_uid'] = dest.guestUid!;
    }
    return map;
  }

  String toJsonString() => jsonEncode(toDataMap());

  static PayloadValidationResult parseJsonString(
    String? rawJson, {
    DateTime? now,
  }) {
    if (rawJson == null || rawJson.trim().isEmpty || rawJson.length > 8192) {
      return const PayloadValidationResult.rejected('empty_or_oversized_payload');
    }
    try {
      final decoded = jsonDecode(rawJson);
      if (decoded is! Map) {
        return const PayloadValidationResult.rejected('payload_not_an_object');
      }
      return parseMap(
        Map<String, dynamic>.from(decoded),
        now: now,
      );
    } catch (_) {
      return const PayloadValidationResult.rejected('malformed_json_payload');
    }
  }

  /// Validates an untrusted external payload map (`RemoteMessage.data` or decoded local payload).
  static PayloadValidationResult parseMap(
    Map<String, dynamic>? raw, {
    String? fallbackTitle,
    String? fallbackBody,
    DateTime? now,
  }) {
    if (raw == null || raw.isEmpty) {
      return const PayloadValidationResult.rejected('missing_payload');
    }

    final version = _cleanString(raw['v']);
    if (version != kNotificationContractVersion) {
      return const PayloadValidationResult.rejected('unsupported_contract_version');
    }

    final eventId = _cleanString(raw['event_id']);
    if (eventId.isEmpty ||
        !_safeEventId.hasMatch(eventId) ||
        eventId.contains('..')) {
      return const PayloadValidationResult.rejected('invalid_event_id');
    }

    final eventType = AdminPushEventType.fromWire(_cleanString(raw['type']));
    if (eventType == null) {
      return const PayloadValidationResult.rejected('unknown_event_type');
    }

    DateTime? sentAt;
    final sentAtRaw = _cleanString(raw['sent_at']);
    if (sentAtRaw.isNotEmpty) {
      final parsed = DateTime.tryParse(sentAtRaw);
      if (parsed == null) {
        return const PayloadValidationResult.rejected('malformed_timestamp');
      }
      sentAt = parsed.toUtc();
      final referenceNow = (now ?? DateTime.now()).toUtc();
      if (referenceNow.difference(sentAt) > maxPayloadAge) {
        return const PayloadValidationResult.rejected('expired_payload');
      }
    }

    final rawChannel = _cleanString(raw['channel_id']);
    final channelId = AdminNotificationChannels.isKnown(rawChannel)
        ? rawChannel
        : eventType.defaultChannelId;

    final target = _cleanString(raw['target']);
    final bookingId = _cleanString(raw['booking_id']);
    final conversationId = _cleanString(raw['conversation_id']);
    final guestUid = _cleanString(raw['guest_uid']);

    if (bookingId.isNotEmpty && !_isValidDocId(bookingId)) {
      return const PayloadValidationResult.rejected('invalid_booking_id');
    }
    if (guestUid.isNotEmpty && !_isValidDocId(guestUid)) {
      return const PayloadValidationResult.rejected('invalid_guest_uid');
    }
    if (conversationId.isNotEmpty && !_isValidConvoId(conversationId)) {
      return const PayloadValidationResult.rejected('invalid_conversation_id');
    }

    final AdminNotificationDestination destination;
    switch (target) {
      case 'booking_detail':
        if (bookingId.isEmpty) {
          return const PayloadValidationResult.rejected('missing_booking_id');
        }
        destination = BookingDetailDestination(bookingId);
        break;
      case 'payment_queue':
        destination = PaymentVerificationQueueDestination(
          bookingId: bookingId.isEmpty ? null : bookingId,
        );
        break;
      case 'refund_queue':
        destination = RefundManagementDestination(
          bookingId: bookingId.isEmpty ? null : bookingId,
        );
        break;
      case 'chat_thread':
        if (conversationId.isEmpty) {
          return const PayloadValidationResult.rejected('missing_conversation_id');
        }
        destination = ChatThreadDestination(
          conversationId: conversationId,
          bookingId: bookingId.isEmpty ? null : bookingId,
          guestUid: guestUid.isEmpty ? null : guestUid,
        );
        break;
      case 'smart_lock':
        destination = const SmartLockDestination();
        break;
      case 'notifications':
        destination = const NotificationsCenterDestination();
        break;
      default:
        return const PayloadValidationResult.rejected('unknown_target_destination');
    }

    final rawAccommodation = _cleanString(raw['accommodation']);
    final accommodation = _canonicalAccommodations.contains(rawAccommodation)
        ? rawAccommodation
        : null;

    final title = _boundedCopy(
      _cleanString(raw['title']).isNotEmpty
          ? _cleanString(raw['title'])
          : (fallbackTitle ?? '').trim(),
      fallback: _defaultTitleFor(eventType),
      maxLength: 100,
    );
    final body = _boundedCopy(
      _cleanString(raw['body']).isNotEmpty
          ? _cleanString(raw['body'])
          : (fallbackBody ?? '').trim(),
      fallback: _defaultBodyFor(eventType),
      maxLength: 240,
    );

    return PayloadValidationResult.accepted(
      ValidatedNotificationPayload(
        eventId: eventId,
        type: eventType,
        channelId: channelId,
        destination: destination,
        title: title,
        body: body,
        sentAt: sentAt,
        accommodation: accommodation,
      ),
    );
  }

  static bool _isValidDocId(String value) =>
      _safeDocId.hasMatch(value) && !value.contains('..');

  static bool _isValidConvoId(String value) =>
      _safeConvoId.hasMatch(value) &&
      !value.contains('..') &&
      !value.startsWith(':') &&
      !value.endsWith(':');

  static String _cleanString(Object? value) =>
      value is String ? value.trim() : '';

  static String _boundedCopy(
    String candidate, {
    required String fallback,
    required int maxLength,
  }) {
    final chosen = candidate.isEmpty ? fallback : candidate;
    if (chosen.length <= maxLength) return chosen;
    return '${chosen.substring(0, maxLength - 1)}…';
  }

  static String _defaultTitleFor(AdminPushEventType type) {
    return switch (type) {
      AdminPushEventType.bookingSubmitted => 'New booking submitted',
      AdminPushEventType.paymentProofSubmitted => 'New payment proof submitted',
      AdminPushEventType.guestMessage => 'New guest message',
      AdminPushEventType.guestCancellation => 'Guest cancellation update',
      AdminPushEventType.rescheduleRequest => 'Stay modification request',
      AdminPushEventType.bookingStatusChanged => 'Booking status updated',
      AdminPushEventType.smartLockSecurity => 'Smart lock security alert',
    };
  }

  static String _defaultBodyFor(AdminPushEventType type) {
    return switch (type) {
      AdminPushEventType.bookingSubmitted =>
        'A new booking request is waiting for Admin review.',
      AdminPushEventType.paymentProofSubmitted =>
        'A payment proof was uploaded and is waiting for verification.',
      AdminPushEventType.guestMessage =>
        'A Guest sent a message in booking chat.',
      AdminPushEventType.guestCancellation =>
        'A Guest cancelled or requested cancellation on a booking.',
      AdminPushEventType.rescheduleRequest =>
        'A stay modification request is waiting for Admin review.',
      AdminPushEventType.bookingStatusChanged =>
        'A booking status changed. Open Hacienda Admin for details.',
      AdminPushEventType.smartLockSecurity =>
        'An unauthorized or override door event was recorded.',
    };
  }
}

class PayloadValidationResult {
  final ValidatedNotificationPayload? payload;
  final String? rejectionReason;

  const PayloadValidationResult.accepted(ValidatedNotificationPayload this.payload)
      : rejectionReason = null;

  const PayloadValidationResult.rejected(String this.rejectionReason)
      : payload = null;

  bool get isValid => payload != null;
}

/// Deterministic positive 31-bit integer ID (`1 .. 0x7fffffff`) derived from
/// SHA-256 of [scopeKey], ensuring distinct bookings/threads do not overwrite
/// one another in the Android/iOS notification shade.
int deterministicNotificationId(String scopeKey) {
  final digest = sha256.convert(utf8.encode(scopeKey)).bytes;
  final raw = ((digest[0] & 0x7F) << 24) |
      (digest[1] << 16) |
      (digest[2] << 8) |
      digest[3];
  return raw == 0 ? 1 : raw;
}

/// Deterministic `${uid}:${sha256_32}` document ID matching
/// `adminDeviceTokenDocId(uid, token)` in `functions/src/notifications.ts` and
/// `ownsAdminDeviceTokenId()` in `firestore.rules`.
String adminDeviceTokenDocId(String uid, String token) {
  final cleanUid = uid.trim();
  final digest = sha256
      .convert(utf8.encode('$cleanUid:${token.trim()}'))
      .toString()
      .substring(0, 32);
  return '$cleanUid:$digest';
}

/// Redacts a raw FCM token to a non-reversible 10-hex fingerprint for logs.
String redactFcmToken(String token) {
  final hash = sha256.convert(utf8.encode(token)).toString().substring(0, 10);
  return 'fcm:$hash';
}

/// Bounded ordered-set deduplicator for notification `event_id`s.
class NotificationDeduplicator {
  final int maxEntries;
  final LinkedHashSet<String> _seen = LinkedHashSet<String>();
  final void Function(List<String> entries)? _onPersist;

  NotificationDeduplicator({
    this.maxEntries = 256,
    Iterable<String> initialEntries = const [],
    void Function(List<String> entries)? onPersist,
  }) : _onPersist = onPersist {
    for (final id in initialEntries) {
      final trimmed = id.trim();
      if (trimmed.isNotEmpty) _addBounded(trimmed);
    }
  }

  bool contains(String eventId) => _seen.contains(eventId.trim());

  /// Records [eventId] and returns `true` when seen for the first time, or
  /// `false` if already processed.
  bool markIfNew(String eventId) {
    final normalized = eventId.trim();
    if (normalized.isEmpty) return false;
    if (_seen.contains(normalized)) return false;
    _addBounded(normalized);
    _onPersist?.call(_seen.toList(growable: false));
    return true;
  }

  void _addBounded(String normalized) {
    _seen.add(normalized);
    while (_seen.length > maxEntries) {
      _seen.remove(_seen.first);
    }
  }

  List<String> snapshot() => _seen.toList(growable: false);

  void clear() {
    _seen.clear();
    _onPersist?.call(const []);
  }
}

/// Retained notification tap waiting for AuthGate + Admin verification + PinGateScreen.
class PendingNotificationIntent {
  final ValidatedNotificationPayload payload;
  final DateTime capturedAt;
  final String? capturedUid;

  const PendingNotificationIntent({
    required this.payload,
    required this.capturedAt,
    required this.capturedUid,
  });
}

typedef NotificationRouteExecutor = Future<void> Function(
  ValidatedNotificationPayload payload,
);

/// Coordinates notification tap routing strictly behind all three security gates:
///   1. Firebase Authentication is established (`uid` non-empty).
///   2. Authenticated user is verified as an Admin (`isAdmin && !isResolving`).
///   3. `PinGateScreen` has been unlocked for the active foreground session.
///
/// While any gate is closed, a valid destination intent is retained safely in
/// memory and dispatched automatically the moment all three gates open and the
/// shell navigator attaches. Invalid, duplicate, expired, non-admin, or
/// cross-account intents are rejected and discarded without navigating.
class PendingNotificationIntentCoordinator extends ChangeNotifier {
  static const Duration maxPendingHold = Duration(minutes: 30);

  final NotificationDeduplicator _interactionDeduplicator;
  final DateTime Function() _clock;

  PendingNotificationIntent? _pending;
  String? _uid;
  bool _isAdmin = false;
  bool _isResolving = false;
  bool _isPinUnlocked = false;
  bool _dispatching = false;
  NotificationRouteExecutor? _executor;
  String? _lastRejectionReason;

  PendingNotificationIntentCoordinator({
    NotificationDeduplicator? interactionDeduplicator,
    DateTime Function()? clock,
  })  : _interactionDeduplicator =
            interactionDeduplicator ?? NotificationDeduplicator(),
        _clock = clock ?? DateTime.now;

  PendingNotificationIntent? get pendingIntent => _pending;
  bool get hasPendingIntent => _pending != null;
  String? get lastRejectionReason => _lastRejectionReason;

  bool get isReadyToNavigate =>
      _uid != null &&
      _uid!.isNotEmpty &&
      !_isResolving &&
      _isAdmin &&
      _isPinUnlocked &&
      _executor != null;

  void attachExecutor(NotificationRouteExecutor executor) {
    _executor = executor;
    _tryDispatch();
  }

  void detachExecutor(NotificationRouteExecutor executor) {
    if (identical(_executor, executor)) {
      _executor = null;
    }
  }

  /// Updates the AuthGate state. Rejects retained intents on unauthorized
  /// (non-Admin) sign-in or cross-account transitions.
  void updateAuthState({
    required String? uid,
    required bool isAdmin,
    required bool isResolving,
  }) {
    final normalizedUid =
        (uid == null || uid.trim().isEmpty) ? null : uid.trim();
    final previousUid = _uid;

    _uid = normalizedUid;
    _isAdmin = isAdmin;
    _isResolving = isResolving;

    if (normalizedUid == null) {
      _isPinUnlocked = false;
      // If an intent was captured while an Admin session was active and that
      // session signed out, never carry it into a future session.
      if (previousUid != null || (_pending?.capturedUid != null)) {
        _discardPending('signed_out');
      }
      notifyListeners();
      return;
    }

    // Signed-in account resolved as non-Admin: discard immediately.
    if (!isResolving && !isAdmin) {
      _isPinUnlocked = false;
      _discardPending('unauthorized_non_admin');
      notifyListeners();
      return;
    }

    // Account switched between notification tap and unlock: discard immediately.
    if (_pending?.capturedUid != null &&
        _pending!.capturedUid != normalizedUid) {
      _discardPending('account_switched');
      notifyListeners();
      return;
    }

    notifyListeners();
    _tryDispatch();
  }

  /// Updates the `PinGateScreen` lock state (`false` on background/lock,
  /// `true` once the 6-digit Security PIN unlocks the shell).
  void setPinUnlocked(bool unlocked) {
    if (_isPinUnlocked == unlocked) {
      if (unlocked) _tryDispatch();
      return;
    }
    _isPinUnlocked = unlocked;
    notifyListeners();
    if (unlocked) {
      _tryDispatch();
    }
  }

  /// Clears any retained intent (e.g. explicit sign-out).
  void clearPendingIntent() {
    if (_pending == null) return;
    _pending = null;
    notifyListeners();
  }

  /// Validates an untrusted raw map (`RemoteMessage.data`) and either dispatches
  /// immediately (when authenticated + Admin + PIN-unlocked) or retains it safely.
  bool enqueueFromMap(
    Map<String, dynamic>? raw, {
    String? fallbackTitle,
    String? fallbackBody,
  }) {
    final validation = ValidatedNotificationPayload.parseMap(
      raw,
      fallbackTitle: fallbackTitle,
      fallbackBody: fallbackBody,
      now: _clock(),
    );
    return _enqueueValidated(validation);
  }

  /// Validates an untrusted JSON string (`NotificationResponse.payload`) and
  /// enqueues/dispatches it.
  bool enqueueFromJsonString(String? rawJson) {
    final validation = ValidatedNotificationPayload.parseJsonString(
      rawJson,
      now: _clock(),
    );
    return _enqueueValidated(validation);
  }

  bool _enqueueValidated(PayloadValidationResult validation) {
    if (!validation.isValid || validation.payload == null) {
      _lastRejectionReason = validation.rejectionReason ?? 'invalid_payload';
      notifyListeners();
      return false;
    }

    // If a non-Admin account is currently signed in, reject immediately.
    if (_uid != null && !_isResolving && !_isAdmin) {
      _lastRejectionReason = 'unauthorized_non_admin';
      notifyListeners();
      return false;
    }

    final payload = validation.payload!;
    if (!_interactionDeduplicator.markIfNew(payload.eventId)) {
      _lastRejectionReason = 'duplicate_event_interaction';
      notifyListeners();
      return false;
    }

    _lastRejectionReason = null;
    _pending = PendingNotificationIntent(
      payload: payload,
      capturedAt: _clock(),
      capturedUid: _uid,
    );
    notifyListeners();
    _tryDispatch();
    return true;
  }

  void _discardPending(String reason) {
    if (_pending != null) {
      _pending = null;
      _lastRejectionReason = reason;
    }
  }

  void _tryDispatch() {
    if (_dispatching || _pending == null || !isReadyToNavigate) return;

    final current = _pending!;
    final now = _clock();
    if (now.difference(current.capturedAt) > maxPendingHold) {
      _discardPending('expired_pending_intent');
      notifyListeners();
      return;
    }

    if (current.capturedUid != null && current.capturedUid != _uid) {
      _discardPending('account_switched');
      notifyListeners();
      return;
    }

    final executor = _executor;
    if (executor == null) return;

    _pending = null;
    _dispatching = true;
    notifyListeners();

    Future<void>.microtask(() async {
      try {
        await executor(current.payload);
      } catch (error) {
        debugPrint(
          '[notifications] destination navigation failed safely: ${error.runtimeType}',
        );
      } finally {
        _dispatching = false;
        if (_pending != null && isReadyToNavigate) {
          _tryDispatch();
        }
      }
    });
  }
}
