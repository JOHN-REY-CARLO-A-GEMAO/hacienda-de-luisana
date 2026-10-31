import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'notification_service.dart';

class AuthException implements Exception {
  final String message;
  const AuthException(this.message);

  @override
  String toString() => message;
}

/// The Admin session of the Hacienda de LuisAna Admin app.
///
/// Two roles exist in the whole system (ADR-0007): the **Guest**, who uses the
/// website, and the **Admin**, who uses this app. There is no Staff and no
/// Host role. A signed-in account is the Admin when either
///
///  * its email is on [kAdminEmails] — the bootstrap allowlist that
///    `firestore.rules` (`adminEmails()`), `storage.rules` (`isAdminEmail()`)
///    and the website's `src/lib/auth/profile.ts` share — or
///  * its `profiles/{uid}` document carries `role == 'admin'`.
///
/// Anyone else who signs in is told the app is for the Admin and signed
/// straight back out; Guests book on the website.
class AuthStore extends ChangeNotifier {
  /// Bootstrap Admin allowlist. Single source of truth is
  /// src/config/admin-roles.json (imported by src/lib/auth/profile.ts).
  /// Keep in sync with firestore.rules, storage.rules, database.rules.json,
  /// functions/src/quotes.ts, and src/lib/auth/profile.ts.
  static const List<String> kAdminEmails = [
    'gemaojohnreyarguilles@gmail.com',
  ];

  /// The address pre-filled on the sign-in screen.
  static String get kDefaultAdminEmail => kAdminEmails.last;

  /// Web OAuth client (type 3 in google-services.json). google_sign_in v7
  /// needs this to mint an ID token on Android — without it the account
  /// picker opens but sign-in dies right after picking an account.
  static const String kServerClientId =
      '648433185-oionh5246016o76d7hnr8fv2q35h4v9j.apps.googleusercontent.com';

  User? _firebaseUser;
  User? get firebaseUser => _firebaseUser;

  /// Whether `profiles/{uid}.role == 'admin'` for the current session.
  bool _profileIsAdmin = false;
  bool _profileChecked = false;

  /// Email on the Firebase token (null when signed out).
  String? get sessionEmail => _firebaseUser?.email;
  String? get uid => _firebaseUser?.uid;
  String? get displayName => _firebaseUser?.displayName;

  bool get isSignedIn =>
      _firebaseUser != null && (_firebaseUser?.email?.isNotEmpty ?? false);

  static bool isAllowlisted(String? email) =>
      email != null && kAdminEmails.contains(email.trim().toLowerCase());

  bool get _isVerifiedAllowlisted =>
      isAllowlisted(sessionEmail) && (_firebaseUser?.emailVerified ?? false);

  /// Is this session the Admin? Matches `firestore.rules` (`tokenEmailVerified`)
  /// and `functions/src/notifications.ts` (`isVerifiedAdmin`): an allowlisted
  /// bootstrap address must have `emailVerified == true`, otherwise Admin
  /// status requires `profiles/{uid}.role == 'admin'`.
  bool get isAdmin =>
      isSignedIn && (_isVerifiedAllowlisted || _profileIsAdmin);

  /// True while the Profile lookup for a non-bootstrap-verified account is in flight.
  bool get isResolving =>
      isSignedIn && !_isVerifiedAllowlisted && !_profileChecked;

  StreamSubscription<User?>? _authSub;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _profileSub;
  bool _googleInitialized = false;

  AuthStore() {
    _listenFirebaseAuth();
  }

  Future<void> _ensureGoogleInitialized() async {
    if (_googleInitialized) return;
    await GoogleSignIn.instance.initialize(serverClientId: kServerClientId);
    _googleInitialized = true;
  }

  /// Subscribes to Firebase auth state (best-effort — never throws, so unit
  /// tests and local-only mode keep working without Firebase configured).
  void _listenFirebaseAuth() {
    try {
      if (Firebase.apps.isEmpty) return;
      _firebaseUser = FirebaseAuth.instance.currentUser;
      _resolveProfileRole();
      _authSub = FirebaseAuth.instance.authStateChanges().listen((u) {
        _firebaseUser = u;
        _profileIsAdmin = false;
        _profileChecked = false;
        notifyListeners();
        _resolveProfileRole();
      });
    } catch (_) {
      // Local-only / test mode — stays signed out.
    }
  }

  /// Reads and watches `profiles/{uid}.role` for accounts not satisfied by a
  /// verified bootstrap email, so live role revocation immediately demotes
  /// the client session instead of leaving a stale Admin flag in memory.
  Future<void> _resolveProfileRole() async {
    await _profileSub?.cancel();
    _profileSub = null;

    final user = _firebaseUser;
    if (user == null) return;
    if (isAllowlisted(user.email) && user.emailVerified) {
      _profileIsAdmin = true;
      _profileChecked = true;
      notifyListeners();
      return;
    }

    final targetUid = user.uid;
    final docRef =
        FirebaseFirestore.instance.collection('profiles').doc(targetUid);
    try {
      final snap = await docRef.get();
      if (_firebaseUser?.uid != targetUid) return;
      _profileIsAdmin = (snap.data()?['role'] ?? '') == 'admin';
    } catch (_) {
      if (_firebaseUser?.uid != targetUid) return;
      _profileIsAdmin = false;
    }
    _profileChecked = true;
    notifyListeners();

    _profileSub = docRef.snapshots().listen(
      (snap) {
        if (_firebaseUser?.uid != targetUid) return;
        final nextAdmin =
            snap.exists && (snap.data()?['role'] ?? '') == 'admin';
        if (_profileIsAdmin != nextAdmin || !_profileChecked) {
          _profileIsAdmin = nextAdmin;
          _profileChecked = true;
          notifyListeners();
        }
      },
      onError: (_) {
        if (_firebaseUser?.uid != targetUid) return;
        if (_profileIsAdmin) {
          _profileIsAdmin = false;
          notifyListeners();
        }
      },
    );
  }

  /// One-tap Google sign-in. Returns the signed-in email.
  /// Throws [AuthException] with a human message on cancel/failure.
  Future<String> signInWithGoogle() async {
    try {
      if (Firebase.apps.isEmpty) {
        throw const AuthException(
            'Cloud not configured on this build — connect Firebase first.');
      }
      await _ensureGoogleInitialized();
      // v7: throws GoogleSignInException(code: canceled) on dismiss.
      final account = await GoogleSignIn.instance.authenticate();
      final googleAuth = account.authentication;
      final credential = GoogleAuthProvider.credential(
        idToken: googleAuth.idToken,
      );
      final cred = await FirebaseAuth.instance.signInWithCredential(credential);
      _firebaseUser = cred.user;
      final email = _firebaseUser?.email ?? '';
      if (email.isEmpty) {
        throw const AuthException(
            'No email on this Google account — use another account.');
      }
      await _resolveProfileRole();
      notifyListeners();
      return email;
    } on AuthException {
      rethrow;
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) {
        throw const AuthException('Sign-in cancelled.');
      }
      debugPrint('[Auth] Google sign-in failed: $e');
      throw AuthException(
          'Google sign-in failed (${e.toString().split('\n').first}). Check SHA-1 + network, then retry.');
    } catch (e) {
      debugPrint('[Auth] Google sign-in failed: $e');
      throw AuthException(
          'Google sign-in failed (${e.toString().split('\n').first}). Check SHA-1 + network, then retry.');
    }
  }

  /// Email/password sign-in. Needs no SHA-1 / OAuth client registration, so
  /// it works while a new applicationId is still unregistered in Firebase.
  Future<String> signInWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      if (Firebase.apps.isEmpty) {
        throw const AuthException(
            'Cloud not configured on this build — connect Firebase first.');
      }
      final cred = await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      _firebaseUser = cred.user;
      final signedIn = _firebaseUser?.email ?? '';
      if (signedIn.isEmpty) {
        throw const AuthException(
            'No email on this account — use another account.');
      }
      await _resolveProfileRole();
      notifyListeners();
      return signedIn;
    } on AuthException {
      rethrow;
    } on FirebaseAuthException catch (e) {
      throw AuthException(
          'Email sign-in failed (${e.message ?? e.code}). Check email + password, then retry.');
    } catch (e) {
      debugPrint('[Auth] Email sign-in failed: $e');
      throw AuthException(
          'Email sign-in failed (${e.toString().split('\n').first}). Check network, then retry.');
    }
  }

  /// Refuse a session that is not the Admin: sign it out and explain.
  /// Call after a successful sign-in.
  Future<void> requireAdmin() async {
    if (isAdmin) return;
    final email = sessionEmail ?? 'unknown email';
    await signOut();
    throw AuthException(
        'Not authorized ($email). This app is for the Hacienda Admin only — Guests book on the website.');
  }

  Future<void> signOut() async {
    final signingOutAdminUid = isAdmin ? _firebaseUser?.uid : null;
    try {
      await NotificationService().onBeforeSignOut(uid: signingOutAdminUid);
    } catch (_) {}
    try {
      await GoogleSignIn.instance.signOut();
    } catch (_) {}
    try {
      if (Firebase.apps.isNotEmpty) {
        await FirebaseAuth.instance.signOut();
      }
    } catch (_) {}
    await _profileSub?.cancel();
    _profileSub = null;
    _firebaseUser = null;
    _profileIsAdmin = false;
    _profileChecked = false;
    notifyListeners();
  }

  @override
  void dispose() {
    _profileSub?.cancel();
    _authSub?.cancel();
    super.dispose();
  }
}
