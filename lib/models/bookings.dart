/// Booking models barrel — two bounded contexts, one import.
///
/// * `booking.dart` (`Booking`): guest flow — P1 local correctness, P2
///   Firestore sync shape, digital key window, KYC axis. Used by
///   `booking_store`, `cloud_bookings`, `door_key`, tracking.
/// * `booking_model.dart` (`BookingModel`, `BookingStatus`): owner/admin
///   flow — Firestore admin reads, mock data, CRM/analytics filters. Used by
///   `firestore_service`, `mock_data_service`, `app_providers`,
///   `views/bookings`, `views/stays`.
///
/// Do not merge the classes: their status vocabularies differ on purpose
/// (guest lowercase vs admin/web `webName`). Import this barrel for new code.
export 'booking.dart';
export 'booking_model.dart';
