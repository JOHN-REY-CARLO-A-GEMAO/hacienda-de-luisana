// Unit tests for the Admin guided tour's state machine
// (lib/tutorial/tutorial_controller.dart). Pure Dart logic — the overlay and
// the GlobalKey anchors are widgets, but what a step does when the Admin taps,
// types, switches tabs, skips or replays is plain state and is asserted here.
//
// Run: flutter test test/tutorial_controller_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/tutorial/tutorial_controller.dart';
import 'package:hacienda_de_luisana/tutorial/tutorial_step.dart';
import 'package:hacienda_de_luisana/tutorial/tutorial_steps.dart';
import 'package:hacienda_de_luisana/tutorial/tutorial_store.dart';

/// A small deterministic script: enough of the real shapes (tab-driven,
/// event-driven, input-driven, informational) without the app's screens.
const script = [
  TutorialStep(
    id: 'welcome',
    title: 'Welcome',
    body: 'Start here.',
    continueLabel: 'Start the tour',
  ),
  TutorialStep(
    id: 'go-bookings',
    title: 'Open Bookings',
    body: 'The queue.',
    advance: TutorialAdvance.tab,
    tabIndex: 1,
    actionHint: 'Tap Bookings',
  ),
  TutorialStep(
    id: 'filter',
    title: 'Filter',
    body: 'Triage.',
    advance: TutorialAdvance.event,
    eventName: 'filter-changed',
    actionHint: 'Tap a chip',
  ),
  TutorialStep(
    id: 'search',
    title: 'Search',
    body: 'Find it.',
    advance: TutorialAdvance.input,
    eventName: 'search-typed',
    actionHint: 'Type',
  ),
  TutorialStep(
    id: 'actions',
    title: 'Actions',
    body: 'Explain only.',
  ),
  TutorialStep(
    id: 'done',
    title: 'Done',
    body: 'Finish.',
    continueLabel: 'Finish',
  ),
];

TutorialController controller({TutorialStore? store}) =>
    TutorialController(store: store ?? MemoryTutorialStore(), steps: script);

void main() {
  // The controller schedules post-frame work (scrolling anchors into view);
  // the binding makes those harmless no-ops in unit tests.
  TestWidgetsFlutterBinding.ensureInitialized();

  group('the tour state machine', () {
    test('offers itself until completed, then never again', () async {
      final shared = MemoryTutorialStore();
      final first = controller(store: shared);
      await first.maybeOfferTutorial();
      expect(first.running, isTrue, reason: 'first launch starts the tour');
      expect(first.index, 0);
      expect(first.done, isFalse);

      first.skip();
      expect(first.running, isFalse);
      expect(first.done, isTrue);
      expect(await shared.loadDone(), isTrue);

      final second = controller(store: shared);
      await second.maybeOfferTutorial();
      expect(second.running, isFalse, reason: 'a returning Admin is left alone');
      expect(second.done, isTrue);
    });

    test('exit closes without remembering; the next launch offers again', () async {
      final shared = MemoryTutorialStore();
      final c = controller(store: shared);
      await c.maybeOfferTutorial();
      c.exit();
      expect(c.running, isFalse);
      expect(c.done, isFalse);
      expect(await shared.loadDone(), isFalse);

      final again = controller(store: shared);
      await again.maybeOfferTutorial();
      expect(again.running, isTrue);
    });

    test('informational steps advance on next(); interactive steps await gestures', () {
      final c = controller();
      c.start();
      expect(c.awaiting, isFalse, reason: 'the welcome card is a read');
      c.next(); // welcome → go-bookings
      expect(c.current.id, 'go-bookings');
      expect(c.awaiting, isTrue, reason: 'a tab step waits for the gesture');

      // next() is the Skip-this-step escape hatch, not a free pass.
      c.next();
      expect(c.current.id, 'filter');
    });

    test('advances on the reported tab the step awaits, and only that one', () async {
      final c = controller();
      c.start(at: 1);
      c.reportTab(2); // wrong tab: ignored
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(c.current.id, 'go-bookings');

      c.reportTab(1); // the awaited one
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(c.current.id, 'filter');
    });

    test('advances on the named event, and on typed input', () async {
      final c = controller();
      c.start(at: 2);
      c.reportEvent('something-else');
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(c.current.id, 'filter');

      c.reportEvent('filter-changed');
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(c.current.id, 'search');

      c.reportInput('search-typed', '   ');
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(c.current.id, 'search', reason: 'whitespace is not input');

      c.reportInput('search-typed', 'maria');
      await Future<void>.delayed(const Duration(milliseconds: 400));
      expect(c.current.id, 'actions');
    });

    test('Back onto an already-arrived tab step resolves immediately', () async {
      final c = controller();
      // The shell reports the live tab even before the tour starts.
      c.reportTab(1);
      c.start(at: 1); // 'go-bookings' awaits tab 1, already showing
      await Future<void>.delayed(const Duration(milliseconds: 450));
      expect(c.current.id, 'filter', reason: 'already there counts as done');
    });

    test('a stale report cannot skip two steps', () async {
      final c = controller();
      c.start(at: 2);
      // Two reports before the 350 ms advance fires: the second one belongs
      // to the *old* step and must not skip past 'search' too.
      c.reportEvent('filter-changed');
      c.reportEvent('filter-changed');
      await Future<void>.delayed(const Duration(milliseconds: 500));
      expect(c.current.id, 'search');
    });

    test('reports do nothing while the tour is not running', () {
      final c = controller();
      c.reportTab(1);
      c.reportEvent('filter-changed');
      c.reportInput('search-typed', 'x');
      expect(c.running, isFalse);
      expect(c.index, 0);
    });

    test('back retraces steps; replay restarts from the top', () async {
      final c = controller();
      c.start(at: 4);
      c.back();
      expect(c.current.id, 'search');
      await c.maybeOfferTutorial(); // still running: no-op
      expect(c.running, isTrue);
      expect(c.current.id, 'search');

      c.finish();
      expect(c.done, isTrue);
      c.replay();
      expect(c.running, isTrue);
      expect(c.index, 0);
      expect(c.current.id, 'welcome');
    });

    test('the Admin-side script stays interactive but never irreversible', () {
      // Every interactive step must say what gesture it waits for, and must
      // name the event, tab, field or control it listens to.
      for (final s in adminTutorialSteps) {
        if (s.advance == TutorialAdvance.none) continue;
        expect(s.actionHint, isNotNull, reason: '${s.id} needs an actionHint');
        switch (s.advance) {
          case TutorialAdvance.event:
          case TutorialAdvance.input:
            expect(s.eventName, isNotNull, reason: '${s.id} listens to an event name');
          case TutorialAdvance.tab:
            expect(s.tabIndex, isNotNull, reason: '${s.id} listens to a tab');
          case TutorialAdvance.tap:
          case TutorialAdvance.none:
            break;
        }
      }
      // The tour is hands-on, not slides: most steps wait for a real gesture.
      final interactive = adminTutorialSteps.where((s) => s.advance != TutorialAdvance.none);
      expect(interactive.length, greaterThanOrEqualTo(6));
      // Irreversible features stay explanations: approve/reject/publish/send
      // are never something the tour waits on.
      for (final s in adminTutorialSteps) {
        expect(
          ['approve', 'reject', 'publish', 'send-reply'].contains(s.eventName),
          isFalse,
          reason: '${s.id} must not gate on an irreversible action',
        );
      }
    });
  });
}
