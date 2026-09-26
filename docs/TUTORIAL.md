# The interactive guided tutorial

Both applications onboard their user with a **guided tour that drives the real UI**
— not a slideshow. The tour highlights living controls, explains what each one
does and why the person would use it, and moves on only when the person has
*used* the highlighted control: clicked the real "View Accommodation" button,
picked real dates, ticked the real Terms box, switched the real tab. Read-only
explanations keep a plain Continue button, and those are the only steps over
irreversible actions (approving a Booking, publishing rates).

- **Guest website**: `src/tutorial/` + `src/components/Tutorial.tsx`
- **Admin mobile app**: `lib/tutorial/` + wiring in `main.dart` and the screens

## How it works (web)

| Piece | Where | Job |
| --- | --- | --- |
| Step script | `src/tutorial/steps.ts` | Ordered steps: target anchors, copy, and what `await`s completion (`click`, `fields`, `checked`, `event`, or `none`). Follows the Booking lifecycle and uses CONTEXT.md vocabulary. |
| Engine | `src/tutorial/TourEngine.tsx` | `TourProvider` state machine: navigates to the step's route, finds the anchor's element, tracks its rect per animation frame, scrolls it into view, and listens — capture-phase, never intercepting — for the awaited interaction. |
| Overlay | `src/tutorial/TourOverlay.tsx` | Four dim panes frame a hole over the target, so the real control keeps working. Responsive: bottom sheet on phones, floating card beside the highlight otherwise, centered dialog when there is no target. |
| Integration | `src/components/Tutorial.tsx` | First-visit auto-open, completion cookie (`hdl_tutorial_done`, 180 days, mirrored in localStorage), "Replay tutorial" floating button. |

### Anchoring a control

Put a `data-tour="name"` on the real element and reference it from a step's
`targets` list. The first *visible* candidate gets the spotlight, but a click
on **any** candidate counts (e.g. the desktop nav button, the mobile sticky
CTA and the accommodation card all satisfy the `stay` step). Inputs use
`data-tour-field="name"` and are validated from live DOM values.

### Degradation rules

If no anchor materialises within ~2.4 s (signed out behind `ProtectedRoute`,
no bookings yet), the step renders its `fallbackBody` as a centered,
informational card and Continue is always available — the tour never blocks.
Interactive steps also offer "Skip this step"; every step offers Skip tour
(remembers), Back, and Exit (× or Esc, remembers nothing).

## How it works (Flutter)

| Piece | Where | Job |
| --- | --- | --- |
| Step script | `lib/tutorial/tutorial_steps.dart` | Same lifecycle order and vocabulary as the web script. `TutorialAdvance`: `tab`, `event`, `input`, `none`. |
| Controller | `lib/tutorial/tutorial_controller.dart` | ChangeNotifier + `tutorialControllerProvider`. Switches shell tabs, pops routes between rooms, floats the overlay in the **root navigator's overlay** (above pushed detail screens and the More sheet), re-floats on route changes via `TourKeys.routeObserver`. |
| Keys | `lib/tutorial/tutorial_keys.dart` | `GlobalKey` registry — one key per real control the tour highlights. |
| Bus | `TourBus` (in the controller file) | One-line reports from existing handlers: `TourBus.tab(i)`, `TourBus.event('more-opened')`, `TourBus.input('search-typed', v)`. The tour never wraps a control; the control's own callback reports the gesture. |
| Overlay | `lib/tutorial/tutorial_overlay.dart` | Same four-blocker hole design; card docks near the highlight when it fits, else to the bottom (with keyboard inset). |
| Store | `lib/tutorial/tutorial_store.dart` | SharedPreferences flag `hdl_admin_tutorial_done`, with an in-memory fallback (`MemoryTutorialStore`) for tests. |

The shell (`main_shell_screen.dart`) offers the tour on first launch after the
Admin signs in, and the More sheet carries "Replay the guided tour". The same
missing-target degradation applies (e.g. chat thread steps when the device has
no Firebase conversations).

## Testing

- `test/web/tutorial.test.tsx` — renders the real `<App/>` and walks the whole
  guest flow: auto-open, interaction-gated steps (click / dates / name /
  terms / real Booking submission), signed-out degradation, Skip/Exit/Replay
  and the completion cookie. Run: `npx vitest run test/web/tutorial.test.tsx`.
- `test/tutorial_controller_test.dart` — the Flutter state machine with a
  deterministic script: offer-lifecycle, tab/event/input advancing, stale-report
  guard, skip/exit/replay, and a guard that the Admin script stays interactive
  but never gates on an irreversible action. Run: `flutter test test/tutorial_controller_test.dart`.

## Extending the tour

1. **Web**: add `data-tour` to the control, then a step in `steps.ts`. Pick an
   `await` that matches the gesture and give it an `actionHint`.
2. **Flutter**: register a key in `TourKeys`, attach it to the widget, add one
   `TourBus` call inside the widget's existing handler, then a step in
   `tutorial_steps.dart`.
3. Never gate a step on an action that mutates a real Guest, Booking or rate —
   those steps stay informational (`continueLabel: 'Got it'`).
