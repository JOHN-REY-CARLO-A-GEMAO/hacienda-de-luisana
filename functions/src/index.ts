import { initializeApp } from 'firebase-admin/app';

// Keep the existing Functions codebase and its Booking deployment intact. The
// retired dispute/case handlers and scheduler deliberately have no exports here.
export { quoteBooking, verifyBookingMoney } from './quotes';
export { bookingAvailability, submitBooking } from './availability';
// Reads a Guest's payment screenshot with OCR.space (ADR-0024). Refuses with
// `failed-precondition` when OCR_SPACE_API_KEY is unset, which is what makes the
// website fall back to tesseract.js without a rebuild.
export { readReceiptText } from './ocr';
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
