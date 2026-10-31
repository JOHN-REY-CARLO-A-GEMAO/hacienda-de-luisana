import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb, visibleForTesting;
import 'package:flutter/material.dart'
    show Color, WidgetsFlutterBinding, debugPrint;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/constants/app_constants.dart';
import '../firebase_options.dart';
import 'notification_contract.dart';

/// Current notification permission state reported by the host platform.
enum NotificationPermission {
  /// The user has not been asked yet, so calling [NotificationService.requestPermission]
  /// will trigger the operating-system prompt.
  notAsked,

  /// Notifications are enabled and alerts may be posted.
  granted,

  /// iOS provisional permission (quiet Notification Center delivery).
  provisional,

  /// Notifications were denied or disabled in system settings.
  denied,

  /// Unsupported platform (e.g. Web) or state could not be determined.
  unknown,
}

/// Plain-language rationale presented before requesting OS notification permission.
const String kNotificationRationale =
    'Enable push alerts to receive instant updates for new bookings, uploaded '
    'payment proofs, guest messages, stay modification requests, and smart-lock '
    'security events. Your in-app Notifications center continues working even '
    'if push alerts remain off.';

const String _kDisplayedEventIdsPrefKey = 'hdl_notif_displayed_ids_v1';
const String _kConsumedTapEventIdsPrefKey = 'hdl_notif_consumed_taps_v1';
const String _kPermissionPromptedPrefKey = 'hdl_notif_permission_prompted_v1';
const String _kPendingSignOutTokenWipePrefKey =
    'hdl_notif_pending_token_wipe_v1';
const Color _kBrandNotificationColor = Color(0xFF243B26);

/// Top-level background isolate entry point required by `firebase_messaging`.
///
/// Must remain a top-level function annotated with `@pragma('vm:entry-point')`
/// so release tree-shaking preserves it for Android/iOS background isolates.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
    }
  } catch (_) {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
    } catch (_) {}
  }

  final validation = ValidatedNotificationPayload.parseMap(
    message.data,
    fallbackTitle: message.notification?.title,
    fallbackBody: message.notification?.body,
  );
  if (!validation.isValid || validation.payload == null) {
    return;
  }
  final payload = validation.payload!;

  SharedPreferences? prefs;
  try {
    prefs = await SharedPreferences.getInstance();
  } catch (_) {}

  final deduplicator = NotificationDeduplicator(
    initialEntries: prefs?.getStringList(_kDisplayedEventIdsPrefKey) ?? const [],
  );
  final fallbackEventId = message.messageId ?? payload.eventId;
  if (!deduplicator.markIfNew(payload.eventId) ||
      (fallbackEventId != payload.eventId &&
          !deduplicator.markIfNew(fallbackEventId))) {
    return;
  }
  try {
    await prefs?.setStringList(
      _kDisplayedEventIdsPrefKey,
      deduplicator.snapshot(),
    );
  } catch (_) {}

  // When `message.notification != null`, Android/iOS OS already displays the
  // remote notification banner using the channel & small icon configured on the
  // FCM payload. Only render a local notification here for data-only pushes so
  // background deliveries are never shown twice.
  if (message.notification != null || kIsWeb) {
    return;
  }

  final plugin = FlutterLocalNotificationsPlugin();
  const androidInit = AndroidInitializationSettings(kAndroidNotificationSmallIcon);
  const iosInit = DarwinInitializationSettings(
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  );
  await plugin.initialize(
    const InitializationSettings(android: androidInit, iOS: iosInit),
  );

  final androidPlugin = plugin
      .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
  if (androidPlugin != null) {
    for (final spec in AdminNotificationChannels.all) {
      await androidPlugin.createNotificationChannel(
        AndroidNotificationChannel(
          spec.id,
          spec.name,
          description: spec.description,
          importance:
              spec.criticalSecurity ? Importance.max : Importance.high,
          playSound: true,
        ),
      );
    }
  }

  final channelSpec = AdminNotificationChannels.specFor(payload.channelId);
  await plugin.show(
    payload.notificationId,
    payload.title,
    payload.body,
    NotificationDetails(
      android: AndroidNotificationDetails(
        channelSpec.id,
        channelSpec.name,
        channelDescription: channelSpec.description,
        icon: kAndroidNotificationSmallIcon,
        color: _kBrandNotificationColor,
        visibility: NotificationVisibility.private,
        importance:
            channelSpec.criticalSecurity ? Importance.max : Importance.high,
        priority: channelSpec.criticalSecurity ? Priority.max : Priority.high,
      ),
      iOS: const DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
    ),
    payload: payload.toJsonString(),
  );
}

/// Testable abstraction over `FlutterLocalNotificationsPlugin`.
abstract class LocalNotificationsGateway {
  Future<void> initialize({
    required void Function(String? payload) onTapPayload,
  });

  Future<String?> getLaunchPayload();

  Future<void> ensureAndroidChannels(List<AdminChannelSpec> channels);

  Future<bool?> areAndroidNotificationsEnabled();

  Future<bool?> requestAndroidPermission();

  Future<bool?> requestIosPermission();

  Future<void> show({
    required int id,
    required AdminChannelSpec channel,
    required String title,
    required String body,
    required String payloadJson,
  });
}

class PluginLocalNotificationsGateway implements LocalNotificationsGateway {
  final FlutterLocalNotificationsPlugin _plugin;

  PluginLocalNotificationsGateway([FlutterLocalNotificationsPlugin? plugin])
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  @override
  Future<void> initialize({
    required void Function(String? payload) onTapPayload,
  }) async {
    const androidSettings =
        AndroidInitializationSettings(kAndroidNotificationSmallIcon);
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await _plugin.initialize(
      const InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
      ),
      onDidReceiveNotificationResponse: (NotificationResponse response) {
        onTapPayload(response.payload);
      },
    );
  }

  @override
  Future<String?> getLaunchPayload() async {
    final launchDetails = await _plugin.getNotificationAppLaunchDetails();
    if (launchDetails == null || !launchDetails.didNotificationLaunchApp) {
      return null;
    }
    return launchDetails.notificationResponse?.payload;
  }

  @override
  Future<void> ensureAndroidChannels(List<AdminChannelSpec> channels) async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return;
    for (final spec in channels) {
      await android.createNotificationChannel(
        AndroidNotificationChannel(
          spec.id,
          spec.name,
          description: spec.description,
          importance:
              spec.criticalSecurity ? Importance.max : Importance.high,
          playSound: true,
        ),
      );
    }
  }

  @override
  Future<bool?> areAndroidNotificationsEnabled() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return android?.areNotificationsEnabled();
  }

  @override
  Future<bool?> requestAndroidPermission() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    return android?.requestNotificationsPermission();
  }

  @override
  Future<bool?> requestIosPermission() async {
    final ios = _plugin.resolvePlatformSpecificImplementation<
        IOSFlutterLocalNotificationsPlugin>();
    return ios?.requestPermissions(alert: true, badge: true, sound: true);
  }

  @override
  Future<void> show({
    required int id,
    required AdminChannelSpec channel,
    required String title,
    required String body,
    required String payloadJson,
  }) async {
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        channel.id,
        channel.name,
        channelDescription: channel.description,
        icon: kAndroidNotificationSmallIcon,
        color: _kBrandNotificationColor,
        visibility: NotificationVisibility.private,
        importance: channel.criticalSecurity ? Importance.max : Importance.high,
        priority: channel.criticalSecurity ? Priority.max : Priority.high,
      ),
      iOS: const DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
    );
    await _plugin.show(id, title, body, details, payload: payloadJson);
  }
}

/// Normalized snapshot of an incoming remote push message.
class RemotePushEnvelope {
  final String? messageId;
  final Map<String, dynamic> data;
  final String? notificationTitle;
  final String? notificationBody;

  const RemotePushEnvelope({
    this.messageId,
    required this.data,
    this.notificationTitle,
    this.notificationBody,
  });

  factory RemotePushEnvelope.fromRemoteMessage(RemoteMessage message) {
    return RemotePushEnvelope(
      messageId: message.messageId,
      data: Map<String, dynamic>.from(message.data),
      notificationTitle: message.notification?.title,
      notificationBody: message.notification?.body,
    );
  }
}

/// Testable abstraction over `FirebaseMessaging`.
abstract class RemoteMessagingGateway {
  bool get isAvailable;

  void registerBackgroundHandler();

  Future<void> disableForegroundSystemPresentation();

  Future<NotificationPermission> queryPermissionStatus();

  Future<NotificationPermission> requestRemotePermission();

  Future<String?> getToken();

  Future<void> deleteLocalToken();

  Future<RemotePushEnvelope?> getInitialMessage();

  Stream<RemotePushEnvelope> get onForegroundMessage;

  Stream<RemotePushEnvelope> get onMessageOpenedApp;

  Stream<String> get onTokenRefresh;
}

class FirebaseRemoteMessagingGateway implements RemoteMessagingGateway {
  @override
  bool get isAvailable => !kIsWeb && Firebase.apps.isNotEmpty;

  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  @override
  void registerBackgroundHandler() {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  }

  @override
  Future<void> disableForegroundSystemPresentation() async {
    await _messaging.setForegroundNotificationPresentationOptions(
      alert: false,
      badge: false,
      sound: false,
    );
  }

  @override
  Future<NotificationPermission> queryPermissionStatus() async {
    final settings = await _messaging.getNotificationSettings();
    return _mapAuthorizationStatus(settings.authorizationStatus);
  }

  @override
  Future<NotificationPermission> requestRemotePermission() async {
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );
    return _mapAuthorizationStatus(settings.authorizationStatus);
  }

  @override
  Future<String?> getToken() => _messaging.getToken();

  @override
  Future<void> deleteLocalToken() => _messaging.deleteToken();

  @override
  Future<RemotePushEnvelope?> getInitialMessage() async {
    final initial = await _messaging.getInitialMessage();
    if (initial == null) return null;
    return RemotePushEnvelope.fromRemoteMessage(initial);
  }

  @override
  Stream<RemotePushEnvelope> get onForegroundMessage =>
      FirebaseMessaging.onMessage.map(RemotePushEnvelope.fromRemoteMessage);

  @override
  Stream<RemotePushEnvelope> get onMessageOpenedApp =>
      FirebaseMessaging.onMessageOpenedApp
          .map(RemotePushEnvelope.fromRemoteMessage);

  @override
  Stream<String> get onTokenRefresh => _messaging.onTokenRefresh;

  static NotificationPermission _mapAuthorizationStatus(
    AuthorizationStatus status,
  ) {
    switch (status) {
      case AuthorizationStatus.authorized:
        return NotificationPermission.granted;
      case AuthorizationStatus.provisional:
        return NotificationPermission.provisional;
      case AuthorizationStatus.denied:
        return NotificationPermission.denied;
      case AuthorizationStatus.notDetermined:
        return NotificationPermission.notAsked;
      default:
        return NotificationPermission.denied;
    }
  }
}

/// Testable abstraction over `admin_device_tokens` persistence.
abstract class AdminDeviceTokenRegistrar {
  Future<void> upsertToken({
    required String uid,
    required String token,
    required String platform,
    required bool enabled,
  });

  Future<void> deleteToken({
    required String uid,
    required String token,
  });
}

class FirestoreAdminDeviceTokenRegistrar implements AdminDeviceTokenRegistrar {
  final FirebaseFirestore? _firestoreOverride;

  FirestoreAdminDeviceTokenRegistrar([this._firestoreOverride]);

  FirebaseFirestore get _db => _firestoreOverride ?? FirebaseFirestore.instance;

  @override
  Future<void> upsertToken({
    required String uid,
    required String token,
    required String platform,
    required bool enabled,
  }) async {
    if (Firebase.apps.isEmpty && _firestoreOverride == null) return;
    final docId = adminDeviceTokenDocId(uid, token);
    final docRef =
        _db.collection(AppConstants.colAdminDeviceTokens).doc(docId);

    await _db.runTransaction((tx) async {
      final snap = await tx.get(docRef);
      final now = FieldValue.serverTimestamp();
      if (!snap.exists) {
        tx.set(docRef, {
          'uid': uid,
          'token': token,
          'platform': platform,
          'enabled': enabled,
          'created_at': now,
          'updated_at': now,
          'last_seen_at': now,
        });
      } else {
        tx.update(docRef, {
          'platform': platform,
          'enabled': enabled,
          'updated_at': now,
          'last_seen_at': now,
        });
      }
    });
  }

  @override
  Future<void> deleteToken({
    required String uid,
    required String token,
  }) async {
    if (Firebase.apps.isEmpty && _firestoreOverride == null) return;
    final docId = adminDeviceTokenDocId(uid, token);
    final docRef =
        _db.collection(AppConstants.colAdminDeviceTokens).doc(docId);
    final snap = await docRef.get();
    if (snap.exists) {
      await docRef.delete();
    }
  }
}

/// Production notification coordinator for the Hacienda de LuisAna Admin app.
///
/// Responsibilities:
///   - Local notification initialization and eager Android 8+ channel setup.
///   - Remote FCM push initialization, foreground display via
///     `flutter_local_notifications`, background/terminated tap capture, and
///     display/interaction deduplication.
///   - Android 13+ / iOS permission inspection and single-rationale prompting
///     without repetitive OS dialogs.
///   - Authenticated Admin FCM device-token lifecycle (`admin_device_tokens`)
///     handling initial login, token refresh, permission changes, account
///     switching, and pre-sign-out cleanup.
///   - Pending-intent routing gated strictly behind Firebase Auth + verified
///     Admin role + `PinGateScreen` unlock via [intentCoordinator].
class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;

  final LocalNotificationsGateway _localGateway;
  final RemoteMessagingGateway _remoteGateway;
  final AdminDeviceTokenRegistrar _tokenRegistrar;
  final Future<SharedPreferences?> Function() _prefsLoader;
  final TargetPlatform Function() _platformResolver;
  final bool _isWebOverride;
  final DateTime Function() _clock;

  late final NotificationDeduplicator _displayDeduplicator;
  late final NotificationDeduplicator _interactionDeduplicator;
  late final PendingNotificationIntentCoordinator intentCoordinator;

  bool _localInitialized = false;
  bool _remoteInitialized = false;
  bool _prefsHydrated = false;
  SharedPreferences? _prefs;
  NotificationPermission _permission = NotificationPermission.notAsked;

  String? _activeAdminUid;
  String? _registeredUid;
  String? _registeredToken;
  bool? _registeredEnabled;
  Future<void>? _tokenSyncInFlight;

  StreamSubscription<RemotePushEnvelope>? _onMessageSub;
  StreamSubscription<RemotePushEnvelope>? _onOpenedSub;
  StreamSubscription<String>? _onTokenRefreshSub;

  NotificationService._internal()
      : _localGateway = PluginLocalNotificationsGateway(),
        _remoteGateway = FirebaseRemoteMessagingGateway(),
        _tokenRegistrar = FirestoreAdminDeviceTokenRegistrar(),
        _prefsLoader = _defaultPrefsLoader,
        _platformResolver = (() => defaultTargetPlatform),
        _isWebOverride = kIsWeb,
        _clock = DateTime.now {
    _initCoordinators();
  }

  /// Dedicated constructor for deterministic unit tests without platform channels.
  NotificationService.forTesting({
    required LocalNotificationsGateway localGateway,
    required RemoteMessagingGateway remoteGateway,
    required AdminDeviceTokenRegistrar tokenRegistrar,
    SharedPreferences? preferences,
    TargetPlatform platform = TargetPlatform.android,
    bool isWeb = false,
    DateTime Function()? clock,
  })  : _localGateway = localGateway,
        _remoteGateway = remoteGateway,
        _tokenRegistrar = tokenRegistrar,
        _prefsLoader = (() async => preferences),
        _platformResolver = (() => platform),
        _isWebOverride = isWeb,
        _clock = clock ?? DateTime.now {
    _prefs = preferences;
    _initCoordinators();
  }

  void _initCoordinators() {
    _displayDeduplicator = NotificationDeduplicator(
      initialEntries:
          _prefs?.getStringList(_kDisplayedEventIdsPrefKey) ?? const [],
      onPersist: (entries) {
        _prefs?.setStringList(_kDisplayedEventIdsPrefKey, entries);
      },
    );
    _interactionDeduplicator = NotificationDeduplicator(
      initialEntries:
          _prefs?.getStringList(_kConsumedTapEventIdsPrefKey) ?? const [],
      onPersist: (entries) {
        _prefs?.setStringList(_kConsumedTapEventIdsPrefKey, entries);
      },
    );
    intentCoordinator = PendingNotificationIntentCoordinator(
      interactionDeduplicator: _interactionDeduplicator,
      clock: _clock,
    );
  }

  static Future<SharedPreferences?> _defaultPrefsLoader() async {
    try {
      return await SharedPreferences.getInstance();
    } catch (_) {
      return null;
    }
  }

  NotificationPermission get permission => _permission;
  String? get registeredTokenForDiagnostics =>
      _registeredToken == null ? null : redactFcmToken(_registeredToken!);

  bool get _isSupportedMobilePlatform {
    if (_isWebOverride) return false;
    final p = _platformResolver();
    return p == TargetPlatform.android || p == TargetPlatform.iOS;
  }

  String? get _wirePlatform {
    if (_isWebOverride) return null;
    final p = _platformResolver();
    if (p == TargetPlatform.android) return 'android';
    if (p == TargetPlatform.iOS) return 'ios';
    return null;
  }

  Future<void> _hydratePreferencesIfNeeded() async {
    if (_prefsHydrated) return;
    _prefsHydrated = true;
    final loaded = _prefs ?? await _prefsLoader();
    if (loaded == null) return;
    _prefs = loaded;
    for (final id
        in loaded.getStringList(_kDisplayedEventIdsPrefKey) ?? const <String>[]) {
      _displayDeduplicator.markIfNew(id);
    }
    for (final id
        in loaded.getStringList(_kConsumedTapEventIdsPrefKey) ??
            const <String>[]) {
      _interactionDeduplicator.markIfNew(id);
    }
  }

  /// Initializes local notification presentation, creates all durable Android
  /// channels upfront, and inspects any cold-start local notification tap.
  Future<void> initialize() async {
    await _hydratePreferencesIfNeeded();
    if (!_isSupportedMobilePlatform) {
      _permission = NotificationPermission.unknown;
      return;
    }
    if (_localInitialized) return;

    await _localGateway.initialize(
      onTapPayload: _handleLocalNotificationTap,
    );

    if (_platformResolver() == TargetPlatform.android) {
      await _localGateway.ensureAndroidChannels(AdminNotificationChannels.all);
    }

    _localInitialized = true;

    // Cold-start launch from a locally rendered foreground notification.
    try {
      final launchPayload = await _localGateway.getLaunchPayload();
      if (launchPayload != null && launchPayload.isNotEmpty) {
        intentCoordinator.enqueueFromJsonString(launchPayload);
      }
    } catch (_) {}

    await currentPermission();
  }

  /// Initializes Firebase Cloud Messaging listeners, background entry point,
  /// cold-start `getInitialMessage()` capture, and token refresh handling.
  ///
  /// Must be called after `Firebase.initializeApp(...)`. Safe no-op when
  /// Firebase is unavailable (offline demo mode or Web).
  Future<void> initializeRemoteMessaging() async {
    await initialize();
    if (_remoteInitialized ||
        !_isSupportedMobilePlatform ||
        !_remoteGateway.isAvailable) {
      return;
    }

    _remoteGateway.registerBackgroundHandler();
    try {
      await _remoteGateway.disableForegroundSystemPresentation();
    } catch (_) {}

    _onMessageSub =
        _remoteGateway.onForegroundMessage.listen(handleForegroundPush);
    _onOpenedSub =
        _remoteGateway.onMessageOpenedApp.listen(handleRemoteNotificationOpened);
    _onTokenRefreshSub = _remoteGateway.onTokenRefresh.listen((newToken) {
      unawaited(_handleTokenRefresh(newToken));
    });

    _remoteInitialized = true;

    try {
      final initial = await _remoteGateway.getInitialMessage();
      if (initial != null) {
        handleRemoteNotificationOpened(initial);
      }
    } catch (_) {}

    await currentPermission();
    if (_activeAdminUid != null) {
      await _syncTokenForActiveAdmin();
    } else {
      await _flushPendingLocalTokenWipeIfSignedOut();
    }
  }

  /// Whether the user has already seen our in-app notification prompt before.
  Future<bool> hasPromptedForPermission() async {
    await _hydratePreferencesIfNeeded();
    return _prefs?.getBool(_kPermissionPromptedPrefKey) ?? false;
  }

  /// Inspects OS notification permission without triggering a system dialog.
  Future<NotificationPermission> currentPermission() async {
    await _hydratePreferencesIfNeeded();
    if (!_isSupportedMobilePlatform) {
      _permission = NotificationPermission.unknown;
      return _permission;
    }

    final alreadyPrompted =
        _prefs?.getBool(_kPermissionPromptedPrefKey) ?? false;

    if (_remoteGateway.isAvailable) {
      try {
        final remoteStatus = await _remoteGateway.queryPermissionStatus();
        if (_platformResolver() == TargetPlatform.android &&
            remoteStatus == NotificationPermission.denied &&
            !alreadyPrompted) {
          // On Android 13+, notifications start disabled until requested once;
          // distinguish first-ask from post-prompt denial using persisted state.
          _permission = NotificationPermission.notAsked;
          return _permission;
        }
        _permission = remoteStatus;
        return _permission;
      } catch (_) {}
    }

    if (_platformResolver() == TargetPlatform.android) {
      final enabled = await _localGateway.areAndroidNotificationsEnabled();
      if (enabled == true) {
        _permission = NotificationPermission.granted;
      } else if (enabled == false) {
        _permission = alreadyPrompted
            ? NotificationPermission.denied
            : NotificationPermission.notAsked;
      } else {
        _permission = NotificationPermission.unknown;
      }
      return _permission;
    }

    return _permission;
  }

  /// Requests OS notification permission ONLY after an explicit user gesture.
  ///
  /// Marks the prompt as shown so the app never nags repeatedly on startup or
  /// future sessions, and syncs the Admin device token when granted.
  Future<NotificationPermission> requestPermission() async {
    await initialize();
    if (!_isSupportedMobilePlatform) {
      _permission = NotificationPermission.unknown;
      return _permission;
    }

    await _prefs?.setBool(_kPermissionPromptedPrefKey, true);

    if (_platformResolver() == TargetPlatform.android) {
      bool? granted;
      if (_remoteGateway.isAvailable) {
        final status = await _remoteGateway.requestRemotePermission();
        granted = status == NotificationPermission.granted ||
            status == NotificationPermission.provisional;
      } else {
        granted = await _localGateway.requestAndroidPermission();
      }
      _permission = (granted ?? false)
          ? NotificationPermission.granted
          : NotificationPermission.denied;
    } else if (_platformResolver() == TargetPlatform.iOS) {
      if (_remoteGateway.isAvailable) {
        _permission = await _remoteGateway.requestRemotePermission();
      } else {
        final granted = await _localGateway.requestIosPermission();
        _permission = (granted ?? false)
            ? NotificationPermission.granted
            : NotificationPermission.denied;
      }
    }

    if (_activeAdminUid != null) {
      await _syncTokenForActiveAdmin(forceRefresh: true);
    }
    return _permission;
  }

  /// Synchronizes AuthGate session changes with both [intentCoordinator] and
  /// `admin_device_tokens` registration.
  Future<void> syncAdminSession({
    required String? uid,
    required bool isAdmin,
    required bool isResolving,
  }) async {
    intentCoordinator.updateAuthState(
      uid: uid,
      isAdmin: isAdmin,
      isResolving: isResolving,
    );

    if (isResolving) return;

    final normalizedUid =
        (uid == null || uid.trim().isEmpty) ? null : uid.trim();

    if (!isAdmin || normalizedUid == null) {
      _activeAdminUid = null;
      _registeredUid = null;
      _registeredToken = null;
      _registeredEnabled = null;
      await _flushPendingLocalTokenWipeIfSignedOut();
      return;
    }

    // Account switch while an older Admin token was cached in memory:
    // clean up the previous Admin pairing best-effort before registering the new one.
    if (_registeredUid != null &&
        _registeredUid != normalizedUid &&
        _registeredToken != null) {
      final staleUid = _registeredUid!;
      final staleToken = _registeredToken!;
      _registeredUid = null;
      _registeredToken = null;
      _registeredEnabled = null;
      try {
        await _tokenRegistrar.deleteToken(uid: staleUid, token: staleToken);
      } catch (_) {}
    }

    _activeAdminUid = normalizedUid;
    await _syncTokenForActiveAdmin();
  }

  /// Refreshes permission + FCM token registration for the signed-in Admin
  /// (e.g. when returning from Android System Settings).
  Future<void> refreshTokenRegistration() async {
    await currentPermission();
    if (_activeAdminUid != null) {
      await _syncTokenForActiveAdmin(forceRefresh: true);
    }
  }

  /// Must be awaited BEFORE `FirebaseAuth.instance.signOut()` so `request.auth`
  /// is still valid when deleting `admin_device_tokens/{tokenId}`.
  Future<void> onBeforeSignOut({String? uid}) async {
    intentCoordinator.clearPendingIntent();
    intentCoordinator.setPinUnlocked(false);

    final effectiveUid = (uid ?? _activeAdminUid ?? _registeredUid)?.trim();
    String? tokenToRemove = _registeredToken;
    if (tokenToRemove == null &&
        _isSupportedMobilePlatform &&
        _remoteGateway.isAvailable) {
      try {
        tokenToRemove = await _remoteGateway.getToken();
      } catch (_) {}
    }

    _activeAdminUid = null;
    _registeredUid = null;
    _registeredToken = null;
    _registeredEnabled = null;

    await _hydratePreferencesIfNeeded();
    if (effectiveUid != null && effectiveUid.isNotEmpty) {
      await _prefs?.setBool(_kPendingSignOutTokenWipePrefKey, true);
    }

    if (effectiveUid != null &&
        effectiveUid.isNotEmpty &&
        tokenToRemove != null &&
        tokenToRemove.trim().isNotEmpty) {
      try {
        await _tokenRegistrar.deleteToken(
          uid: effectiveUid,
          token: tokenToRemove.trim(),
        );
      } catch (error) {
        debugPrint(
          '[notifications] best-effort token unregister failed: ${error.runtimeType}',
        );
      }
    }

    if (_isSupportedMobilePlatform && _remoteGateway.isAvailable) {
      try {
        await _remoteGateway.deleteLocalToken();
        await _prefs?.setBool(_kPendingSignOutTokenWipePrefKey, false);
      } catch (_) {}
    }
  }

  Future<void> _flushPendingLocalTokenWipeIfSignedOut() async {
    await _hydratePreferencesIfNeeded();
    if (_activeAdminUid != null) return;
    final pendingWipe =
        _prefs?.getBool(_kPendingSignOutTokenWipePrefKey) ?? false;
    if (!pendingWipe ||
        !_isSupportedMobilePlatform ||
        !_remoteGateway.isAvailable) {
      return;
    }
    try {
      await _remoteGateway.deleteLocalToken();
      await _prefs?.setBool(_kPendingSignOutTokenWipePrefKey, false);
    } catch (_) {}
  }

  Future<void> _syncTokenForActiveAdmin({bool forceRefresh = false}) {
    final existing = _tokenSyncInFlight;
    if (existing != null && !forceRefresh) return existing;

    final future = _performTokenSync(forceRefresh: forceRefresh);
    _tokenSyncInFlight = future;
    return future.whenComplete(() {
      if (identical(_tokenSyncInFlight, future)) {
        _tokenSyncInFlight = null;
      }
    });
  }

  Future<void> _performTokenSync({required bool forceRefresh}) async {
    final uid = _activeAdminUid;
    final platform = _wirePlatform;
    if (uid == null ||
        platform == null ||
        !_isSupportedMobilePlatform ||
        !_remoteGateway.isAvailable) {
      return;
    }

    final perm = await currentPermission();
    final pushEnabled = perm == NotificationPermission.granted ||
        perm == NotificationPermission.provisional;

    String? token;
    try {
      token = (await _remoteGateway.getToken())?.trim();
    } catch (error) {
      debugPrint(
        '[notifications] FCM getToken failed safely: ${error.runtimeType}',
      );
      return;
    }
    if (token == null || token.length < 20 || token.length > 1024) return;

    // Clear any deferred sign-out wipe flag once an active Admin session claims a token.
    await _prefs?.setBool(_kPendingSignOutTokenWipePrefKey, false);

    // Still the same active Admin after async gap?
    if (_activeAdminUid != uid) return;

    if (!forceRefresh &&
        _registeredUid == uid &&
        _registeredToken == token &&
        _registeredEnabled == pushEnabled) {
      return;
    }

    // If token rotated since our last registration for this uid, delete old doc.
    if (_registeredUid == uid &&
        _registeredToken != null &&
        _registeredToken != token) {
      final previousToken = _registeredToken!;
      try {
        await _tokenRegistrar.deleteToken(uid: uid, token: previousToken);
      } catch (_) {}
    }

    try {
      await _tokenRegistrar.upsertToken(
        uid: uid,
        token: token,
        platform: platform,
        enabled: pushEnabled,
      );
      _registeredUid = uid;
      _registeredToken = token;
      _registeredEnabled = pushEnabled;
    } catch (error) {
      debugPrint(
        '[notifications] token upsert (${redactFcmToken(token)}) failed safely: ${error.runtimeType}',
      );
    }
  }

  Future<void> _handleTokenRefresh(String refreshedToken) async {
    final uid = _activeAdminUid;
    final platform = _wirePlatform;
    final trimmed = refreshedToken.trim();
    if (uid == null ||
        platform == null ||
        trimmed.length < 20 ||
        trimmed.length > 1024) {
      return;
    }

    final previousToken = _registeredToken;
    if (previousToken != null && previousToken != trimmed) {
      try {
        await _tokenRegistrar.deleteToken(uid: uid, token: previousToken);
      } catch (_) {}
    }

    final perm = await currentPermission();
    final pushEnabled = perm == NotificationPermission.granted ||
        perm == NotificationPermission.provisional;

    try {
      await _tokenRegistrar.upsertToken(
        uid: uid,
        token: trimmed,
        platform: platform,
        enabled: pushEnabled,
      );
      _registeredUid = uid;
      _registeredToken = trimmed;
      _registeredEnabled = pushEnabled;
    } catch (error) {
      debugPrint(
        '[notifications] refreshed token upsert (${redactFcmToken(trimmed)}) failed: ${error.runtimeType}',
      );
    }
  }

  /// Handles a foreground FCM push: validates the `v: '1'` payload, deduplicates
  /// by `event_id`, checks notification permission, and renders a local alert
  /// on the matching Android channel without writing duplicate Firestore docs.
  @visibleForTesting
  Future<bool> handleForegroundPush(RemotePushEnvelope envelope) async {
    await initialize();

    final validation = ValidatedNotificationPayload.parseMap(
      envelope.data,
      fallbackTitle: envelope.notificationTitle,
      fallbackBody: envelope.notificationBody,
      now: _clock(),
    );
    if (!validation.isValid || validation.payload == null) {
      return false;
    }

    final payload = validation.payload!;
    if (!_displayDeduplicator.markIfNew(payload.eventId)) {
      return false;
    }
    if (envelope.messageId != null &&
        envelope.messageId!.isNotEmpty &&
        envelope.messageId != payload.eventId) {
      _displayDeduplicator.markIfNew(envelope.messageId!);
    }

    if (!await _canPost()) {
      return false;
    }

    final channelSpec = AdminNotificationChannels.specFor(payload.channelId);
    await _localGateway.show(
      id: payload.notificationId,
      channel: channelSpec,
      title: payload.title,
      body: payload.body,
      payloadJson: payload.toJsonString(),
    );
    return true;
  }

  /// Handles tapping an OS-rendered FCM notification from background or
  /// cold-start (`onMessageOpenedApp` / `getInitialMessage`).
  @visibleForTesting
  bool handleRemoteNotificationOpened(RemotePushEnvelope envelope) {
    return intentCoordinator.enqueueFromMap(
      envelope.data,
      fallbackTitle: envelope.notificationTitle,
      fallbackBody: envelope.notificationBody,
    );
  }

  void _handleLocalNotificationTap(String? payloadJson) {
    intentCoordinator.enqueueFromJsonString(payloadJson);
  }

  Future<bool> _canPost() async {
    final perm = await currentPermission();
    return perm == NotificationPermission.granted ||
        perm == NotificationPermission.provisional;
  }

  Future<void> _showStructuredLocalAlert(
    ValidatedNotificationPayload payload,
  ) async {
    await initialize();
    if (!_displayDeduplicator.markIfNew(payload.eventId)) return;
    if (!await _canPost()) return;

    final channelSpec = AdminNotificationChannels.specFor(payload.channelId);
    await _localGateway.show(
      id: payload.notificationId,
      channel: channelSpec,
      title: payload.title,
      body: payload.body,
      payloadJson: payload.toJsonString(),
    );
  }

  // ── Structured Local Helper Alerts (backwards-compatible public surface) ──

  Future<void> showNewBookingAlert({
    required String bookingId,
    String? guestName,
    String? accommodation,
  }) async {
    final unit = (accommodation != null && accommodation.trim().isNotEmpty)
        ? accommodation.trim()
        : 'Hacienda de LuisAna';
    await _showStructuredLocalAlert(
      ValidatedNotificationPayload(
        eventId: 'local:booking_submitted:$bookingId',
        type: AdminPushEventType.bookingSubmitted,
        channelId: AdminNotificationChannels.bookings,
        destination: BookingDetailDestination(bookingId),
        title: 'New booking submitted',
        body: 'A new booking request for $unit is waiting for review.',
        sentAt: _clock().toUtc(),
      ),
    );
  }

  Future<void> showBookingConfirmedAlert({
    required String bookingId,
    String? accommodation,
  }) async {
    final unit = (accommodation != null && accommodation.trim().isNotEmpty)
        ? accommodation.trim()
        : 'Hacienda de LuisAna';
    await _showStructuredLocalAlert(
      ValidatedNotificationPayload(
        eventId: 'local:booking_confirmed:$bookingId',
        type: AdminPushEventType.bookingStatusChanged,
        channelId: AdminNotificationChannels.bookings,
        destination: BookingDetailDestination(bookingId),
        title: 'Booking reserved',
        body: '$unit booking has been confirmed.',
        sentAt: _clock().toUtc(),
      ),
    );
  }

  Future<void> showPaymentVerifiedAlert({
    required String bookingId,
    String? amount,
  }) async {
    await _showStructuredLocalAlert(
      ValidatedNotificationPayload(
        eventId: 'local:payment_verified:$bookingId',
        type: AdminPushEventType.bookingStatusChanged,
        channelId: AdminNotificationChannels.payments,
        destination: BookingDetailDestination(bookingId),
        title: 'Payment verified',
        body: 'Payment verification completed for booking.',
        sentAt: _clock().toUtc(),
      ),
    );
  }

  Future<void> showCheckInReminderAlert({
    required String bookingId,
    String? guestName,
  }) async {
    await _showStructuredLocalAlert(
      ValidatedNotificationPayload(
        eventId: 'local:checkin_reminder:$bookingId',
        type: AdminPushEventType.bookingStatusChanged,
        channelId: AdminNotificationChannels.bookings,
        destination: BookingDetailDestination(bookingId),
        title: 'Upcoming check-in',
        body: 'A scheduled stay is due for check-in today.',
        sentAt: _clock().toUtc(),
      ),
    );
  }

  Future<void> showSmartLockAlert({
    required String message,
    String? eventId,
  }) async {
    final resolvedId = (eventId != null && eventId.trim().isNotEmpty)
        ? eventId.trim()
        : 'local:smart_lock:${deterministicNotificationId(message)}';
    await _showStructuredLocalAlert(
      ValidatedNotificationPayload(
        eventId: resolvedId,
        type: AdminPushEventType.smartLockSecurity,
        channelId: AdminNotificationChannels.security,
        destination: const SmartLockDestination(),
        title: 'Smart lock security alert',
        body: message,
        sentAt: _clock().toUtc(),
      ),
    );
  }

  /// Disposes stream subscriptions in tests.
  @visibleForTesting
  Future<void> disposeForTesting() async {
    await _onMessageSub?.cancel();
    await _onOpenedSub?.cancel();
    await _onTokenRefreshSub?.cancel();
  }
}
