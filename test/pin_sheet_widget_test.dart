// Widget test for the Security PIN sheet — the repo's first. The other
// suites are pure logic; this one exists because the keypad is the gate:
// a wrong-entry flash that never clears, or a lockout whose keypad still
// accepts digits, would be worse than no gate at all (ADR-0015).
//
// Run: flutter test test/pin_sheet_widget_test.dart

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hacienda_de_luisana/core/constants/app_constants.dart';
import 'package:hacienda_de_luisana/providers/app_providers.dart';
import 'package:hacienda_de_luisana/services/auth_store.dart';
import 'package:hacienda_de_luisana/services/pin_store.dart';
import 'package:hacienda_de_luisana/views/security/security_pin_sheet.dart';
import 'package:provider/provider.dart' as legacy;

Future<PinGate> _gateWithPin(String pin) async {
  final gate = PinGate(store: MemoryPinStore());
  // The sheet resolves its uid from a signed-out AuthStore in tests, which
  // is the 'admin' fallback — the same key the gate verifies under.
  await gate.setPin('admin', pin, iterations: 100);
  return gate;
}

/// Pumps the app with the PIN sheet open on top, and returns the future the
/// sheet resolves with. The AuthStore provider is the one the app's own root
/// supplies (`main.dart`) — the sheet reads the session uid through it.
/// The sheet's pending future, handed over un-awaited.
///
/// It has to travel inside a wrapper rather than as the return value: an
/// `async` function flattens a returned Future, so returning the sheet's own
/// future would suspend the caller until the sheet closed — which is exactly
/// what the "nothing was approved" assertions below need to be able to see.
class _SheetProbe {
  final Future<SecurityTicket?>? future;
  const _SheetProbe(this.future);
}

Future<_SheetProbe> _pumpSheet(
  WidgetTester tester, {
  required PinGate gate,
}) async {
  Future<SecurityTicket?>? pending;
  // A phone, not the default 800x600 test surface. `showModalBottomSheet`
  // with `isScrollControlled: false` caps the sheet at 9/16 of the screen, so
  // on a desktop-sized surface the 4-row keypad overflows and the taps this
  // suite makes land nowhere. 360x800 logical is what the Admin's phone is.
  tester.view.physicalSize = const Size(720, 1600);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [pinGateProvider.overrideWithValue(gate)],
      child: legacy.ChangeNotifierProvider<AuthStore>(
        create: (_) => AuthStore(),
        child: MaterialApp(
          home: Scaffold(
            backgroundColor: Colors.white,
            body: Center(
              // `Builder` for a context under MaterialApp: the sheet is shown
              // from the button's own subtree, so the captured `context` has
              // the Navigator and the theme above it.
              child: Builder(
                builder: (inner) => ElevatedButton(
                  onPressed: () {
                    pending ??= showSecurityPinSheet(
                      inner,
                      title: 'Approve Booking',
                      consequence: 'This verifies ₱8,000. It cannot be undone.',
                    );
                  },
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
  return _SheetProbe(pending);
}

Future<void> _enter(WidgetTester tester, String digits) async {
  for (final character in digits.split('')) {
    await tester.tap(find.byKey(Key('pin-key-$character'),
        skipOffstage: false));
    await tester.pump(const Duration(milliseconds: 30));
  }
}

BoxDecoration _dotDecoration(WidgetTester tester, int i) =>
    tester.widget<Container>(find.byKey(Key('pin-dot-$i'))).decoration
        as BoxDecoration;

/// Whether [sheet] has resolved. Used instead of `doesNotComplete`, which
/// reports "completed with null" on a future that is demonstrably still
/// pending — verified by watching the future directly with a `.then` that
/// never fires. What the assertions below protect is that the sheet did not
/// pop with a ticket, and this asks that question of the future itself.
///
/// Call it after a `pump()`: an already-completed future settles on the next
/// microtask flush.
bool _sheetResolved(_SheetProbe sheet) {
  var resolved = false;
  sheet.future!.then((_) => resolved = true, onError: (_) => resolved = true);
  return resolved;
}

void main() {
  testWidgets('the right PIN pops the sheet with a fresh ticket',
      (tester) async {
    final gate = await _gateWithPin('492713');
    final sheet = await _pumpSheet(tester, gate: gate);

    await _enter(tester, '492713');
    await tester.pumpAndSettle();

    expect(await sheet.future, isA<SecurityTicket>());
  });

  testWidgets('a wrong PIN flashes the dots alert and drains the entry',
      (tester) async {
    final gate = await _gateWithPin('492713');
    final sheet = await _pumpSheet(tester, gate: gate);

    await _enter(tester, '111111');
    await tester.pump(const Duration(milliseconds: 80));

    // Mid-flash: the first dot shows the alert colour, not the filled dark.
    expect(_dotDecoration(tester, 0).color, AppColors.statusAlert);

    await tester.pump(const Duration(milliseconds: 600));

    // The entry drained for the next try, and the sheet is still up. An empty
    // slot is an outline with nothing in it, not a pale filled disc.
    expect(_dotDecoration(tester, 0).color, Colors.transparent);
    expect(_dotDecoration(tester, 0).border, isNotNull);
    expect(find.text('Approve Booking'), findsOneWidget);

    // The future is still open — nothing was approved.
    await tester.pump();
    expect(_sheetResolved(sheet), isFalse);

    // Dismiss for a clean teardown.
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
  });

  testWidgets('five wrong entries lock the sheet: countdown, dead keypad, '
      'no tap-outside escape', (tester) async {
    final gate = await _gateWithPin('492713');
    final sheet = await _pumpSheet(tester, gate: gate);

    for (var attempt = 0; attempt < 5; attempt++) {
      await _enter(tester, '111111');
      await tester.pump(const Duration(milliseconds: 80));
      await tester.pump(const Duration(milliseconds: 600));
    }

    // The countdown is on screen.
    expect(find.textContaining('Try again in'), findsOneWidget);

    // The keypad is dead: six more taps leave the dots empty.
    await _enter(tester, '492713');
    await tester.pump(const Duration(milliseconds: 100));
    expect(_dotDecoration(tester, 0).color, Colors.transparent);
    expect(_dotDecoration(tester, 0).border, isNotNull);

    // Tapping outside does not close a locked sheet.
    await tester.tapAt(const Offset(10, 10));
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.textContaining('Try again in'), findsOneWidget);

    // The future is still open — nothing was approved.
    await tester.pump();
    expect(_sheetResolved(sheet), isFalse);

    // Tear the sheet down and let every timer drain so the test ends clean.
    Navigator.of(tester.state(find.byType(Scaffold).first).context).pop();
    await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 600));
  });

  testWidgets('every key and the dot row carry semantics', (tester) async {
    final handle = tester.ensureSemantics();
    final gate = await _gateWithPin('492713');
    await _pumpSheet(tester, gate: gate);

    expect(find.bySemanticsLabel('5'), findsOneWidget);
    expect(find.bySemanticsLabel('0'), findsOneWidget);
    expect(find.bySemanticsLabel('Delete the last digit'), findsOneWidget);
    expect(
      find.bySemanticsLabel('0 of 6 digits of the Security PIN entered'),
      findsOneWidget,
    );

    handle.dispose();
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
  });
}
