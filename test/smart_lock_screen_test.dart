import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hacienda_de_luisana/models/smart_lock_event_model.dart';
import 'package:hacienda_de_luisana/providers/app_providers.dart';
import 'package:hacienda_de_luisana/services/firestore_service.dart';
import 'package:hacienda_de_luisana/views/smartlock/smart_lock_screen.dart';

void main() {
  Future<void> pumpScreen(
      WidgetTester tester, List<SmartLockEventModel> logs) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(ProviderScope(
      overrides: [
        firestoreServiceProvider.overrideWith((ref) => FirestoreService(null)),
        smartLockLogsStreamProvider.overrideWith((ref) => Stream.value(logs)),
      ],
      child: const MaterialApp(home: SmartLockScreen()),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('empty audit trail and demo actions scroll without an overlay',
      (tester) async {
    await pumpScreen(tester, []);
    expect(find.text('No lock activity'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(find.text('Door activity will appear here when it is recorded.'),
        findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Simulation options'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Simulation options'), findsOneWidget);
    expect(find.text('Simulate RFID Swipe'), findsNothing);
    await tester.tap(find.text('Simulation options'));
    await tester.pumpAndSettle();
    expect(find.text('Simulate RFID Swipe'), findsOneWidget);
    expect(find.text('Simulate Check-out Tap (desk)'), findsOneWidget);
    await tester.tap(find.text('Simulate Check-out Tap (desk)'));
    await tester.pumpAndSettle();
    expect(find.text('Simulate a check-out desk tap?'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('audit events remain readable before the simulation controls',
      (tester) async {
    await pumpScreen(tester, [
      SmartLockEventModel(
        id: 'event-1',
        doorName: 'Front door',
        action: LockAction.masterOverride,
        method: LockMethod.physicalKey,
        triggeredBy: 'Admin',
        timestamp: DateTime.now(),
        isSuccess: true,
        simulated: true,
      ),
    ]);
    await tester.scrollUntilVisible(find.text('Front door'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('MASTER KEY'), findsOneWidget);
    expect(find.text('Simulation'), findsWidgets);
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
