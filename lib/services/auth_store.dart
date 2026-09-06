import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Lightweight user model for the demo guest portal.
class AppUser {
  final String name;
  final String email;
  final String phone;

  const AppUser({required this.name, required this.email, required this.phone});

  Map<String, dynamic> toJson() => {'name': name, 'email': email, 'phone': phone};

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

  AppUser? _user;
  AppUser? get user => _user;
  bool get isAuthenticated => _user != null;

  AuthStore() {
    _restoreSession();
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
    await Future.delayed(const Duration(milliseconds: 600)); // simulated network
    final key = email.trim().toLowerCase();
    final accounts = await _readAccounts();
    if (accounts.containsKey(key)) {
      throw const AuthException('An account with this email already exists. Try logging in instead.');
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
    await Future.delayed(const Duration(milliseconds: 600)); // simulated network
    final key = email.trim().toLowerCase();
    final accounts = await _readAccounts();
    if (!accounts.containsKey(key)) {
      throw const AuthException('No account found with this email. Create one below.');
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

  String _hash(String password) =>
      sha256.convert(utf8.encode('hacienda-de-luisana::$password')).toString();
}
