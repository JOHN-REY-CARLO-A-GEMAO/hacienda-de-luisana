import 'package:intl/intl.dart';

class DateFormatter {
  static final DateFormat _shortDate = DateFormat('MMM dd, yyyy');
  static final DateFormat _timeWithSeconds = DateFormat('hh:mm:ss a');
  static final DateFormat _fullDateTime = DateFormat('MMM dd, yyyy · hh:mm:ss a');
  static final DateFormat _dayAndMonth = DateFormat('MMM dd');

  static String formatDate(DateTime dt) => _shortDate.format(dt);
  static String formatTime(DateTime dt) => _timeWithSeconds.format(dt);
  static String formatFull(DateTime dt) => _fullDateTime.format(dt);
  static String formatDayMonth(DateTime dt) => _dayAndMonth.format(dt);

  static String formatStayRange(DateTime checkIn, DateTime checkOut) {
    return '${_dayAndMonth.format(checkIn)} - ${_dayAndMonth.format(checkOut)}, ${checkOut.year}';
  }

  static String formatStayDuration(DateTime checkIn, DateTime checkOut) {
    final difference = checkOut.difference(checkIn).inDays;
    final nights = difference <= 0 ? 1 : difference;
    final days = nights + 1;
    return '$days Days · $nights Night${nights > 1 ? 's' : ''}';
  }

  static String timeAgo(DateTime dt) {
    final now = DateTime.now();
    final difference = now.difference(dt);

    if (difference.inSeconds < 45) {
      return 'just now';
    } else if (difference.inMinutes < 60) {
      return '${difference.inMinutes}m ago';
    } else if (difference.inHours < 24) {
      return '${difference.inHours}h ago';
    } else if (difference.inDays < 7) {
      return '${difference.inDays}d ago';
    } else {
      return _shortDate.format(dt);
    }
  }
}
