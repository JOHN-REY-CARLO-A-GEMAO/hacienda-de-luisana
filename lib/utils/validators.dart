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

  static DateTime _dateOnly(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

  /// Check-in must not be in the past (date granularity).
  static String? checkInDate(DateTime? checkIn, [DateTime? now]) {
    if (checkIn == null) return 'Please choose a check-in date';
    final today = _dateOnly(now ?? DateTime.now());
    if (_dateOnly(checkIn).isBefore(today)) {
      return 'Check-in cannot be in the past';
    }
    return null;
  }

  /// Check-out must be strictly after check-in.
  static String? checkOutDate(DateTime checkIn, DateTime? checkOut) {
    if (checkOut == null) return 'Please choose a check-out date';
    if (!_dateOnly(checkOut).isAfter(_dateOnly(checkIn))) {
      return 'Check-out must be after check-in';
    }
    return null;
  }

  /// Guests must be 1..12 and within the accommodation capacity.
  static String? guestCount(int guests, int capacity) {
    if (guests < 1) return 'At least 1 guest required';
    if (guests > 12) return 'Max 12 guests per booking';
    if (guests > capacity) {
      return 'This stay accommodates up to $capacity guests';
    }
    return null;
  }

  /// Combined trip validation for the Book tab. Returns first error or null.
  static const int minGuestAge = 10;

  /// Age from calendar dates — not a hard-coded birth year.
  static int? ageOn(DateTime birth, DateTime today) {
    final t = DateTime(today.year, today.month, today.day);
    final b = DateTime(birth.year, birth.month, birth.day);
    if (b.isAfter(t)) return null;
    var age = t.year - b.year;
    if (t.month < b.month || (t.month == b.month && t.day < b.day)) age -= 1;
    return age;
  }

  static String? birthdate(DateTime? value, [DateTime? now]) {
    if (value == null) return 'Please enter your date of birth';
    final today = now ?? DateTime.now();
    if (DateTime(value.year, value.month, value.day).isAfter(DateTime(today.year, today.month, today.day))) {
      return 'Date of birth cannot be in the future';
    }
    final age = ageOn(value, today);
    if (age == null) return 'Enter a valid calendar date';
    if (age < minGuestAge) {
      return 'You must be at least $minGuestAge years old to create an account';
    }
    return null;
  }

  static String explainPaymentVerify() {
    return 'Pending until an Admin matches the reference and amount on the valid list. '
        'Reject unknown, mismatched, or reused references. Record verifier and timestamp. '
        'Never auto-verify because OCR found a number.';
  }

  static String? trip({
    required DateTime checkIn,
    required DateTime checkOut,
    required int guests,
    required int capacity,
    DateTime? now,
  }) {
    final inErr = checkInDate(checkIn, now);
    if (inErr != null) return inErr;
    final outErr = checkOutDate(checkIn, checkOut);
    if (outErr != null) return outErr;
    return guestCount(guests, capacity);
  }
}
