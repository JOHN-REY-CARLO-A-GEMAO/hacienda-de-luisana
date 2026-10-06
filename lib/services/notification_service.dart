import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Why the app is asking for notifications, said to the person before the
/// system dialog appears.
///
/// Android 13+ grants this at runtime and only from one place that has a good
/// reason. Asking on first launch, before the Admin has seen anything worth
/// being told about, is the pattern that gets a permission permanently denied —
/// so it is asked the first time there is a real booking or a real denied door
/// attempt, not on startup.
const String kNotificationRationale =
    'Hacienda de LuisAna can alert you the moment a Guest requests a Booking or '
    'a door is opened by a credential that should not have opened it. Without '
    'this you have to open the app yourself to find out.';

enum NotificationPermission {
  /// Android has not been asked yet, or is too old to ask.
  notAsked,

  granted,

  /// The person said no. Carried rather than retried: Android stops showing the
  /// dialog after a refusal, so asking again would be theatre.
  denied,

  /// The platform refused to answer.
  unknown,
}

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  bool _initialized = false;
  NotificationPermission _permission = NotificationPermission.notAsked;

  /// What the last request returned. A screen can read this to explain itself
  /// instead of finding out that nothing arrived.
  NotificationPermission get permission => _permission;

  Future<void> initialize() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );

    const initSettings = InitializationSettings(android: androidSettings, iOS: iosSettings);

    try {
      await _localNotifications.initialize(initSettings);
      _initialized = true;
    } catch (error) {
      // A device with no notification service (a test, a bare container) must
      // not stop the app from starting; the rest of the app does not need it.
      debugPrint('[notifications] initialization unavailable: $error');
    }
  }

  /// What the person has already decided, without asking them again.
  Future<NotificationPermission> currentPermission() async {
    if (kIsWeb || !Platform.isAndroid) return _permission;
    final android = _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return NotificationPermission.unknown;
    try {
      final enabled = await android.areNotificationsEnabled();
      if (enabled == null) {
        _permission = NotificationPermission.unknown;
      } else {
        _permission = enabled
            ? NotificationPermission.granted
            : NotificationPermission.denied;
      }
    } catch (error) {
      debugPrint('[notifications] could not read the permission: $error');
      _permission = NotificationPermission.unknown;
    }
    return _permission;
  }

  /// Ask once, at the point where the answer starts to be worth something.
  ///
  /// Returns what happened so the caller can say so: a refusal is a state the
  /// app carries, not an error it swallows.
  Future<NotificationPermission> requestPermission() async {
    if (kIsWeb) return NotificationPermission.notAsked;
    if (!Platform.isAndroid) {
      // iOS asked for its own alerts at initialize() in the deployment that
      // ships to a device; nothing extra is needed here.
      return NotificationPermission.granted;
    }

    final already = await currentPermission();
    if (already == NotificationPermission.granted) return already;

    final android = _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) {
      _permission = NotificationPermission.unknown;
      return _permission;
    }
    try {
      final granted = await android.requestNotificationsPermission();
      _permission = granted == null
          ? NotificationPermission.unknown
          : (granted
              ? NotificationPermission.granted
              : NotificationPermission.denied);
    } catch (error) {
      debugPrint('[notifications] the request failed: $error');
      _permission = NotificationPermission.unknown;
    }
    return _permission;
  }

  Future<void> showNewBookingAlert(String guestName, String accommodation) async {
    if (!_canPost()) return;
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'new_bookings_channel',
        'New Bookings',
        channelDescription: 'Notifications for incoming guest booking requests',
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: DarwinNotificationDetails(),
    );

    try {
      await _localNotifications.show(
        101,
        '🔔 New Booking Request',
        '$guestName requested to book $accommodation!',
        details,
      );
    } catch (error) {
      debugPrint('[notifications] could not show the booking alert: $error');
    }
  }

  Future<void> showSmartLockSecurityAlert(String doorName, String reason) async {
    if (!_canPost()) return;
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'security_channel',
        'Smart Lock Security',
        channelDescription: 'Alerts for unauthorized access attempts',
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: DarwinNotificationDetails(),
    );

    try {
      await _localNotifications.show(
        103,
        '⚠️ Smart Lock Security Alert',
        'Access Denied at $doorName: $reason',
        details,
      );
    } catch (error) {
      debugPrint('[notifications] could not show the lock alert: $error');
    }
  }

  bool _canPost() {
    if (kIsWeb) return false;
    // On Android a refusal means the system drops the notification anyway; on
    // iOS the platform never had to be asked separately here.
    if (Platform.isAndroid &&
        _permission == NotificationPermission.denied) {
      return false;
    }
    return true;
  }
}