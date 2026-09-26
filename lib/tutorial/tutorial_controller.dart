/// The interactive Admin tour — controller.
///
/// Runs the script (tutorial_steps.dart) against the living app: switches the
/// shell's tabs when a step moves rooms, pops pushed routes between rooms,
/// floats the spotlight overlay above everything (detail screens and modal
/// sheets included) through the root navigator's overlay, and listens for the
/// gestures the app itself reports through the [TourBus]. The tour never
/// wraps or replaces the control it highlights — the control behaves exactly
/// as it does on any other day.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'tutorial_keys.dart';
import 'tutorial_overlay.dart';
import 'tutorial_step.dart';
import 'tutorial_steps.dart';
import 'tutorial_store.dart';

final tutorialControllerProvider =
    ChangeNotifierProvider<TutorialController>((ref) => TutorialController());

/// How the app tells the tour "the Admin just did the thing". One static call
/// from the control's own handler keeps the wiring to a single line per
/// control and keeps every other file free of tour imports beyond the Bus.
class TourBus {
  TourBus._();

  static TutorialController? _controller;

  static void attach(TutorialController controller) => _controller = controller;
  static void detach(TutorialController controller) {
    if (identical(_controller, controller)) _controller = null;
  }

  /// A navigation-level event (`more-opened`, `open-thread`, `filter-changed`…).
  static void event(String name) => _controller?.reportEvent(name);

  /// The shell switched to [index].
  static void tab(int index) => _controller?.reportTab(index);

  /// A watched input's text changed; [value] is its current text.
  static void input(String id, String value) => _controller?.reportInput(id, value);
}

class TutorialController extends ChangeNotifier {
  TutorialController({TutorialStore? store, List<TutorialStep>? steps})
      : _store = store ?? SharedPrefsTutorialStore(),
        steps = steps ?? adminTutorialSteps {
    TourBus.attach(this);
    TourKeys.onRouteChanged = _onRouteChanged;
  }

  final TutorialStore _store;
  final List<TutorialStep> steps;

  int _index = 0;
  bool _running = false;
  bool _done = false;
  bool _missing = false;

  OverlayEntry? _overlay;
  Timer? _advanceTimer;
  Timer? _missingTimer;

  /// The shell's tab switcher, attached in MainShellScreen's initState.
  void Function(int index)? _navigateTab;

  /// The last tab the shell reported — always kept fresh, running or not, so
  /// Back onto an already-satisfied tab step resolves immediately.
  int? _lastTab;

  int get index => _index;
  bool get running => _running;
  bool get done => _done;
  bool get missing => _missing;
  int get total => steps.length;
  TutorialStep get current => steps[_index.clamp(0, steps.length - 1).toInt()];
  bool get isLast => _index >= steps.length - 1;

  /// True while the current step waits for the Admin to use the highlighted
  /// control (rather than offering a Continue button).
  bool get awaiting =>
      _running && !_missing && current.advance != TutorialAdvance.none;

  void attachTabNavigator(void Function(int index) navigate) =>
      _navigateTab = navigate;

  void detachTabNavigator(void Function(int index) navigate) {
    if (identical(_navigateTab, navigate)) _navigateTab = null;
  }

  /// Called by the shell once it is on screen: shows the tour to a first-timer.
  Future<void> maybeOfferTutorial() async {
    if (_running) return;
    _done = await _store.loadDone();
    if (!_done) start();
    notifyListeners();
  }

  void start({int at = 0}) {
    _advanceTimer?.cancel();
    _index = at.clamp(0, steps.length - 1).toInt();
    _missing = false;
    _running = true;
    _ensureOverlay();
    _applyStep(current);
    notifyListeners();
  }

  void next() {
    if (isLast) {
      finish();
      return;
    }
    _goTo(_index + 1);
  }

  void back() {
    if (_index > 0) _goTo(_index - 1);
  }

  /// Finish early and remember the tour as done.
  void skip() => finish();

  /// Close without remembering — the tour offers itself again next launch.
  void exit() {
    _running = false;
    _advanceTimer?.cancel();
    _removeOverlay();
    notifyListeners();
  }

  void finish() {
    _running = false;
    _done = true;
    _advanceTimer?.cancel();
    _removeOverlay();
    unawaited(_store.saveDone(true));
    notifyListeners();
  }

  /// Replay from the top (More → "Replay the guided tour" calls this).
  void replay() => start();

  void _goTo(int next) {
    _advanceTimer?.cancel();
    _index = next;
    _missing = false;
    _applyStep(current);
    notifyListeners();
  }

  /// Move the app to the room the step teaches in.
  void _applyStep(TutorialStep step) {
    // Pressing Back onto a tab step whose tab is already showing must not
    // strand the Admin waiting for a tap that already happened. Evaluated
    // synchronously so it behaves the same under unit tests.
    if (step.advance == TutorialAdvance.tab &&
        step.tabIndex != null &&
        _lastTab == step.tabIndex) {
      _advanceSoon(from: _index);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_running) return;
      if (step.popToRoot) {
        TourKeys.rootNavigator.currentState?.popUntil((route) => route.isFirst);
      }
      if (step.ensureTab != null) _navigateTab?.call(step.ensureTab!);
      _armMissingWatch(step);
      _scrollTargetIntoView(step, attempts: 6);
    });
  }

  /* ---------------- Missing-target degradation ---------------- */

  void _armMissingWatch(TutorialStep step) {
    _missingTimer?.cancel();
    _missing = false;
    if (step.targetKey == null) return;
    _missingTimer = Timer(const Duration(milliseconds: 2600), () {
      if (!_running) return;
      if (targetRect(step.targetKey) == null) {
        _missing = true;
        notifyListeners();
      }
    });
  }

  /* ---------------- Interaction reports ---------------- */

  void reportTab(int tab) {
    _lastTab = tab;
    if (!_running || _missing) return;
    final step = current;
    if (step.advance == TutorialAdvance.tab && step.tabIndex == tab) {
      _advanceSoon(from: _index);
    }
  }

  void reportEvent(String name) {
    if (!_running || _missing) return;
    final step = current;
    final matches = (step.advance == TutorialAdvance.event ||
            step.advance == TutorialAdvance.tap) &&
        step.eventName == name;
    if (matches) _advanceSoon(from: _index);
  }

  void reportInput(String id, String value) {
    if (!_running || _missing) return;
    final step = current;
    if (step.advance == TutorialAdvance.input &&
        step.eventName == id &&
        value.trim().isNotEmpty) {
      _advanceSoon(from: _index);
    }
  }

  /// Small delay so the gesture's own effect (tab switch, pushed screen)
  /// lands first; [from] keeps a stale report from skipping a second step.
  void _advanceSoon({required int from}) {
    _advanceTimer?.cancel();
    _advanceTimer = Timer(const Duration(milliseconds: 350), () {
      if (_running && _index == from) next();
    });
  }

  /* ---------------- Overlay & measuring ---------------- */

  void _ensureOverlay() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_running) return;
      final overlay = TourKeys.rootNavigator.currentState?.overlay;
      if (overlay == null) return;
      _removeOverlay();
      _overlay = OverlayEntry(builder: (_) => TutorialOverlay(controller: this));
      overlay.insert(_overlay!);
    });
  }

  void _removeOverlay() {
    try {
      _overlay?.remove();
    } catch (_) {
      /* already removed */
    }
    _overlay = null;
  }

  /// Routes pushed after the tour started (the More sheet, a Booking detail)
  /// would otherwise cover the overlay — re-float it.
  void _onRouteChanged() {
    if (!_running) return;
    _ensureOverlay();
    _scrollTargetIntoView(current, attempts: 4);
    notifyListeners();
  }

  void _scrollTargetIntoView(TutorialStep step, {required int attempts}) {
    if (step.targetKey == null) return;
    final context = TourKeys.byId[step.targetKey]?.currentContext;
    if (context != null) {
      try {
        Scrollable.ensureVisible(
          context,
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeOut,
          alignment: 0.5,
        );
        return;
      } catch (_) {
        /* no scrollable ancestor — fine */
      }
    }
    if (attempts <= 0) return;
    Timer(const Duration(milliseconds: 300), () {
      if (_running) _scrollTargetIntoView(step, attempts: attempts - 1);
    });
  }

  /// The highlighted control's rect in global coordinates (padded), or null.
  Rect? targetRect(String? keyId) {
    if (keyId == null) return null;
    final context = TourKeys.byId[keyId]?.currentContext;
    if (context == null) return null;
    final renderObject = context.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.attached) return null;
    try {
      final position = renderObject.localToGlobal(Offset.zero);
      final size = renderObject.hasSize ? renderObject.size : Size.zero;
      if (size.width < 2 || size.height < 2) return null;
      const pad = 6.0;
      final left = position.dx - pad;
      final top = position.dy - pad;
      return Rect.fromLTRB(
        left < 0 ? 0 : left,
        top < 0 ? 0 : top,
        position.dx + size.width + pad,
        position.dy + size.height + pad,
      );
    } catch (_) {
      return null;
    }
  }

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _missingTimer?.cancel();
    _removeOverlay();
    TourBus.detach(this);
    TourKeys.onRouteChanged = null;
    super.dispose();
  }
}
