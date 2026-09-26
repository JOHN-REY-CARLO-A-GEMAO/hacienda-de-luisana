/// The interactive Admin tour — step model.
///
/// One step per real control: the tour highlights the living widget
/// (a `TourKeys`-registered [GlobalKey]), explains what it does and why the
/// Admin uses it, and advances when the Admin *uses* it — a tap on the real
/// button, a filter chip, a search keystroke — not by pressing Next. Steps
/// marked [TutorialAdvance.none] are explanations and keep a Continue button;
/// they are used wherever the feature would mutate real data (approving a
/// Booking, publishing rates), because a tour must never take an irreversible
/// action on a Guest's account.
library;

enum TutorialAdvance {
  /// Read and press Continue.
  none,

  /// Tap the highlighted control (detected through the [TourBus] event the
  /// control's own handler reports — the tour never wraps or replaces it).
  tap,

  /// Type something into the highlighted field (TourBus input report).
  input,

  /// The app reported `eventName` through the TourBus.
  event,

  /// The main shell switched to `tabIndex`.
  tab,
}

class TutorialStep {
  const TutorialStep({
    required this.id,
    required this.title,
    required this.body,
    this.targetKey,
    this.why,
    this.fallbackBody,
    this.advance = TutorialAdvance.none,
    this.eventName,
    this.tabIndex,
    this.actionHint,
    this.ensureTab,
    this.popToRoot = false,
    this.continueLabel = 'Next',
  });

  final String id;

  /// Id in the [TourKeys] registry, or null for a centered dialog-like card
  /// (welcome / summary steps).
  final String? targetKey;

  final String title;

  /// What the feature does.
  final String body;

  /// Why the Admin uses it — shown as a callout.
  final String? why;

  /// Shown instead of [body] when the target widget is not on screen (no
  /// Firebase, empty list). The step degrades to informational and can always
  /// be continued — the tour never strands the Admin.
  final String? fallbackBody;

  final TutorialAdvance advance;

  /// The TourBus event awaited when [advance] is [TutorialAdvance.event], or
  /// the input id awaited when [advance] is [TutorialAdvance.input].
  final String? eventName;

  /// The shell tab awaited when [advance] is [TutorialAdvance.tab].
  final int? tabIndex;

  /// Prompt shown while waiting for the interaction ("Tap Review Bookings").
  final String? actionHint;

  /// Switch the shell to this tab when the step starts.
  final int? ensureTab;

  /// Pop pushed routes (booking detail, chat thread) when the step starts.
  final bool popToRoot;

  final String continueLabel;
}
