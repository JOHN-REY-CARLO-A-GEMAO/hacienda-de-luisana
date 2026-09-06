/// Lightweight input validators for the demo.
/// Deliberately "good enough" — format checks only, no backend verification.
class Validators {
  Validators._();

  static final RegExp _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
  // PH mobile: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes stripped first)
  static final RegExp _phPhoneRe = RegExp(r'^(\+63|0)9\d{9}$');
  static final RegExp _nameRe = RegExp(r"^[A-Za-zÀ-ÖØ-öø-ÿ' .\-]+$");

  static String? name(String? value) {
    final v = (value ?? '').trim();
    if (v.isEmpty) return 'Please enter your full name';
    if (v.length < 2) return 'Name looks too short';
    if (!_nameRe.hasMatch(v)) return 'Letters, spaces, hyphens and periods only';
    return null;
  }

  static String? email(String? value) {
    final v = (value ?? '').trim();
    if (v.isEmpty) return 'Please enter your email';
    if (!_emailRe.hasMatch(v)) return 'Enter a valid email (e.g. juan@gmail.com)';
    return null;
  }

  static String? phone(String? value) {
    final v = (value ?? '').replaceAll(RegExp(r'[\s\-()]'), '');
    if (v.isEmpty) return 'Please enter your mobile number';
    if (!_phPhoneRe.hasMatch(v)) {
      return 'Use PH format: 09XX XXX XXXX or +63 9XX XXX XXXX';
    }
    return null;
  }

  static String? password(String? value) {
    final v = value ?? '';
    if (v.isEmpty) return 'Please enter a password';
    if (v.length < 6) return 'At least 6 characters';
    return null;
  }

  static String? passwordConfirm(String? value, String original) {
    if ((value ?? '') != original) return 'Passwords do not match';
    return null;
  }

  /// Normalizes a PH mobile number to +639XXXXXXXXX for storage.
  static String normalizePhone(String value) {
    final v = value.replaceAll(RegExp(r'[\s\-()]'), '');
    if (v.startsWith('0')) return '+63${v.substring(1)}';
    return v;
  }
}
