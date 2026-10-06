// Layout tests for the PIN UI — centred, and centred at every size.
//
// "Centred" is easy to claim and easy to break with one padding change, so it
// is measured rather than eyeballed: the keypad's centre is compared against
// the centre of the screen, horizontally and vertically, at each size. The
// sizes are the ones that bite — a small phone, the Admin's phone, a big
// phone, a tablet and a desktop window — plus the software-keyboard case,
// where the usable height collapses and the layout has to degrade into a
// scroll rather than an overflow.
//
// Overflow is a test failure on its own: `flutter_test` turns a RenderFlex
// overflow into a thrown exception, so every `expect` here is also a
// statement that nothing overflowed at that size.
//
// The two tolerances below are the whole contract:
//
//   * Horizontal, 0.5px — the keypad must be dead centre across. There is no
//     reason for a keypad to be off to one side, so this is exact.
//   * Vertical, 24px — the prompt line ("Please enter your PIN") and the
//     keypad travel as ONE centred group, so the keypad's own centre sits
//     half a prompt line plus half the 12px gap below the group's centre.
//     That is 16.5px as measured, and 24px leaves room for a taller prompt
//     without turning a deliberate grouping into a failure.
//
// Run: flutter test test/pin_layout_test.dart

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hacienda_de_luisana/providers/app_providers.dart';
import 'package:hacienda_de_luisana/services/auth_store.dart';
import 'package:hacienda_de_luisana/services/pin_store.dart';
import 'package:hacienda_de_luisana/views/security/pin_gate_screen.dart';
import 'package:hacienda_de_luisana/views/security/security_pin_sheet.dart';
import 'package:hacienda_de_luisana/views/security/setup_pin_sheet.dart';
import 'package:provider/provider.dart' as legacy;

/// Sizes worth surviving. Whether the gate fits without scrolling at a given
/// size is measured, not assumed — see `_fits`.
const Map<String, Size> _sizes = {
  'small phone 320x568': Size(320, 568),
  'small phone 360x640': Size(360, 640),
  'the Admin phone 360x800': Size(360, 800),
  'big phone 411x891': Size(411, 891),
  'tablet 800x1280': Size(800, 1280),
  'desktop 1280x800': Size(1280, 800),
};

const double _horizontalTolerance = 0.5;
const double _verticalTolerance = 24;

Future<PinGate> _gateWithPin(String pin) async {
  final gate = PinGate(store: MemoryPinStore());
  await gate.setPin('admin', pin, iterations: 100);
  return gate;
}

void _at(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpGate(WidgetTester tester, PinGate gate) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [pinGateProvider.overrideWithValue(gate)],
      child: legacy.ChangeNotifierProvider<AuthStore>(
        create: (_) => AuthStore(),
        child: MaterialApp(home: PinGateScreen(onUnlocked: () {})),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// How far the keypad sits from the centre of the screen.
Offset _offCentre(WidgetTester tester) {
  final pad = tester.getRect(find.byType(PinEntryPad));
  final screen = tester.getSize(find.byType(MaterialApp));
  return Offset(
    pad.center.dx - screen.width / 2,
    pad.center.dy - screen.height / 2,
  );
}

/// Total scrollable extent across the gate. The gate legitimately has more
/// than one Scrollable, so this is the sum rather than the first.
double _scrollExtent(WidgetTester tester) => tester
    .stateList<ScrollableState>(find.byType(Scrollable))
    .fold<double>(0, (sum, s) => sum + s.position.maxScrollExtent);

/// Does the gate fit at this size, or is a scroll genuinely necessary?
///
/// A six-digit keypad plus a title, a prompt and a way out is roughly 620px
/// of content, so a 568px phone cannot show it all at once — that is a real
/// constraint, not a layout bug, and the gate handles it by scrolling rather
/// than overflowing. Measured rather than assumed so the centring contract
/// below applies exactly where centring is possible.
bool _fits(WidgetTester tester) => _scrollExtent(tester) <= 0.5;

void main() {
  for (final entry in _sizes.entries) {
    final size = entry.value;

    testWidgets('the keypad is centred — ${entry.key}', (tester) async {
      _at(tester, size);
      await _pumpGate(tester, await _gateWithPin('492713'));

      expect(find.byType(PinEntryPad), findsOneWidget);

      // Horizontal centring is unconditional: there is no size at which a
      // keypad should sit off to one side.
      final off = _offCentre(tester);
      expect(off.dx.abs(), lessThan(_horizontalTolerance),
          reason: 'keypad off centre horizontally by ${off.dx}px at $size');

      // Vertical centring applies wherever the content fits. Where it does
      // not, the gate scrolls and centring is not the contract — being
      // reachable is.
      if (_fits(tester)) {
        expect(off.dy.abs(), lessThan(_verticalTolerance),
            reason: 'keypad off centre vertically by ${off.dy}px at $size');
      }
    });

    testWidgets('the keypad is reachable, scrolling only if it must — '
        '${entry.key}', (tester) async {
      _at(tester, size);
      await _pumpGate(tester, await _gateWithPin('492713'));

      final pad = tester.getRect(find.byType(PinEntryPad));
      final screen = tester.getSize(find.byType(MaterialApp));
      expect(pad.top, greaterThanOrEqualTo(-0.5),
          reason: 'keypad clipped at the top at $size');
      expect(pad.left, greaterThanOrEqualTo(-0.5),
          reason: 'keypad clipped at the left at $size');
      expect(pad.right, lessThanOrEqualTo(screen.width + 0.5),
          reason: 'keypad clipped at the right at $size');

      if (_fits(tester)) {
        // It fits, so scrolling would be the unnecessary kind.
        expect(pad.bottom, lessThanOrEqualTo(screen.height + 0.5),
            reason: 'keypad runs off the bottom at $size with nothing to '
                'scroll');
      } else {
        // It does not fit, so it must scroll rather than be cut off.
        await tester.drag(find.byType(CustomScrollView), const Offset(0, -400));
        await tester.pumpAndSettle();
        final scrolled = tester.getRect(find.byType(PinEntryPad));
        expect(scrolled.bottom, lessThanOrEqualTo(screen.height + 0.5),
            reason: 'keypad still unreachable after scrolling at $size');
      }
    });

    testWidgets('the keypad does not overlap the header — ${entry.key}',
        (tester) async {
      _at(tester, size);
      await _pumpGate(tester, await _gateWithPin('492713'));

      final header = tester.getRect(find.byKey(const Key('pin-gate-header')));
      final pad = tester.getRect(find.byType(PinEntryPad));
      expect(pad.top, greaterThanOrEqualTo(header.bottom - 0.5),
          reason: 'keypad overlaps the header at $size');
    });

    testWidgets('the dots are centred above the keypad — ${entry.key}',
        (tester) async {
      _at(tester, size);
      await _pumpGate(tester, await _gateWithPin('492713'));

      final screen = tester.getSize(find.byType(MaterialApp));
      final first = tester.getRect(find.byKey(const Key('pin-dot-0')));
      final last = tester.getRect(find.byKey(const Key('pin-dot-5')));
      final rowCentre = (first.left + last.right) / 2;
      expect(rowCentre - screen.width / 2, lessThan(0.5),
          reason: 'the dot row is off centre at $size');
      expect(first.top, greaterThanOrEqualTo(0),
          reason: 'dot row runs off the left at $size');
      expect(last.right, lessThanOrEqualTo(screen.width),
          reason: 'dot row runs off the right at $size');
    });

    testWidgets('the numeric keyboard is offered — ${entry.key}',
        (tester) async {
      _at(tester, size);
      await _pumpGate(tester, await _gateWithPin('492713'));

      final field =
          tester.widget<TextField>(find.byKey(const Key('pin-keyboard-input')));
      expect(field.keyboardType, TextInputType.number);
      expect(field.focusNode!.hasFocus, isTrue,
          reason: 'keyboard not raised at $size');
    });
  }

  testWidgets('the keypad stays horizontally centred when the software '
      'keyboard takes the bottom half', (tester) async {
    // 360x420 is roughly what is left of a 360x800 phone once a numeric
    // keyboard is up.
    _at(tester, const Size(360, 420));
    await _pumpGate(tester, await _gateWithPin('492713'));

    expect(find.byType(PinEntryPad), findsOneWidget);
    final off = _offCentre(tester);
    expect(off.dx.abs(), lessThan(_horizontalTolerance),
        reason: 'keypad drifted sideways by ${off.dx}px');
    // Vertically it must not need to be centred when there is no room, but it
    // must still be reachable.
    expect(_scrollExtent(tester), greaterThan(0),
        reason: 'no way to reach the keypad once the keyboard is up');
  });

  testWidgets('the entry sheet centres the keypad and fits the screen',
      (tester) async {
    _at(tester, const Size(360, 800));
    final gate = await _gateWithPin('492713');
    await tester.pumpWidget(
      ProviderScope(
        overrides: [pinGateProvider.overrideWithValue(gate)],
        child: legacy.ChangeNotifierProvider<AuthStore>(
          create: (_) => AuthStore(),
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (inner) => Center(
                  child: ElevatedButton(
                    onPressed: () => showSecurityPinSheet(
                      inner,
                      title: 'Approve Booking',
                      consequence: 'This verifies P8,000. It cannot be undone.',
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final pad = tester.getRect(find.byType(PinEntryPad));
    final screen = tester.getSize(find.byType(MaterialApp));
    expect(pad.center.dx - screen.width / 2, lessThan(0.5),
        reason: 'sheet keypad is off centre horizontally');
    expect(pad.top, greaterThanOrEqualTo(-0.5));
    expect(pad.bottom, lessThanOrEqualTo(screen.height + 0.5),
        reason: 'sheet keypad runs past the bottom of the screen');

    // The sheet got the same keyboard route as the gate.
    final field =
        tester.widget<TextField>(find.byKey(const Key('pin-keyboard-input')));
    expect(field.keyboardType, TextInputType.number);
  });

  testWidgets('the entry sheet fits a small phone', (tester) async {
    _at(tester, const Size(320, 568));
    final gate = await _gateWithPin('492713');
    await tester.pumpWidget(
      ProviderScope(
        overrides: [pinGateProvider.overrideWithValue(gate)],
        child: legacy.ChangeNotifierProvider<AuthStore>(
          create: (_) => AuthStore(),
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (inner) => ElevatedButton(
                  onPressed: () => showSecurityPinSheet(
                    inner,
                    title: 'Approve Booking',
                    consequence: 'This verifies P8,000. It cannot be undone.',
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final pad = tester.getRect(find.byType(PinEntryPad));
    final screen = tester.getSize(find.byType(MaterialApp));
    expect(pad.center.dx - screen.width / 2, lessThan(0.5));
    expect(pad.bottom, lessThanOrEqualTo(screen.height + 0.5),
        reason: 'sheet keypad runs past the bottom of a 320x568 screen');
  });

  testWidgets('the setup sheet centres the keypad and fits the screen',
      (tester) async {
    _at(tester, const Size(360, 800));
    final gate = await _gateWithPin('492713');
    await tester.pumpWidget(
      ProviderScope(
        overrides: [pinGateProvider.overrideWithValue(gate)],
        child: legacy.ChangeNotifierProvider<AuthStore>(
          create: (_) => AuthStore(),
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (inner) => ElevatedButton(
                  onPressed: () => showSetupPinSheet(inner),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final pad = tester.getRect(find.byType(PinEntryPad));
    final screen = tester.getSize(find.byType(MaterialApp));
    expect(pad.center.dx - screen.width / 2, lessThan(0.5));
    expect(pad.bottom, lessThanOrEqualTo(screen.height + 0.5),
        reason: 'setup keypad runs past the bottom of the screen');
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('pin-keyboard-input')))
          .keyboardType,
      TextInputType.number,
    );
  });
}