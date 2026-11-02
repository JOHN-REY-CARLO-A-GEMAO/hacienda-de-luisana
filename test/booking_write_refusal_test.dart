import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/services/firestore_service.dart';
import 'package:hacienda_de_luisana/utils/error_utils.dart';

/// What the Admin reads when a Booking action is refused.
///
/// The three numbers this guards are the ones an Admin screen must never say to
/// the wrong problem: a `permission-denied` is about the deployed ruleset and
/// the session's role, an unreachable Firestore is about signal, and neither may
/// be reported as the other. The role sources named are this project's own
/// (`profiles/{uid}.role`, a verified allowlisted address) — `users/{uid}` and
/// an `admin` custom claim do not exist here (ADR-0005), and a message that
/// sends the Admin looking for them wastes the one fix they will try.
void main() {
  FirebaseException firestoreError(String code) => FirebaseException(
        plugin: 'cloud_firestore',
        code: code,
        message: 'PERMISSION_DENIED: Missing or insufficient permissions.',
      );

  test('a refused write names the ruleset and the role, not users/{uid}', () {
    final message = bookingWriteRefusalMessage(firestoreError('permission-denied'));

    expect(message, contains('permission-denied'));
    expect(message, contains('firestore.rules'));
    expect(message, contains('profiles/<uid>.role'));
    expect(message, contains('sign out'));
    // The two things a generic snippet would send them to. Neither exists in
    // this project, and both are refusals dressed as advice.
    expect(message, isNot(contains('users/')));
    expect(message, isNot(contains('custom claim')));
  });

  test('an unauthenticated write is judged the same way as a refused one', () {
    expect(
      bookingWriteRefusalMessage(firestoreError('unauthenticated')),
      bookingWriteRefusalMessage(firestoreError('permission-denied')),
    );
  });

  test('an unreachable Firestore says nothing was changed', () {
    final message = bookingWriteRefusalMessage(firestoreError('unavailable'));

    expect(message, contains('walang nabago'));
    expect(message, isNot(contains('permission-denied')));
  });

  test('a deleted Booking asks for a refresh instead of blaming permissions', () {
    final message = bookingWriteRefusalMessage(firestoreError('not-found'));

    expect(message, contains('i-refresh'));
    expect(message, isNot(contains('permission-denied')));
  });

  test('anything else keeps the cause the app can actually show', () {
    final message = bookingWriteRefusalMessage(Exception('boom'));

    expect(message, contains('Hindi na-save ang Booking'));
    expect(message, contains('boom'));
  });

  test('the refusal collapses to the generic sentence if screens re-map it', () {
    // The screens are the reason this message exists: they show it verbatim.
    // ErrorUtils would collapse it — the Tagalog guidance names
    // "permission-denied", which the generic mapper turns back into
    // "You do not have permission to perform this action." — so a test that
    // runs the pass documents what a screen must never do again.
    final message = bookingWriteRefusalMessage(firestoreError('permission-denied'));

    expect(message, contains('profiles/<uid>.role'));
    expect(ErrorUtils.toUserMessage(message), isNot(contains('profiles/<uid>.role')));
  });

  test('the refusal logger survives a debug environment without Firebase', () async {
    // The logger prints, never throws: demo builds (no Firebase app) and unit
    // tests run it in a catch, so a refusal on those paths still classifies
    // instead of crashing the catch block it is called from.
    await expectLater(
      logBookingActionRefusal(firestoreError('permission-denied')),
      completes,
    );
  });
}
