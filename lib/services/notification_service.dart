import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const initSettings = InitializationSettings(android: androidSettings, iOS: iosSettings);

    try {
      await _localNotifications.initialize(initSettings);
      _initialized = true;
    } catch (_) {
      // In web or tests, local notification initialization may be skipped
    }
  }

  Future<void> showNewBookingAlert(String guestName, String accommodation) async {
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
    } catch (_) {}
  }

  Future<void> showProximityGeofenceAlert(String guestName, double distanceKm, int etaMinutes) async {
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        'proximity_channel',
        'Guest Radar Alert',
        channelDescription: 'High-priority alert when guests are near the resort',
        importance: Importance.max,
        priority: Priority.max,
      ),
      iOS: DarwinNotificationDetails(),
    );

    try {
      await _localNotifications.show(
        102,
        '🚨 Booker Malapit Na!',
        '$guestName is ${distanceKm.toStringAsFixed(1)} km away (~$etaMinutes mins)! Prepare the villa keys.',
        details,
      );
    } catch (_) {}
  }

  Future<void> showSmartLockSecurityAlert(String doorName, String reason) async {
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
    } catch (_) {}
  }
}
