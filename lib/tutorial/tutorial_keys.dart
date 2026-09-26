/// The anchors the interactive tour highlights.
///
/// Every anchor is a [GlobalKey] attached to the *real* widget it names — the
/// tour never rebuilds or re-renders the control; it measures the widget's
/// render box through the key and frames it. Registering a new anchor is one
/// line here plus `key: TourKeys.<name>` on the widget.
library;

import 'package:flutter/material.dart';

class TourKeys {
  TourKeys._();

  /// The app's root navigator: the tour pops pushed routes between steps and
  /// floats its overlay above everything, including modal sheets and pushed
  /// detail screens.
  static final GlobalKey<NavigatorState> rootNavigator =
      GlobalKey<NavigatorState>();

  /// Notifies the tour when routes are pushed or popped, so its overlay stays
  /// on top of the newest screen.
  static final RouteObserver<ModalRoute<void>> routeObserver =
      _TourRouteObserver();

  /// Callback installed by the controller (avoids an import cycle).
  static void Function()? onRouteChanged;

  // Dashboard
  static final GlobalKey reviewBookings = GlobalKey(debugLabel: 'tour.reviewBookings');

  // Bookings list
  static final GlobalKey needsActionChip = GlobalKey(debugLabel: 'tour.needsActionChip');
  static final GlobalKey searchField = GlobalKey(debugLabel: 'tour.searchField');
  static final GlobalKey firstBookingCard = GlobalKey(debugLabel: 'tour.firstBookingCard');

  // Booking detail
  static final GlobalKey detailActions = GlobalKey(debugLabel: 'tour.detailActions');

  // Bottom navigation
  static final GlobalKey tabBookings = GlobalKey(debugLabel: 'tour.tabBookings');
  static final GlobalKey tabChat = GlobalKey(debugLabel: 'tour.tabChat');
  static final GlobalKey tabStays = GlobalKey(debugLabel: 'tour.tabStays');
  static final GlobalKey tabMore = GlobalKey(debugLabel: 'tour.tabMore');

  // "More" sheet
  static final GlobalKey moreRates = GlobalKey(debugLabel: 'tour.moreRates');
  static final GlobalKey moreSmartLock = GlobalKey(debugLabel: 'tour.moreSmartLock');

  // Chat
  static final GlobalKey firstThread = GlobalKey(debugLabel: 'tour.firstThread');
  static final GlobalKey threadComposer = GlobalKey(debugLabel: 'tour.threadComposer');

  // Rates & smart lock
  static final GlobalKey ratesPublish = GlobalKey(debugLabel: 'tour.ratesPublish');
  static final GlobalKey smartLockStats = GlobalKey(debugLabel: 'tour.smartLockStats');

  static final Map<String, GlobalKey> byId = {
    'reviewBookings': reviewBookings,
    'needsActionChip': needsActionChip,
    'searchField': searchField,
    'firstBookingCard': firstBookingCard,
    'detailActions': detailActions,
    'tabBookings': tabBookings,
    'tabChat': tabChat,
    'tabStays': tabStays,
    'tabMore': tabMore,
    'moreRates': moreRates,
    'moreSmartLock': moreSmartLock,
    'firstThread': firstThread,
    'threadComposer': threadComposer,
    'ratesPublish': ratesPublish,
    'smartLockStats': smartLockStats,
  };
}

class _TourRouteObserver extends RouteObserver<ModalRoute<void>> {
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    TourKeys.onRouteChanged?.call();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    TourKeys.onRouteChanged?.call();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didRemove(route, previousRoute);
    TourKeys.onRouteChanged?.call();
  }
}
