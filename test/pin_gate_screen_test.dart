// Widget test for the PIN gate in front of the whole app — the GCash-shaped
// door added after ADR-0015 shipped.
//
// The other PIN suite (`pin_sheet_widget_test.dart`) covers the sheet that
// guards one action. This one exists because the failure that matters here is
// a gate that does not hold: if the shell ever renders before a correct PIN,
// or a new device offline can wave through, the PIN is decoration.
//
// Run: flutter test test/pin_gate_screen_test.dart

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hacienda_de_luisana/core/constants/app_constants.dart';
import 'package:hacienda_de_luisana/providers/app_providers.dart';
import 'package:hacienda_de_luisana/services/auth_store.dart';
import 'package:hacienda_de_luisana/services/pin_store.dart';
import 'package:hacienda_de_luisana/views/security/pin_gate_screen.dart';
import 'package:provider/provider.dart' as legacy;

/// A remote that cannot be reached — a phone with no cache and no network.
class _DeadRemote implements PinSecurityRemote {
  @override
  Future<Map<String, dynamic>?> fetchAdminSecurity(String uid) async =>
      throw StateError('offline');

  @override
  Future<void> recordPinFailure(String uid,
      {required int failedAttempts, required DateTime? lockedUntil}) async {}

  @override
  Future<void> writeAdminSecurity(String uid, Map<String, dynamic> doc) async {}

  /// A phone that cannot be reached cannot dispose of the PIN either — which is
  /// why ADR-0016's reset needs the server and why the blocked phase keeps only
  /// Retry and Sign out.
  @override
  Future<void> forgetPin(String uid) async => throw StateError('offline');
}

/// A remote that will dispose of the record when asked, and can be told to
/// refuse the way the rules do inside ADR-0016's cooldown (ADR-0016).
class _ResettableRemote implements PinSecurityRemote {
  final Map<String, Map<String, dynamic>> docs = {};
  bool refuse = false;
  int resets = 0;

  @override
  Future<Map<String, dynamic>?> fetchAdminSecurity(String uid) async =>
      docs[uid];

  @override
  Future<void> recordPinFailure(String uid,
      {required int failedAttempts, required DateTime? lockedUntil}) async {}

  @override
  Future<void> writeAdminSecurity(String uid, Map<String, dynamic> doc) async {
    docs[uid] = Map<String, dynamic>.from(doc);
  }

  @override
  Future<void> forgetPin(String uid) async {
    resets++;
    if (refuse) throw StateError('permission-denied');
    docs.remove(uid);
  }
}

/// A gate that already knows this device's PIN ('492713').
Future<PinGate> _gateWithPin(String pin) async {
  final gate = PinGate(store: MemoryPinStore());
  // The gate resolves its uid from a signed-out AuthStore in tests, which is
  // the 'admin' fallback — the same key the screen verifies under.
  await gate.setPin('admin', pin, iterations: 100);
  return gate;
}

/// The same, but stamped a day and an hour ago — past ADR-0016's 24 h
/// cooldown, so the reset is actually available.
Future<PinGate> _gateWithStalePin(String pin, PinSecurityRemote remote) async {
  final gate = PinGate(store: MemoryPinStore(), remote: remote);
  await gate.setPin('admin', pin, iterations: 100,
      now: DateTime.now().subtract(const Duration(hours: 25)));
  return gate;
}

/// The same, but stamped just now — inside the cooldown, so the sheet has to say
/// the wait instead of offering the reset.
Future<PinGate> _gateWithFreshPin(String pin, PinSecurityRemote remote) async {
  final gate = PinGate(store: MemoryPinStore(), remote: remote);
  await gate.setPin('admin', pin, iterations: 100);
  return gate;
}

bool _unlocked = false;

/// Pumps the gate with a stand-in shell behind it, exactly as `AuthGate`
/// stacks them, and reports whether the shell is showing.
Future<void> _pumpGate(WidgetTester tester, PinGate gate) async {
  _unlocked = false;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [pinGateProvider.overrideWithValue(gate)],
      child: legacy.ChangeNotifierProvider<AuthStore>(
        create: (_) => AuthStore(),
        child: MaterialApp(
          home: Scaffold(
            body: Stack(
              children: [
                const _FakeShell(),
                PinGateScreen(onUnlocked: () => _unlocked = true),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// The thing the gate is there to hide. Real screen; here a marker.
class _FakeShell extends StatelessWidget {
  const _FakeShell();

  @override
  Widget build(BuildContext context) =>
      const Center(child: Text('THE SHELL', key: Key('fake-shell')));
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

void main() {
  testWidgets('the gate covers the shell: no PIN, no shell', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    // The gate is up and the shell is behind it.
    expect(find.byType(PinGateScreen), findsOneWidget);
    expect(find.text('THE SHELL'), findsOneWidget);
    expect(_unlocked, isFalse);

    // A wrong PIN does not open it.
    await _enter(tester, '111111');
    await tester.pumpAndSettle();
    expect(_unlocked, isFalse);
    expect(find.byType(PinGateScreen), findsOneWidget);
  });

  testWidgets('the right PIN opens the gate', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    expect(find.text('Enter your Security PIN'), findsOneWidget);

    await _enter(tester, '492713');
    await tester.pumpAndSettle();

    expect(_unlocked, isTrue);
  });

  testWidgets('first run creates the PIN twice before anything opens',
      (tester) async {
    // No record anywhere: this is the new-device path.
    await _pumpGate(tester, PinGate(store: MemoryPinStore()));

    expect(find.text('Create your Security PIN'), findsOneWidget);

    await _enter(tester, '246813');
    await tester.pumpAndSettle();
    expect(find.text('Enter it once more'), findsOneWidget);
    expect(_unlocked, isFalse);

    // A mistyped repeat goes back to the start rather than opening anything.
    await _enter(tester, '246814');
    await tester.pumpAndSettle();
    expect(find.text('Those two did not match — start again.'), findsOneWidget);
    expect(_unlocked, isFalse);

    await _enter(tester, '246813');
    await tester.pumpAndSettle();
    await _enter(tester, '246813');
    await tester.pumpAndSettle();

    expect(_unlocked, isTrue);
  });

  testWidgets('a wrong PIN flashes the dots and drains the entry',
      (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    await _enter(tester, '111111');
    await tester.pump(const Duration(milliseconds: 80));

    expect(_dotDecoration(tester, 0).color, AppColors.statusAlert);

    await tester.pump(const Duration(milliseconds: 600));

    // Drained back to an empty outline.
    expect(_dotDecoration(tester, 0).color, Colors.transparent);
    expect(_dotDecoration(tester, 0).border, isNotNull);
    expect(_unlocked, isFalse);
  });

  testWidgets('five wrong entries lock the gate: countdown, dead keypad, '
      'no back out', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    for (var attempt = 0; attempt < 5; attempt++) {
      await _enter(tester, '111111');
      await tester.pump(const Duration(milliseconds: 80));
      await tester.pump(const Duration(milliseconds: 600));
    }

    expect(find.textContaining('Try again in'), findsOneWidget);

    // The correct PIN cannot get in while the ladder holds.
    await _enter(tester, '492713');
    await tester.pump(const Duration(milliseconds: 100));
    expect(_dotDecoration(tester, 0).color, Colors.transparent);
    expect(_dotDecoration(tester, 0).border, isNotNull);
    expect(_unlocked, isFalse);

    // And the gate does not pop.
    final canPop = tester
        .widget<PopScope>(find.byType(PopScope))
        .canPop;
    expect(canPop, isFalse);
  });

  testWidgets('offline with no cache blocks the app instead of opening it',
      (tester) async {
    await _pumpGate(
      tester,
      PinGate(store: MemoryPinStore(), remote: _DeadRemote()),
    );

    expect(find.text('The Security PIN cannot be checked'), findsOneWidget);
    // Retry and sign-out, and nothing that looks like a keypad.
    expect(find.byKey(const Key('pin-gate-retry')), findsOneWidget);
    expect(find.byKey(const Key('pin-gate-blocked-sign-out')), findsOneWidget);
    expect(find.byKey(const Key('pin-key-0')), findsNothing);
    expect(_unlocked, isFalse);

    // Retry re-asks, and is still blocked while the server is down.
    await tester.tap(find.byKey(const Key('pin-gate-retry')));
    await tester.pumpAndSettle();
    expect(find.text('The Security PIN cannot be checked'), findsOneWidget);
    expect(_unlocked, isFalse);
  });

  testWidgets('the heading carries the instruction, and the redundant prompt '
      'is gone', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    // The heading alone says what is wanted.
    expect(find.text('Enter your Security PIN'), findsOneWidget);
    // "Please enter your PIN" restated it a second line down and made the
    // header feel crowded, so it is not here any more.
    expect(find.text('Please enter your PIN'), findsNothing);
    expect(find.byKey(const Key('pin-gate-prompt')), findsNothing);
  });

  testWidgets('the keypad is white on the gate, not the house dark ink',
      (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    // Every digit, and the backspace, has to read against the deep green.
    for (final digit in ['0', '1', '5', '9']) {
      final text = tester.widget<Text>(
        find.descendant(
          of: find.byKey(Key('pin-key-$digit')),
          matching: find.byType(Text),
        ),
      );
      final color = text.style!.color!;
      expect(color.computeLuminance(), greaterThan(0.7),
          reason: 'digit $digit is too dark to read on the gate: $color');
    }

    final backspace = tester.widget<Icon>(
      find.descendant(
        of: find.byKey(const Key('pin-key-backspace')),
        matching: find.byType(Icon),
      ),
    );
    expect(backspace.color!.computeLuminance(), greaterThan(0.7),
        reason: 'backspace is too dark on the gate: ${backspace.color}');
  });

  testWidgets('empty dots are outlines and filled dots are solid',
      (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    // Before typing: six outlined slots, nothing filled.
    for (var i = 0; i < 6; i++) {
      final decoration = _dotDecoration(tester, i);
      expect(decoration.color, Colors.transparent,
          reason: 'dot $i should be empty before typing');
      expect(decoration.border, isNotNull,
          reason: 'dot $i needs an outline to read as an empty slot');
    }

    // Two entered: exactly the first two are solid, the rest still outlines.
    await _enter(tester, '49');
    await tester.pumpAndSettle();

    for (var i = 0; i < 2; i++) {
      expect(_dotDecoration(tester, i).color, AppColors.accentGold,
          reason: 'dot $i should be filled');
      expect(_dotDecoration(tester, i).border, isNull,
          reason: 'a filled dot should not also be outlined');
    }
    for (var i = 2; i < 6; i++) {
      expect(_dotDecoration(tester, i).color, Colors.transparent,
          reason: 'dot $i should still be empty');
      expect(_dotDecoration(tester, i).border, isNotNull);
    }

    // Deleting puts the dot back to an outline.
    await tester.tap(find.byKey(const Key('pin-key-backspace')));
    await tester.pumpAndSettle();
    expect(_dotDecoration(tester, 1).color, Colors.transparent);
    expect(_dotDecoration(tester, 1).border, isNotNull);
  });

  testWidgets('the platform keyboard is offered a numeric field, and typing '
      'there fills the same dots', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    // A real field holding the IME, digits only — the pad's own keys are not
    // a keyboard, which is why none used to appear.
    final field = find.byKey(const Key('pin-keyboard-input'));
    expect(field, findsOneWidget);
    expect(
      tester.widget<TextField>(field).keyboardType,
      TextInputType.number,
    );
    expect(tester.widget<TextField>(field).focusNode!.hasFocus, isTrue);

    // Typing on it fills the same six dots a tap would.
    await tester.enterText(field, '4927');
    await tester.pumpAndSettle();
    for (var i = 0; i < 4; i++) {
      expect(_dotDecoration(tester, i).color, AppColors.accentGold,
          reason: 'dot $i should be filled from the keyboard route');
    }
    expect(_dotDecoration(tester, 4).color, Colors.transparent);
    expect(_dotDecoration(tester, 5).color, Colors.transparent);
  });

  testWidgets('a PIN typed on the keyboard opens the gate', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    await tester.enterText(find.byKey(const Key('pin-keyboard-input')), '492713');
    await tester.pumpAndSettle();

    expect(_unlocked, isTrue);
  });

  testWidgets('a wrong PIN typed on the keyboard does not open the gate',
      (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    await tester.enterText(find.byKey(const Key('pin-keyboard-input')), '111111');
    await tester.pumpAndSettle();

    expect(_unlocked, isFalse);
    expect(find.byType(PinGateScreen), findsOneWidget);
  });

  testWidgets('the gate offers a way out but no way past', (tester) async {
    await _pumpGate(tester, await _gateWithPin('492713'));

    expect(find.byKey(const Key('pin-gate-sign-out')), findsOneWidget);
    // No skip, no "turn it off", no default PIN to type.
    expect(find.textContaining('Skip'), findsNothing);
    expect(find.textContaining('turn it off'), findsNothing);
  });

  // The way out of a gate nobody can open (ADR-0016).
  testWidgets('a PIN past the cooldown offers the way out of the gate',
      (tester) async {
    await _pumpGate(
        tester, await _gateWithStalePin('492713', _ResettableRemote()));

    expect(find.byKey(const Key('pin-gate-forgot')), findsOneWidget);
    // Offering it changes nothing about the gate: still six dots, no shell.
    expect(find.text('Enter your Security PIN'), findsOneWidget);
    expect(_unlocked, isFalse);
  });

  testWidgets('demo mode does not offer a reset it cannot perform',
      (tester) async {
    // No remote: there is no server record to dispose of, and so no dead end.
    await _pumpGate(tester, await _gateWithPin('492713'));

    expect(find.byKey(const Key('pin-gate-forgot')), findsNothing);
    expect(find.byKey(const Key('pin-gate-sign-out')), findsOneWidget);
  });

  testWidgets('the blocked phase still offers no reset — the server is the '
      'point', (tester) async {
    // ADR-0016's reset is online by construction, so an unreachable server is
    // exactly where it must not appear.
    await _pumpGate(
        tester, PinGate(store: MemoryPinStore(), remote: _DeadRemote()));

    expect(find.byKey(const Key('pin-gate-forgot')), findsNothing);
    expect(find.byKey(const Key('pin-gate-retry')), findsOneWidget);
  });

  testWidgets('a freshly set PIN says the wait instead of offering the reset',
      (tester) async {
    await _pumpGate(
        tester, await _gateWithFreshPin('492713', _ResettableRemote()));

    await tester.tap(find.byKey(const Key('pin-gate-forgot')));
    await tester.pumpAndSettle();

    expect(find.textContaining('Available in'), findsOneWidget);
    expect(find.byKey(const Key('forgot-pin-reset')), findsNothing);
    // Back is still the way out of the sheet itself.
    expect(find.byKey(const Key('forgot-pin-back')), findsOneWidget);
  });

  testWidgets('a reset says what it costs, then returns the gate to setup',
      (tester) async {
    final remote = _ResettableRemote();
    await _pumpGate(tester, await _gateWithStalePin('492713', remote));

    await tester.tap(find.byKey(const Key('pin-gate-forgot')));
    await tester.pumpAndSettle();

    expect(find.text('Cannot remember your PIN?'), findsOneWidget);
    // The cost is on screen before the button, not after it.
    expect(find.textContaining('lockout count'), findsOneWidget);
    expect(find.byKey(const Key('forgot-pin-reset')), findsOneWidget);

    await tester.tap(find.byKey(const Key('forgot-pin-reset')));
    await tester.pumpAndSettle();

    expect(remote.resets, 1);
    // Not the shell: the gate asks for a NEW PIN rather than opening.
    expect(_unlocked, isFalse);
    expect(find.text('Create your Security PIN'), findsOneWidget);
  });

  testWidgets('a refused reset leaves the gate asking for the same PIN',
      (tester) async {
    final remote = _ResettableRemote()..refuse = true;
    await _pumpGate(tester, await _gateWithStalePin('492713', remote));

    await tester.tap(find.byKey(const Key('pin-gate-forgot')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('forgot-pin-reset')));
    await tester.pumpAndSettle();

    expect(_unlocked, isFalse);
    // Still the same gate, still the same PIN, and the sheet admits that
    // nothing changed rather than pretending the reset worked.
    expect(find.text('Enter your Security PIN'), findsOneWidget);
    expect(find.text('Cannot remember your PIN?'), findsOneWidget);
    expect(find.textContaining('Nothing was changed'), findsOneWidget);
  });

  testWidgets('Back closes the sheet without resetting anything', (tester) async {
    final remote = _ResettableRemote();
    await _pumpGate(tester, await _gateWithStalePin('492713', remote));

    await tester.tap(find.byKey(const Key('pin-gate-forgot')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('forgot-pin-back')));
    await tester.pumpAndSettle();

    expect(remote.resets, 0);
    // The sheet is gone; the gate and its trigger are not.
    expect(find.byKey(const Key('forgot-pin-back')), findsNothing);
    expect(find.byKey(const Key('pin-gate-forgot')), findsOneWidget);
    expect(find.text('Enter your Security PIN'), findsOneWidget);
    expect(_unlocked, isFalse);
  });
}