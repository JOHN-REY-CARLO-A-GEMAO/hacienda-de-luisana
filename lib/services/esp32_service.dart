import 'dart:async';

class Esp32Service {
  bool _connected = true;
  bool _unlocked = false;
  Timer? _relockTimer;
  final _connectionController = StreamController<bool>.broadcast();
  Timer? _connectionStreamTimer;

  Esp32Service() {
    // Periodically pulse connection status every 8 seconds
    _connectionStreamTimer = Timer.periodic(const Duration(seconds: 8), (timer) {
      // Toggle brief heartbeat
      _connectionController.add(_connected);
    });
  }

  bool get connected => _connected;
  bool get unlocked => _unlocked;

  Stream<bool> get connectionStream => _connectionController.stream;

  Future<bool> unlock() async {
    // 800ms delay to simulate hardware bluetooth/wifi handshake with ESP32 lock
    await Future.delayed(const Duration(milliseconds: 800));
    _unlocked = true;

    // Auto re-lock after 5 seconds
    _relockTimer?.cancel();
    _relockTimer = Timer(const Duration(seconds: 5), () {
      _unlocked = false;
    });

    return true;
  }

  void forceLock() {
    _relockTimer?.cancel();
    _unlocked = false;
  }

  void dispose() {
    _relockTimer?.cancel();
    _connectionStreamTimer?.cancel();
    _connectionController.close();
  }
}
