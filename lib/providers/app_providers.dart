import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking_model.dart';
import '../models/guest_location_model.dart';
import '../models/smart_lock_event_model.dart';
import '../models/room_model.dart';
import '../models/guest_crm_model.dart';
import '../services/firestore_service.dart';

// Service provider
final firestoreServiceProvider = Provider<FirestoreService>((ref) {
  FirebaseFirestore? fs;
  try {
    if (Firebase.apps.isNotEmpty) fs = FirebaseFirestore.instance;
  } catch (_) {}
  final service = FirestoreService(fs);
  ref.onDispose(() => service.dispose());
  return service;
});

// Stream providers
final bookingsStreamProvider = StreamProvider<List<BookingModel>>((ref) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamBookings();
});

final trackingSessionsStreamProvider = StreamProvider<List<GuestLocationModel>>((ref) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamTrackingSessions();
});

final smartLockLogsStreamProvider = StreamProvider<List<SmartLockEventModel>>((ref) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamSmartLockLogs();
});

final roomsStreamProvider = StreamProvider<List<RoomModel>>((ref) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamRooms();
});

final guestProfilesStreamProvider = StreamProvider<List<GuestCrmModel>>((ref) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamGuestProfiles();
});

/// The published rates + cancellation policy (`site_config/rates`); null
/// until the Admin publishes one from the Rates screen.
final publishedRatesProvider = StreamProvider<Map<String, dynamic>?>((ref) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamPublishedRates();
});

/// The Activity log of one Booking, oldest first.
final bookingActivityProvider =
    StreamProvider.family<List<Map<String, dynamic>>, String>((ref, id) {
  final service = ref.watch(firestoreServiceProvider);
  return service.streamBookingActivity(id);
});

/// One Booking by id, live — what the detail screen watches so an action's
/// result shows without navigating away.
final bookingByIdProvider = Provider.family<BookingModel?, String>((ref, id) {
  final bookingsAsync = ref.watch(bookingsStreamProvider);
  return bookingsAsync.when(
    data: (list) {
      for (final b in list) {
        if (b.id == id) return b;
      }
      return null;
    },
    loading: () => null,
    error: (_, __) => null,
  );
});

// Selected Booking Tab filter provider
final bookingStatusFilterProvider = StateProvider<BookingStatus?>((ref) => null);

// Filtered Bookings Provider
final filteredBookingsProvider = Provider<List<BookingModel>>((ref) {
  final bookingsAsync = ref.watch(bookingsStreamProvider);
  final filter = ref.watch(bookingStatusFilterProvider);

  return bookingsAsync.when(
    data: (list) {
      if (filter == null) return list;
      return list.where((b) => b.status == filter).toList();
    },
    loading: () => [],
    error: (_, __) => [],
  );
});

// Urgent Approaching Guest Provider (< 5km)
final approachingGuestProvider = Provider<GuestLocationModel?>((ref) {
  final sessionsAsync = ref.watch(trackingSessionsStreamProvider);

  return sessionsAsync.when(
    data: (sessions) {
      final nearList = sessions.where((s) => s.isNearResort && !s.hasArrived).toList();
      if (nearList.isEmpty) return null;
      nearList.sort((a, b) => a.distanceRemainingKm.compareTo(b.distanceRemainingKm));
      return nearList.first;
    },
    loading: () => null,
    error: (_, __) => null,
  );
});

// Dashboard Summary Stats Provider
class DashboardStats {
  final int todayCheckIns;
  final int activeStayingGuests;
  final int pendingRequests;
  final double currentMonthRevenue;
  final int totalGuestsHosted;

  const DashboardStats({
    required this.todayCheckIns,
    required this.activeStayingGuests,
    required this.pendingRequests,
    required this.currentMonthRevenue,
    required this.totalGuestsHosted,
  });
}

final dashboardStatsProvider = Provider<DashboardStats>((ref) {
  final bookingsAsync = ref.watch(bookingsStreamProvider);

  return bookingsAsync.when(
    data: (bookings) {
      final now = DateTime.now();

      final todayCheckIns = bookings.where((b) {
        return b.status != BookingStatus.cancelled &&
            b.checkInDate.year == now.year &&
            b.checkInDate.month == now.month &&
            b.checkInDate.day == now.day;
      }).length;

      final activeStaying = bookings.where((b) {
        return b.status == BookingStatus.checkedIn ||
            (b.status == BookingStatus.confirmed &&
                b.checkInDate.isBefore(now) &&
                b.checkOutDate.isAfter(now));
      }).length;

      final pendingCount = bookings.where((b) => b.status == BookingStatus.pending).length;

      double revenue = 0.0;
      int guestCount = 0;

      for (final b in bookings) {
        if (b.status == BookingStatus.confirmed ||
            b.status == BookingStatus.checkedIn ||
            b.status == BookingStatus.completed) {
          revenue += b.totalAmount;
          guestCount += b.guestCount;
        }
      }

      return DashboardStats(
        todayCheckIns: todayCheckIns,
        activeStayingGuests: activeStaying,
        pendingRequests: pendingCount,
        currentMonthRevenue: revenue,
        totalGuestsHosted: guestCount,
      );
    },
    loading: () => const DashboardStats(
      todayCheckIns: 0,
      activeStayingGuests: 0,
      pendingRequests: 0,
      currentMonthRevenue: 0.0,
      totalGuestsHosted: 0,
    ),
    error: (_, __) => const DashboardStats(
      todayCheckIns: 0,
      activeStayingGuests: 0,
      pendingRequests: 0,
      currentMonthRevenue: 0.0,
      totalGuestsHosted: 0,
    ),
  );
});

// Analytics KPI Model
class AnalyticsKpis {
  final double confirmedRevenue;
  final double projectedRevenue;
  final double averageLengthOfStay;
  final double conversionRate;
  final Map<int, int> stayDurationBuckets;
  final String topAccommodation;

  const AnalyticsKpis({
    required this.confirmedRevenue,
    required this.projectedRevenue,
    required this.averageLengthOfStay,
    required this.conversionRate,
    required this.stayDurationBuckets,
    required this.topAccommodation,
  });
}

final analyticsKpisProvider = Provider<AnalyticsKpis>((ref) {
  final bookingsAsync = ref.watch(bookingsStreamProvider);

  return bookingsAsync.when(
    data: (bookings) {
      if (bookings.isEmpty) {
        return const AnalyticsKpis(
          confirmedRevenue: 0,
          projectedRevenue: 0,
          averageLengthOfStay: 0,
          conversionRate: 0,
          stayDurationBuckets: {1: 0, 2: 0, 3: 0, 5: 0},
          topAccommodation: 'Villa LuisAna',
        );
      }

      double confirmed = 0;
      double projected = 0;
      int totalNights = 0;
      int validStays = 0;
      final buckets = <int, int>{1: 0, 2: 0, 3: 0, 5: 0};
      final accCounts = <String, int>{};

      for (final b in bookings) {
        if (b.status != BookingStatus.cancelled) {
          projected += b.totalAmount;
          totalNights += b.totalNights;
          validStays += 1;

          accCounts[b.accommodation] = (accCounts[b.accommodation] ?? 0) + 1;

          if (b.totalNights == 1) {
            buckets[1] = (buckets[1] ?? 0) + 1;
          } else if (b.totalNights == 2) {
            buckets[2] = (buckets[2] ?? 0) + 1;
          } else if (b.totalNights >= 3 && b.totalNights <= 4) {
            buckets[3] = (buckets[3] ?? 0) + 1;
          } else {
            buckets[5] = (buckets[5] ?? 0) + 1;
          }
        }

        if (b.status == BookingStatus.confirmed ||
            b.status == BookingStatus.checkedIn ||
            b.status == BookingStatus.completed) {
          confirmed += b.totalAmount;
        }
      }

      final alos = validStays > 0 ? (totalNights / validStays) : 0.0;
      final convRate = bookings.isNotEmpty
          ? ((bookings.where((b) => b.status != BookingStatus.cancelled && b.status != BookingStatus.pending).length /
                  bookings.length) *
              100)
          : 0.0;

      String topAcc = 'Villa LuisAna (Main House)';
      int maxCount = -1;
      accCounts.forEach((acc, count) {
        if (count > maxCount) {
          maxCount = count;
          topAcc = acc;
        }
      });

      return AnalyticsKpis(
        confirmedRevenue: confirmed,
        projectedRevenue: projected,
        averageLengthOfStay: (alos * 10).roundToDouble() / 10.0,
        conversionRate: (convRate * 10).roundToDouble() / 10.0,
        stayDurationBuckets: buckets,
        topAccommodation: topAcc,
      );
    },
    loading: () => const AnalyticsKpis(
      confirmedRevenue: 0,
      projectedRevenue: 0,
      averageLengthOfStay: 0,
      conversionRate: 0,
      stayDurationBuckets: {1: 0, 2: 0, 3: 0, 5: 0},
      topAccommodation: 'Villa LuisAna',
    ),
    error: (_, __) => const AnalyticsKpis(
      confirmedRevenue: 0,
      projectedRevenue: 0,
      averageLengthOfStay: 0,
      conversionRate: 0,
      stayDurationBuckets: {1: 0, 2: 0, 3: 0, 5: 0},
      topAccommodation: 'Villa LuisAna',
    ),
  );
});
