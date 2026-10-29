import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/utils/error_utils.dart';

void main() {
  test('maps resource-exhausted, already-exists, and failed-precondition safely', () {
    expect(
      ErrorUtils.toUserMessage(
        Exception('[firebase_functions/resource-exhausted] Quota exceeded for metric'),
      ),
      'Too many attempts. Please wait a moment and try again.',
    );
    expect(
      ErrorUtils.toUserMessage(
        Exception('[cloud_firestore/already-exists] Document already exists: projects/hacienda-de-luisana/databases/(default)/documents/bookings/1'),
      ),
      'Those dates or this record are no longer available. Please refresh and try again.',
    );
    expect(
      ErrorUtils.toUserMessage(
        Exception('[cloud_firestore/failed-precondition] Query requires an index'),
      ),
      'This action cannot be completed with the current details. Please refresh and try again.',
    );
  });

  test('maps auth and network failures without leaking raw SDK details', () {
    expect(
      ErrorUtils.toUserMessage(Exception('[firebase_auth/invalid-credential] Supplied auth credential is incorrect')),
      'Invalid email or password. Please try again.',
    );
    expect(
      ErrorUtils.toUserMessage(Exception('[firebase_functions/deadline-exceeded] Deadline expired before operation could complete')),
      'Network connection issue. Please check your internet connection and try again.',
    );
    expect(
      ErrorUtils.toUserMessage(Exception('[firebase_auth/email-already-in-use] Email is in use')),
      'An account with this email address already exists.',
    );
  });

  test('blocks raw plugin prefixes, internal codes, and database paths while keeping clean domain messages', () {
    const fallback = 'Safe fallback message.';
    expect(
      ErrorUtils.toUserMessage(
        Exception('[cloud_firestore/not-found] projects/hacienda-de-luisana/databases/(default)/documents/bookings/42'),
        fallback: fallback,
      ),
      fallback,
    );
    expect(
      ErrorUtils.toUserMessage(
        Exception('[firebase_functions/internal] INTERNAL'),
        fallback: fallback,
      ),
      fallback,
    );
    expect(
      ErrorUtils.toUserMessage(
        'Booking must be Pending before it can be approved.',
        fallback: fallback,
      ),
      'Booking must be Pending before it can be approved.',
    );
  });
}
