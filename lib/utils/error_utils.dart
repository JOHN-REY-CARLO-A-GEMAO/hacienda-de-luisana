/// Maps technical exceptions and Firebase error messages to user-friendly strings.
class ErrorUtils {
  ErrorUtils._();

  static final RegExp _pluginCodePrefixRe = RegExp(r'^\[[\w-]+/[\w-]+\]');
  static final RegExp _technicalDetailRe = RegExp(
    r'firebase|firestore|platformexception|socketexception|grpc|projects/[a-z0-9_-]+/databases|'
    r'stacktrace|#0\s+|(?:\bfunctions|\bauth|\bstorage)/[a-z-]+|'
    r'\b(?:internal|not-found|invalid-argument|unimplemented|aborted|data-loss|errno)\b',
    caseSensitive: false,
  );

  static bool _looksTechnical(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty || trimmed.length >= 150) return true;
    return _pluginCodePrefixRe.hasMatch(trimmed) || _technicalDetailRe.hasMatch(trimmed);
  }

  static String toUserMessage(
    dynamic error, {
    String fallback = 'An unexpected error occurred. Please try again.',
  }) {
    if (error == null) return fallback;

    final raw = error.toString().trim();
    if (raw.isEmpty) return fallback;
    final errStr = raw.toLowerCase();

    if (errStr.contains('resource-exhausted') ||
        errStr.contains('too-many-requests') ||
        errStr.contains('quota-exceeded')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (errStr.contains('email-already-in-use')) {
      return 'An account with this email address already exists.';
    }
    if (errStr.contains('already-exists') || errStr.contains('document already exists')) {
      return 'Those dates or this record are no longer available. Please refresh and try again.';
    }
    if (errStr.contains('failed-precondition') || errStr.contains('failed precondition')) {
      return 'This action cannot be completed with the current details. Please refresh and try again.';
    }
    if (errStr.contains('permission-denied') || errStr.contains('permission denied')) {
      return 'You do not have permission to perform this action.';
    }
    if (errStr.contains('unauthenticated') ||
        errStr.contains('user-not-found') ||
        errStr.contains('wrong-password') ||
        errStr.contains('invalid-credential')) {
      return 'Invalid email or password. Please try again.';
    }
    if (errStr.contains('network') ||
        errStr.contains('socketexception') ||
        errStr.contains('unavailable') ||
        errStr.contains('deadline-exceeded')) {
      return 'Network connection issue. Please check your internet connection and try again.';
    }
    if (errStr.contains('invalid-email')) {
      return 'Please enter a valid email address.';
    }

    if (error is Exception || error is String) {
      final cleanMsg = raw.replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
      if (!_looksTechnical(cleanMsg)) {
        return cleanMsg;
      }
    }

    return fallback;
  }
}
