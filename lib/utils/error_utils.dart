/// Maps technical exceptions and Firebase error messages to user-friendly strings.
class ErrorUtils {
  ErrorUtils._();

  static String toUserMessage(dynamic error, {String fallback = 'An unexpected error occurred. Please try again.'}) {
    if (error == null) return fallback;

    final errStr = error.toString().toLowerCase();

    if (errStr.contains('permission-denied') || errStr.contains('permission denied')) {
      return 'You do not have permission to perform this action.';
    }
    if (errStr.contains('unauthenticated') || errStr.contains('user-not-found') || errStr.contains('wrong-password')) {
      return 'Invalid email or password. Please try again.';
    }
    if (errStr.contains('network') || errStr.contains('socketexception') || errStr.contains('unavailable')) {
      return 'Network connection issue. Please check your internet connection and try again.';
    }
    if (errStr.contains('too-many-requests')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (errStr.contains('email-already-in-use')) {
      return 'An account with this email address already exists.';
    }
    if (errStr.contains('invalid-email')) {
      return 'Please enter a valid email address.';
    }

    if (error is Exception) {
      final msg = error.toString();
      // Remove Exception prefix if present
      final cleanMsg = msg.replaceFirst(RegExp(r'^Exception:\s*'), '');
      if (!cleanMsg.contains('FirebaseError') && !cleanMsg.contains('firebase') && cleanMsg.length < 150) {
        return cleanMsg;
      }
    }

    return fallback;
  }
}
