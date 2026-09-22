import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Lightweight user model for the demo guest portal.
class AppUser {
  final String name;
  final String email;
  final String phone;

  const AppUser({required this.name, required this.email, required this.phone});

  Map<String, dynamic> toJson() =>
      {'name': name, 'email': email, 'phone': phone};

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        name: json['name'] as String,
        email: json['email'] as String,
        phone: json['phone'] as String,
      );
}

class AuthException implements Exception {
  final String message;
  const AuthException(this.message);

  @override
  String toString() => message;
}

/// Demo-only local authentication.
///
/// - Accounts + session live in `SharedPreferences` (survives app restarts).
/// - Passwords are SHA-256 hashed — fine for a prototype, NOT real security.
/// - Simulated network latency so loading states are visible in demos.
///
/// Phase 2 swaps this for Firebase Auth (email/password) with the same
/// interface, so screens won't change.
class AuthStore extends ChangeNotifier {
  static const String _accountsKey = 'hdl_demo_accounts';
  static const String _sessionKey = 'hdl_demo_session';
  static const String _anonKey = 'hdl_anon_uid';

  /// Owner allowlist (mirrors firestore.rules ownerEmails/anakEmails).
  static const String kOwnerEmail = 'haciendadeluisiana@gmail.com';
  static const String kAnakEmail = 'gemaojohnreycarloarguilles@gmail.com';

  AppUser? _user;
  AppUser? get user => _user;
  bool get isAuthenticated => _user != null;

  /// P2 guest identity: Firebase anonymous uid when cloud is live,
  /// otherwise a persisted local UUID. Saved on every Booking as `uid`.
  String? _anonUid;
  String? get anonUid => _anonUid;

  // ---- Google session (owner APK gate, Android only) ----

  User? _firebaseUser;
  User? get firebaseUser => _firebaseUser;

  /// Google email on the Firebase token (null when anonymous/signed out).
  String? get sessionEmail => _firebaseUser?.email;

  bool get isSignedInGoogle =>
      _firebaseUser != null && (_firebaseUser?.email?.isNotEmpty ?? false);

  bool get isOwner =>
      _firebaseUser?.email?.toLowerCase() == kOwnerEmail.toLowerCase();

  bool get isAnak =>
      _firebaseUser?.email?.toLowerCase() == kAnakEmail.toLowerCase();

  /// Either allowlisted role may use the owner APK (anak = view-only).
  bool get isAuthorizedRole => isOwner || isAnak;

  /// Web OAuth client (type 3 in google-services.json). google_sign_in v7
  /// needs this to mint an ID token on Android — without it the account
  /// picker opens but sign-in dies right after picking an account.
  static const String kServerClientId =
      '648433185-oionh5246016o76d7hnr8fv2q35h4v9j.apps.googleusercontent.com';

  StreamSubscription<User?>? _authSub;
  // google_sign_in v7: singleton, initialize() once per app start.
  bool _googleInitialized = false;

  Future<void> _ensureGoogleInitialized() async {
    if (_googleInitialized) return;
    await GoogleSignIn.instance.initialize(serverClientId: kServerClientId);
    _googleInitialized = true;
  }

  AuthStore() {
    _restoreSession();
    ensureAnonUid();
    _listenFirebaseAuth();
  }

  Future<void> _restoreSession() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_sessionKey);
      if (raw != null) {
        _user = AppUser.fromJson(jsonDecode(raw) as Map<String, dynamic>);
        notifyListeners();
      }
    } catch (_) {
      // Corrupt session — treat as signed out.
    }
  }

  Future<Map<String, dynamic>> _readAccounts() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_accountsKey);
    if (raw == null) return {};
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }

  Future<void> _writeAccounts(Map<String, dynamic> accounts) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_accountsKey, jsonEncode(accounts));
  }

  Future<void> _saveSession(AppUser user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_sessionKey, jsonEncode(user.toJson()));
  }

  /// Creates an account and signs the guest in.
  Future<AppUser> register({
    required String name,
    required String email,
    required String phone,
    required String password,
  }) async {
    await Future.delayed(
        const Duration(milliseconds: 600)); // simulated network
    final key = email.trim().toLowerCase();
    final accounts = await _readAccounts();
    if (accounts.containsKey(key)) {
      throw const AuthException(
          'An account with this email already exists. Try logging in instead.');
    }
    accounts[key] = {
      'name': name.trim(),
      'phone': phone.trim(),
      'hash': _hash(password),
    };
    await _writeAccounts(accounts);
    final user = AppUser(name: name.trim(), email: key, phone: phone.trim());
    await _saveSession(user);
    _user = user;
    notifyListeners();
    return user;
  }

  /// Signs an existing guest in.
  Future<AppUser> login({
    required String email,
    required String password,
  }) async {
    await Future.delayed(
        const Duration(milliseconds: 600)); // simulated network
    final key = email.trim().toLowerCase();
    final accounts = await _readAccounts();
    if (!accounts.containsKey(key)) {
      throw const AuthException(
          'No account found with this email. Create one below.');
    }
    final record = accounts[key] as Map<String, dynamic>;
    if (record['hash'] != _hash(password)) {
      throw const AuthException('Incorrect password. Please try again.');
    }
    final user = AppUser(
      name: record['name'] as String,
      email: key,
      phone: record['phone'] as String,
    );
    await _saveSession(user);
    _user = user;
    notifyListeners();
    return user;
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionKey);
    _user = null;
    notifyListeners();
  }

  /// Ensures a stable anonymous uid exists (called at first launch).
  /// CloudBookings overwrites this key with the Firebase uid when online.
  Future<String> ensureAnonUid() async {
    if (_anonUid != null && _anonUid!.isNotEmpty) return _anonUid!;
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString(_anonKey);
      if (cached != null && cached.isNotEmpty) {
        _anonUid = cached;
        return cached;
      }
      final fresh =
          'local-${DateTime.now().millisecondsSinceEpoch}-${(cached ?? '').hashCode.abs()}${DateTime.now().microsecond}';
      await prefs.setString(_anonKey, fresh);
      _anonUid = fresh;
      notifyListeners();
      return fresh;
    } catch (_) {
      _anonUid ??= 'local-fallback-anon';
      return _anonUid!;
    }
  }

  /// Adopts the Firebase uid once cloud auth succeeds (same storage key).
  Future<void> adoptUid(String uid) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_anonKey, uid);
    } catch (_) {}
    _anonUid = uid;
    notifyListeners();
  }

  // ---- Google sign-in (anak default, Android only) ----
  // NOTE: google_sign_in v6 has no loginHint param — the "hint" is UX-level:
  // the login screen pre-fills kAnakEmail so the user picks that account.

  /// Subscribes to Firebase auth state (best-effort — never throws, so unit
  /// tests and local-only mode keep working without Firebase configured).
  void _listenFirebaseAuth() {
    try {
      if (Firebase.apps.isEmpty) return;
      _firebaseUser = FirebaseAuth.instance.currentUser;
      _authSub = FirebaseAuth.instance.authStateChanges().listen((u) {
        _firebaseUser = u;
        notifyListeners();
      });
    } catch (_) {
      // Local-only / test mode — Google gate stays signed-out.
    }
  }

  /// One-tap Google sign-in for the owner APK. Returns the signed-in email.
  /// Throws [AuthException] with a human message on cancel/failure.
  Future<String> signInAnak() async {
    try {
      if (Firebase.apps.isEmpty) {
        throw const AuthException(
            'Cloud not configured on this build — connect Firebase first.');
      }
      await _ensureGoogleInitialized();
      // v7: throws GoogleSignInException(code: canceled) on dismiss.
      final account = await GoogleSignIn.instance.authenticate();
      final googleAuth = account.authentication;
      // v7 only mints an idToken; Firebase accepts credential with idToken alone.
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

  /// Email/password sign-in for the owner APK. Unlike Google sign-in this
  /// needs no SHA-1 / OAuth client registration, so it works while the
  /// new applicationId is still unregistered in the Firebase console.
  /// Returns the signed-in email. Throws [AuthException] on failure.
  Future<String> signInOwnerEmail({
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

  /// Clears Google + Firebase session (local demo session untouched).
  Future<void> signOutGoogle() async {
    try {
      await GoogleSignIn.instance.signOut();
    } catch (_) {}
    try {
      if (Firebase.apps.isNotEmpty) {
        await FirebaseAuth.instance.signOut();
      }
    } catch (_) {}
    _firebaseUser = null;
    notifyListeners();
  }

  String _hash(String password) =>
      sha256.convert(utf8.encode('hacienda-de-luisana::$password')).toString();

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }
}
