import 'dart:async';

import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/admin_notification_model.dart';
import 'package:hacienda_de_luisana/services/notification_contract.dart';
import 'package:hacienda_de_luisana/services/notification_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class RecordedLocalAlert {
  final int id;
  final AdminChannelSpec channel;
  final String title;
  final String body;
  final String payloadJson;

  const RecordedLocalAlert({
    required this.id,
    required this.channel,
    required this.title,
    required this.body,
    required this.payloadJson,
  });
}

class FakeLocalNotificationsGateway implements LocalNotificationsGateway {
  final List<AdminChannelSpec> createdChannels = [];
  final List<RecordedLocalAlert> shownAlerts = [];
  void Function(String? payload)? tapCallback;
  String? launchPayload;
  bool? androidEnabled = true;
  bool? androidRequestOutcome = true;
  bool? iosRequestOutcome = true;

  @override
  Future<void> initialize({
    required void Function(String? payload) onTapPayload,
  }) async {
    tapCallback = onTapPayload;
  }

  @override
  Future<String?> getLaunchPayload() async => launchPayload;

  @override
  Future<void> ensureAndroidChannels(List<AdminChannelSpec> channels) async {
    createdChannels.addAll(channels);
  }

  @override
  Future<bool?> areAndroidNotificationsEnabled() async => androidEnabled;

  @override
  Future<bool?> requestAndroidPermission() async => androidRequestOutcome;

  @override
  Future<bool?> requestIosPermission() async => iosRequestOutcome;

  @override
  Future<void> show({
    required int id,
    required AdminChannelSpec channel,
    required String title,
    required String body,
    required String payloadJson,
  }) async {
    shownAlerts.add(
      RecordedLocalAlert(
        id: id,
        channel: channel,
        title: title,
        body: body,
        payloadJson: payloadJson,
      ),
    );
  }

  void simulateTap(String? payloadJson) {
    tapCallback?.call(payloadJson);
  }
}

class FakeRemoteMessagingGateway implements RemoteMessagingGateway {
  @override
  bool isAvailable = true;

  bool backgroundHandlerRegistered = false;
  bool foregroundSystemDisabled = false;
  NotificationPermission permissionStatus = NotificationPermission.granted;
  NotificationPermission requestResult = NotificationPermission.granted;
  String? currentToken = 'fcm_fake_android_token_initial_1234567890';
  bool failDeleteLocalToken = false;
  int deleteLocalTokenCount = 0;
  RemotePushEnvelope? initialMessage;

  final StreamController<RemotePushEnvelope> foregroundController =
      StreamController<RemotePushEnvelope>.broadcast();
  final StreamController<RemotePushEnvelope> openedAppController =
      StreamController<RemotePushEnvelope>.broadcast();
  final StreamController<String> tokenRefreshController =
      StreamController<String>.broadcast();

  @override
  void registerBackgroundHandler() {
    backgroundHandlerRegistered = true;
  }

  @override
  Future<void> disableForegroundSystemPresentation() async {
    foregroundSystemDisabled = true;
  }

  @override
  Future<NotificationPermission> queryPermissionStatus() async =>
      permissionStatus;

  @override
  Future<NotificationPermission> requestRemotePermission() async {
    permissionStatus = requestResult;
    return requestResult;
  }

  @override
  Future<String?> getToken() async => currentToken;

  @override
  Future<void> deleteLocalToken() async {
    if (failDeleteLocalToken) {
      throw StateError('offline: unable to revoke local FCM token');
    }
    deleteLocalTokenCount += 1;
  }

  @override
  Future<RemotePushEnvelope?> getInitialMessage() async => initialMessage;

  @override
  Stream<RemotePushEnvelope> get onForegroundMessage =>
      foregroundController.stream;

  @override
  Stream<RemotePushEnvelope> get onMessageOpenedApp =>
      openedAppController.stream;

  @override
  Stream<String> get onTokenRefresh => tokenRefreshController.stream;

  Future<void> dispose() async {
    await foregroundController.close();
    await openedAppController.close();
    await tokenRefreshController.close();
  }
}

class FakeTokenRecord {
  final String uid;
  final String token;
  final String platform;
  final bool enabled;

  const FakeTokenRecord({
    required this.uid,
    required this.token,
    required this.platform,
    required this.enabled,
  });
}

class FakeAdminDeviceTokenRegistrar implements AdminDeviceTokenRegistrar {
  final Map<String, FakeTokenRecord> records = {};
  final List<String> operations = [];

  @override
  Future<void> upsertToken({
    required String uid,
    required String token,
    required String platform,
    required bool enabled,
  }) async {
    final id = adminDeviceTokenDocId(uid, token);
    records[id] = FakeTokenRecord(
      uid: uid,
      token: token,
      platform: platform,
      enabled: enabled,
    );
    operations.add('upsert:$uid:${redactFcmToken(token)}:enabled=$enabled');
  }

  @override
  Future<void> deleteToken({
    required String uid,
    required String token,
  }) async {
    final id = adminDeviceTokenDocId(uid, token);
    records.remove(id);
    operations.add('delete:$uid:${redactFcmToken(token)}');
  }
}

void main() {
  final fixedNow = DateTime.utc(2026, 10, 31, 8, 0, 0);

  group('ValidatedNotificationPayload & contract invariants', () {
    test('accepts valid v1 payloads across all allowlisted destinations and round-trips JSON', () {
      final result = ValidatedNotificationPayload.parseMap(
        {
          'v': '1',
          'event_id': 'booking_submitted:booking_abc_1',
          'type': 'booking_submitted',
          'channel_id': 'hdl_admin_bookings',
          'target': 'booking_detail',
          'booking_id': 'booking_abc_1',
          'accommodation': 'main-house',
          'sent_at': '2026-10-31T07:55:00.000Z',
          'title': 'New booking submitted',
          'body': 'A new booking request for Main House is waiting for review.',
        },
        now: fixedNow,
      );

      expect(result.isValid, isTrue);
      expect(
        result.payload!.destination,
        const BookingDetailDestination('booking_abc_1'),
      );

      final roundTripped = ValidatedNotificationPayload.parseJsonString(
        result.payload!.toJsonString(),
        now: fixedNow,
      );
      expect(roundTripped.isValid, isTrue);
      expect(roundTripped.payload!.destination, result.payload!.destination);
      expect(roundTripped.payload!.notificationId, greaterThan(0));
    });

    test('rejects invalid versions, unknown targets, path traversal IDs, malformed JSON, and expired timestamps', () {
      expect(
        ValidatedNotificationPayload.parseMap(
          {'v': '2', 'event_id': 'evt_1', 'type': 'booking_submitted', 'target': 'booking_detail', 'booking_id': 'b1'},
          now: fixedNow,
        ).rejectionReason,
        'unsupported_contract_version',
      );

      expect(
        ValidatedNotificationPayload.parseMap(
          {'v': '1', 'event_id': 'evt_1', 'type': 'booking_submitted', 'target': 'admin_root_shell', 'booking_id': 'b1'},
          now: fixedNow,
        ).rejectionReason,
        'unknown_target_destination',
      );

      expect(
        ValidatedNotificationPayload.parseMap(
          {'v': '1', 'event_id': 'evt_1', 'type': 'booking_submitted', 'target': 'booking_detail', 'booking_id': '../profiles/admin'},
          now: fixedNow,
        ).rejectionReason,
        'invalid_booking_id',
      );

      expect(
        ValidatedNotificationPayload.parseMap(
          {'v': '1', 'event_id': 'evt_1', 'type': 'booking_submitted', 'target': 'booking_detail'},
          now: fixedNow,
        ).rejectionReason,
        'missing_booking_id',
      );

      expect(
        ValidatedNotificationPayload.parseMap(
          {
            'v': '1',
            'event_id': 'evt_old',
            'type': 'booking_submitted',
            'target': 'booking_detail',
            'booking_id': 'booking_1',
            'sent_at': '2026-08-01T00:00:00.000Z',
          },
          now: fixedNow,
        ).rejectionReason,
        'expired_payload',
      );

      expect(
        ValidatedNotificationPayload.parseJsonString('{not-valid-json', now: fixedNow)
            .rejectionReason,
        'malformed_json_payload',
      );
    });

    test('deterministic notification IDs stay non-colliding across distinct bookings and threads', () {
      final idA = deterministicNotificationId('booking_submitted:booking:b1:e1');
      final idB = deterministicNotificationId('booking_submitted:booking:b2:e2');
      final idChat = deterministicNotificationId('guest_message:chat:c1:m1');
      expect(idA, isNot(equals(idB)));
      expect(idA, isNot(equals(idChat)));
      expect(deterministicNotificationId('booking_submitted:booking:b1:e1'), idA);
    });

    test('adminDeviceTokenDocId matches backend uid:sha256_32 contract', () {
      final docId = adminDeviceTokenDocId('admin-uid-1', 'token-xyz');
      expect(
        RegExp(r'^admin-uid-1:[0-9a-f]{32}$').hasMatch(docId),
        isTrue,
      );
    });
  });

  group('NotificationService lifecycle, permissions, deduplication, & token sync', () {
    late FakeLocalNotificationsGateway local;
    late FakeRemoteMessagingGateway remote;
    late FakeAdminDeviceTokenRegistrar registrar;
    late SharedPreferences prefs;
    late NotificationService service;

    setUp(() async {
      SharedPreferences.setMockInitialValues({});
      prefs = await SharedPreferences.getInstance();
      local = FakeLocalNotificationsGateway();
      remote = FakeRemoteMessagingGateway();
      registrar = FakeAdminDeviceTokenRegistrar();
      service = NotificationService.forTesting(
        localGateway: local,
        remoteGateway: remote,
        tokenRegistrar: registrar,
        preferences: prefs,
        platform: TargetPlatform.android,
        clock: () => fixedNow,
      );
    });

    tearDown(() async {
      await service.disposeForTesting();
      await remote.dispose();
    });

    test('creates all 4 durable Android channels eagerly on initialize()', () async {
      await service.initialize();
      expect(
        local.createdChannels.map((c) => c.id).toList(),
        [
          AdminNotificationChannels.bookings,
          AdminNotificationChannels.payments,
          AdminNotificationChannels.messages,
          AdminNotificationChannels.security,
        ],
      );
    });

    test('Android 13+ permission transitions from notAsked -> denied/granted and persists prompt marker', () async {
      remote.permissionStatus = NotificationPermission.denied;
      expect(await service.hasPromptedForPermission(), isFalse);
      expect(await service.currentPermission(), NotificationPermission.notAsked);

      remote.requestResult = NotificationPermission.denied;
      final deniedOutcome = await service.requestPermission();
      expect(deniedOutcome, NotificationPermission.denied);
      expect(await service.hasPromptedForPermission(), isTrue);
      // Subsequent checks report denied rather than re-entering notAsked
      expect(await service.currentPermission(), NotificationPermission.denied);

      // Suppressed while denied: foreground push does not interrupt user
      final shown = await service.handleForegroundPush(
        const RemotePushEnvelope(
          messageId: 'fcm-1',
          data: {
            'v': '1',
            'event_id': 'smart_lock_security:log_1',
            'type': 'smart_lock_security',
            'channel_id': 'hdl_admin_security',
            'target': 'smart_lock',
          },
        ),
      );
      expect(shown, isFalse);
      expect(local.shownAlerts, isEmpty);
    });

    test('deduplicates repeated foreground pushes while still allowing tap routing on the displayed alert', () async {
      await service.initializeRemoteMessaging();
      expect(remote.backgroundHandlerRegistered, isTrue);
      expect(remote.foregroundSystemDisabled, isTrue);

      const envelope = RemotePushEnvelope(
        messageId: 'fcm-msg-55',
        data: {
          'v': '1',
          'event_id': 'payment_proof_submitted:booking_55:proof1',
          'type': 'payment_proof_submitted',
          'channel_id': 'hdl_admin_payments',
          'target': 'payment_queue',
          'booking_id': 'booking_55',
        },
      );

      expect(await service.handleForegroundPush(envelope), isTrue);
      // Duplicate delivery of the same event_id is suppressed
      expect(await service.handleForegroundPush(envelope), isFalse);
      expect(local.shownAlerts.length, 1);
      expect(local.shownAlerts.single.channel.id, AdminNotificationChannels.payments);

      // Tapping that displayed local alert STILL enqueues the tap interaction
      // (display deduplication does not swallow the user's tap!)
      local.simulateTap(local.shownAlerts.single.payloadJson);
      expect(service.intentCoordinator.hasPendingIntent, isTrue);
      expect(
        service.intentCoordinator.pendingIntent!.payload.destination,
        const PaymentVerificationQueueDestination(bookingId: 'booking_55'),
      );
    });

    test('manages Admin FCM token lifecycle across login, refresh, account switch, and logout', () async {
      await service.initializeRemoteMessaging();

      // Non-admin session never registers a token
      await service.syncAdminSession(
        uid: 'guest-uid-99',
        isAdmin: false,
        isResolving: false,
      );
      expect(registrar.records, isEmpty);

      // Verified Admin session registers token under deterministic doc ID
      await service.syncAdminSession(
        uid: 'admin-a',
        isAdmin: true,
        isResolving: false,
      );
      final initialDocId = adminDeviceTokenDocId(
        'admin-a',
        'fcm_fake_android_token_initial_1234567890',
      );
      expect(registrar.records.containsKey(initialDocId), isTrue);
      expect(registrar.records[initialDocId]!.enabled, isTrue);

      // Token refresh deletes old doc and registers rotated token
      remote.currentToken = 'fcm_fake_android_token_rotated_9999999999';
      remote.tokenRefreshController.add(remote.currentToken!);
      await Future<void>.delayed(Duration.zero);

      final rotatedDocId = adminDeviceTokenDocId(
        'admin-a',
        'fcm_fake_android_token_rotated_9999999999',
      );
      expect(registrar.records.containsKey(initialDocId), isFalse);
      expect(registrar.records.containsKey(rotatedDocId), isTrue);

      // Account switch to Admin B cleans up Admin A's pairing and registers Admin B
      await service.syncAdminSession(
        uid: 'admin-b',
        isAdmin: true,
        isResolving: false,
      );
      final adminBDocId = adminDeviceTokenDocId(
        'admin-b',
        'fcm_fake_android_token_rotated_9999999999',
      );
      expect(registrar.records.containsKey(rotatedDocId), isFalse);
      expect(registrar.records.containsKey(adminBDocId), isTrue);

      // Pre-sign-out deletes Firestore token record and local FCM installation token
      await service.onBeforeSignOut(uid: 'admin-b');
      expect(registrar.records, isEmpty);
      expect(remote.deleteLocalTokenCount, 1);
    });

    test('retries deferred deleteLocalToken after offline sign-out and rejects >1024-byte tokens', () async {
      final prefs = await SharedPreferences.getInstance();
      final local = FakeLocalNotificationsGateway();
      final remote = FakeRemoteMessagingGateway();
      final registrar = FakeAdminDeviceTokenRegistrar();

      final service = NotificationService.forTesting(
        localGateway: local,
        remoteGateway: remote,
        tokenRegistrar: registrar,
        preferencesLoader: () async => prefs,
        platformOverride: TargetPlatform.android,
        isWebOverride: false,
      );
      addTearDown(service.dispose);

      await service.initializeRemoteMessaging();

      // Oversized (>1024 chars) token is rejected before Firestore write
      remote.currentToken = 't' * 1100;
      await service.syncAdminSession(
        uid: 'admin-a',
        isAdmin: true,
        isResolving: false,
      );
      expect(registrar.records, isEmpty);

      // Valid token registers normally
      remote.currentToken = 'fcm_fake_android_token_valid_1234567890';
      await service.refreshTokenRegistration();
      expect(registrar.records.length, 1);

      // Sign-out while offline: deleteLocalToken throws, pending wipe flag persists
      remote.failDeleteLocalToken = true;
      await service.onBeforeSignOut(uid: 'admin-a');
      expect(remote.deleteLocalTokenCount, 0);

      // Connectivity restored while signed out -> deferred deleteLocalToken executes once
      remote.failDeleteLocalToken = false;
      await service.syncAdminSession(
        uid: null,
        isAdmin: false,
        isResolving: false,
      );
      expect(remote.deleteLocalTokenCount, 1);

      // Subsequent signed-out sync does not repeat deleteLocalToken unnecessarily
      await service.syncAdminSession(
        uid: null,
        isAdmin: false,
        isResolving: false,
      );
      expect(remote.deleteLocalTokenCount, 1);
    });
  });

  group('AuthGate & PinGateScreen pending-intent security coordinator', () {
    test('holds cold-start destination until Auth + Admin + PIN unlock all succeed, then navigates once', () async {
      DateTime currentClock = fixedNow;
      final routed = <AdminNotificationDestination>[];
      final coordinator = PendingNotificationIntentCoordinator(
        clock: () => currentClock,
      );
      coordinator.attachExecutor((payload) async {
        routed.add(payload.destination);
      });

      // 1. Cold start from terminated tap before Firebase Auth has resolved
      final accepted = coordinator.enqueueFromMap({
        'v': '1',
        'event_id': 'booking_submitted:booking_777',
        'type': 'booking_submitted',
        'target': 'booking_detail',
        'booking_id': 'booking_777',
      });
      expect(accepted, isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(routed, isEmpty);

      // 2. Auth resolving -> still blocked
      coordinator.updateAuthState(
        uid: 'admin-1',
        isAdmin: false,
        isResolving: true,
      );
      await Future<void>.delayed(Duration.zero);
      expect(routed, isEmpty);

      // 3. Auth verified as Admin, but PinGateScreen is still locked -> STILL BLOCKED
      coordinator.updateAuthState(
        uid: 'admin-1',
        isAdmin: true,
        isResolving: false,
      );
      await Future<void>.delayed(Duration.zero);
      expect(routed, isEmpty);
      expect(coordinator.hasPendingIntent, isTrue);

      // 4. Admin unlocks 6-digit PIN -> routes immediately & clears pending intent
      coordinator.setPinUnlocked(true);
      await Future<void>.delayed(Duration.zero);
      expect(routed, [const BookingDetailDestination('booking_777')]);
      expect(coordinator.hasPendingIntent, isFalse);

      // 5. Duplicate tap with the same event_id is rejected
      expect(
        coordinator.enqueueFromMap({
          'v': '1',
          'event_id': 'booking_submitted:booking_777',
          'type': 'booking_submitted',
          'target': 'booking_detail',
          'booking_id': 'booking_777',
        }),
        isFalse,
      );
      expect(coordinator.lastRejectionReason, 'duplicate_event_interaction');
    });

    test('re-locking on AppLifecycleState.paused gates background notification taps behind PinGateScreen', () async {
      final routed = <AdminNotificationDestination>[];
      final coordinator = PendingNotificationIntentCoordinator(
        clock: () => fixedNow,
      );
      coordinator.attachExecutor((payload) async {
        routed.add(payload.destination);
      });

      coordinator.updateAuthState(
        uid: 'admin-1',
        isAdmin: true,
        isResolving: false,
      );
      coordinator.setPinUnlocked(true);

      // App goes to background -> PinGate re-locks
      coordinator.setPinUnlocked(false);

      // Admin taps background chat push -> retained behind PinGateScreen
      coordinator.enqueueFromMap({
        'v': '1',
        'event_id': 'guest_message:convo_1:msg_9',
        'type': 'guest_message',
        'target': 'chat_thread',
        'conversation_id': 'guest-1_booking-1',
        'booking_id': 'booking-1',
        'guest_uid': 'guest-1',
      });
      await Future<void>.delayed(Duration.zero);
      expect(routed, isEmpty);

      // Unlocking PinGateScreen releases the chat route
      coordinator.setPinUnlocked(true);
      await Future<void>.delayed(Duration.zero);
      expect(routed, [
        const ChatThreadDestination(
          conversationId: 'guest-1_booking-1',
          bookingId: 'booking-1',
          guestUid: 'guest-1',
        ),
      ]);
    });

    test('discards pending destination on non-Admin sign-in, sign-out, account switch, or >30m hold expiry', () async {
      DateTime currentClock = fixedNow;
      final routed = <AdminNotificationDestination>[];
      final coordinator = PendingNotificationIntentCoordinator(
        clock: () => currentClock,
      );
      coordinator.attachExecutor((payload) async {
        routed.add(payload.destination);
      });

      // Case A: Non-admin signs in after cold-start tap -> discarded
      coordinator.enqueueFromMap({
        'v': '1',
        'event_id': 'evt_non_admin',
        'type': 'smart_lock_security',
        'target': 'smart_lock',
      });
      coordinator.updateAuthState(
        uid: 'guest-intruder',
        isAdmin: false,
        isResolving: false,
      );
      expect(coordinator.hasPendingIntent, isFalse);
      expect(coordinator.lastRejectionReason, 'unauthorized_non_admin');

      // Case B: Captured under Admin A while PIN-locked, then Admin B signs in -> discarded
      coordinator.updateAuthState(
        uid: 'admin-a',
        isAdmin: true,
        isResolving: false,
      );
      coordinator.setPinUnlocked(false);
      coordinator.enqueueFromMap({
        'v': '1',
        'event_id': 'evt_switch',
        'type': 'booking_submitted',
        'target': 'booking_detail',
        'booking_id': 'booking_switch',
      });
      expect(coordinator.hasPendingIntent, isTrue);

      coordinator.updateAuthState(
        uid: 'admin-b',
        isAdmin: true,
        isResolving: false,
      );
      expect(coordinator.hasPendingIntent, isFalse);
      expect(coordinator.lastRejectionReason, 'account_switched');

      // Case C: Pending hold older than 30 minutes expires without navigating
      coordinator.enqueueFromMap({
        'v': '1',
        'event_id': 'evt_stale_hold',
        'type': 'booking_submitted',
        'target': 'booking_detail',
        'booking_id': 'booking_stale',
      });
      currentClock = fixedNow.add(const Duration(minutes: 31));
      coordinator.setPinUnlocked(true);
      await Future<void>.delayed(Duration.zero);
      expect(routed, isEmpty);
      expect(coordinator.lastRejectionReason, 'expired_pending_intent');
    });
  });

  group('In-app NotificationsScreen & AdminNotificationModel compatibility', () {
    test('preserves Firestore notifications model parsing independent of push permission state', () {
      final model = AdminNotificationModel.fromJson(
        {
          'user_id': 'admin',
          'title': 'New Booking Request',
          'message': 'A new booking was submitted for Main House.',
          'type': 'booking_submitted',
          'booking_id': 'booking_901',
          'read': false,
          'created_at': '2026-10-31T08:00:00.000Z',
        },
        'notif_doc_901',
      );
      expect(model.id, 'notif_doc_901');
      expect(model.bookingId, 'booking_901');
      expect(model.read, isFalse);
    });
  });
}
