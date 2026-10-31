import { initializeApp } from 'firebase-admin/app';

// Keep the existing Functions codebase and its Booking deployment intact. The
// retired dispute/case handlers and scheduler deliberately have no exports here.
export { quoteBooking, verifyBookingMoney } from './quotes';
export { bookingAvailability, submitBooking } from './availability';
export {
  registerAdminDeviceToken,
  unregisterAdminDeviceToken,
  onBookingCreatedNotifyAdmin,
  onBookingUpdatedNotifyAdmin,
  onGuestMessageCreatedNotifyAdmin,
  onAccessLogCreatedNotifyAdmin,
} from './notifications';

// The Booking and Notification modules resolve Admin SDK services lazily, after
// this initialization.
initializeApp();
