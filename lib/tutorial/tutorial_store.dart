/// Where the tour remembers completion.
///
/// The real store writes a flag to SharedPreferences; the memory store backs
/// tests and any host where the plugin is unavailable. Either way a failure
/// to persist costs nothing but a re-offered tour.
library;

import 'package:shared_preferences/shared_preferences.dart';

abstract class TutorialStore {
  Future<bool> loadDone();
  Future<void> saveDone(bool done);
}

class SharedPrefsTutorialStore implements TutorialStore {
  static const String _doneKey = 'hdl_admin_tutorial_done';

  Future<SharedPreferences?> _prefs() async {
    try {
      return await SharedPreferences.getInstance();
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> loadDone() async {
    final prefs = await _prefs();
    return prefs?.getBool(_doneKey) ?? false;
  }

  @override
  Future<void> saveDone(bool done) async {
    try {
      final prefs = await _prefs();
      await prefs?.setBool(_doneKey, done);
    } catch (_) {
      /* a missed write only means the tour offers itself once more */
    }
  }
}

class MemoryTutorialStore implements TutorialStore {
  bool _done = false;

  @override
  Future<bool> loadDone() async => _done;

  @override
  Future<void> saveDone(bool done) async {
    _done = done;
  }
}
