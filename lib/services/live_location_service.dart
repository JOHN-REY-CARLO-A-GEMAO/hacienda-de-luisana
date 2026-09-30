/// Live location — the Admin app's reader (ADR-0013).
///
/// The Guest shares their position from inside a conversation on the website.
/// What arrives here is two things, in two different stores, and the order
/// matters:
///
///   1. `location_sessions/{conversationId}` in **Firestore** — the consent:
///      who is sharing, since when, until when, and the `stream_secret` that
///      binds a position to *this* consent. `firestore.rules` only lets the
///      conversation's own Guest write it, and only the Admin (or that Guest)
///      read it.
///   2. `live_location/{conversationId}/{guestUid}` in the **Realtime
///      Database** — the position itself, a leaf node overwritten in place on
///      every fix. `database.rules.json` grants the Admin a read on that exact
///      node and refuses it the moment `expires_at_ms` is in the past, so an
///      expired position is unreadable by the server itself; the Guest's client
///      additionally arms `onDisconnect().remove()` and removes the node on Stop.
///      (Realtime Database has no per-node TTL on any plan, so nothing here
///      relies on one — the rules are what enforce the window.)
///
/// A node is only ever drawn when [checkFix] accepts it against the session
/// Firestore authorised: same Guest, same conversation, same secret, not
/// expired. A node that fails any of those reads as "nothing to show", so a
/// stale node left behind by a crashed tab cannot become a position on a map.
///
/// What the Admin cannot do here is read a position nobody offered: there is no
/// list to browse, no history to open, and the read is refused outright once the
/// window closes, whether or not the node was cleaned up. What the Admin *can*
/// do is close the panel at any time — watching is opt-in on the Admin's side
/// too, and a notification does not drag the Admin into anything.
library;

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/foundation.dart';

/// Where the consent lives, in Firestore.
const String kLocationSessions = 'location_sessions';

/// Where the position lives, in the Realtime Database.
const String kLiveLocationPath = 'live_location';

/// Roles the Realtime Database can see, mirrored from the allowlist an
/// allowlisted Admin writes. `database.rules.json` allows a read either from
/// the bootstrap addresses in the token, or through a node an allowlisted
/// Admin has written — a role held only in a Profile is not in the token.
/// The address list itself is `AuthStore.kAdminEmails`, not a second copy.
const String kLiveLocationAdmins = 'live_location_admins';

/// A fix older than this is shown as stale rather than as "live now".
const Duration kStaleAfter = Duration(seconds: 20);

/// Why a stream is not being shown. The panel says the reason rather than
/// going quietly blank.
enum LiveLocationStop {
  /// No `databaseURL`, or the database is not initialised on this build.
  noTransport,

  /// The device is not online.
  offline,

  /// The consent is gone, or was never there.
  noSession,

  /// The Guest pressed Stop, or the window closed.
  expired,

  /// A node arrived that does not belong to this session.
  foreign,
}

/// The session as `location_sessions/{conversationId}` stores it. No
/// coordinate is in it, by rule.
class LiveLocationSession {
  const LiveLocationSession({
    required this.conversationId,
    required this.guestUid,
    required this.streamSecret,
    required this.startedAt,
    required this.expiresAt,
    required this.active,
  });

  final String conversationId;
  final String guestUid;
  final String streamSecret;
  final DateTime startedAt;
  final DateTime expiresAt;
  final bool active;

  /// Is the window still open? The Admin's reader asks this before it draws
  /// anything, so an expired session is not readable even if the node has not
  /// been swept yet.
  bool get isLive => active && DateTime.now().isBefore(expiresAt);

  Duration get remaining {
    final left = expiresAt.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  /// `24:31` — the countdown the panel shows.
  String get countdown {
    final s = remaining.inSeconds;
    final m = s ~/ 60;
    return '$m:${(s % 60).toString().padLeft(2, '0')}';
  }

  /// Reads a session document. Returns null when it is not one this app can
  /// use: a missing field, a secret that is not a 32-character secret, or a
  /// document that somehow carries a coordinate.
  static LiveLocationSession? fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    if (data == null) return null;
    final guestUid = data['guest_uid'];
    final secret = data['session_secret'];
    final startedAt = data['started_at'];
    final expiresAt = data['expires_at'];
    if (guestUid is! String ||
        secret is! String ||
        secret.length != 32 ||
        startedAt is! Timestamp ||
        expiresAt is! Timestamp) {
      return null;
    }
    // A consent that carries a position is not one this app will draw from.
    const forbidden = <String>['lat', 'lng', 'latitude', 'longitude', 'position', 'fix', 'points', 'trail'];
    if (forbidden.any((key) => data.containsKey(key))) return null;
    return LiveLocationSession(
      conversationId: doc.id,
      guestUid: guestUid,
      streamSecret: secret,
      startedAt: startedAt.toDate(),
      expiresAt: expiresAt.toDate(),
      active: data['active'] == true,
    );
  }
}

/// One position, as the stream carries it.
class LiveFix {
  const LiveFix({
    required this.lat,
    required this.lng,
    required this.accuracyM,
    required this.at,
    required this.seq,
  });

  final double lat;
  final double lng;
  final double accuracyM;
  final DateTime at;
  final int seq;

  Duration get age => DateTime.now().difference(at);

  bool get isStale => age > kStaleAfter;

  /// `3 seconds ago`, `2 minutes ago` — how the panel words the last update.
  String get ageLabel {
    final s = age.inSeconds;
    if (s < 10) return 'just now';
    if (s < 60) return '$s seconds ago';
    final m = s ~/ 60;
    if (m < 60) return '$m minute${m == 1 ? '' : 's'} ago';
    final h = m ~/ 60;
    return '$h hour${h == 1 ? '' : 's'} ago';
  }

  /// The same acceptance test the website's `checkFix` runs
  /// (`src/lib/liveLocationPolicy.ts`), kept in step by
  /// `test/chat_limits_test.dart`.
  static LiveFix? fromData(Object? raw, LiveLocationSession session) {
    if (raw is! Map) return null;
    final num lat = raw['lat'] is num ? raw['lat'] as num : double.nan;
    final num lng = raw['lng'] is num ? raw['lng'] as num : double.nan;
    final num accuracy = raw['accuracy_m'] is num ? raw['accuracy_m'] as num : double.nan;
    final num atMs = raw['at_ms'] is num ? raw['at_ms'] as num : double.nan;
    final num seq = raw['seq'] is num ? raw['seq'] as num : double.nan;
    final num expiresMs = raw['expires_at_ms'] is num ? raw['expires_at_ms'] as num : double.nan;
    if (lat.isNaN || lng.isNaN || accuracy.isNaN || atMs.isNaN || seq.isNaN || expiresMs.isNaN) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    // Identity, conversation and secret must all match the consent Firestore
    // holds. A node that does not is somebody else's, and is not drawn.
    if (raw['guest_uid'] != session.guestUid) return null;
    if (raw['conversation_id'] != session.conversationId) return null;
    if (raw['session_secret'] != session.streamSecret) return null;
    // A device cannot have been somewhere in the future, and cannot have sent
    // a fix past the window the consent allows.
    final now = DateTime.now();
    if (DateTime.fromMillisecondsSinceEpoch(atMs.toInt()).isAfter(now.add(const Duration(seconds: 30)))) return null;
    if (!DateTime.fromMillisecondsSinceEpoch(atMs.toInt()).isBefore(DateTime.fromMillisecondsSinceEpoch(expiresMs.toInt()))) {
      return null;
    }
    if (!session.isLive) return null;
    return LiveFix(
      lat: lat.toDouble(),
      lng: lng.toDouble(),
      accuracyM: accuracy.toDouble(),
      at: DateTime.fromMillisecondsSinceEpoch(atMs.toInt()),
      seq: seq.toInt(),
    );
  }
}

/// Reads one Guest's live position for a conversation.
///
/// Small interface, one stream, one subscription. The caller closes it, and
/// closing it is the whole of "stop viewing".
class LiveLocationService {
  LiveLocationService({FirebaseFirestore? firestore, FirebaseDatabase? database})
      : _firestore = firestore ?? FirebaseFirestore.instance,
        _database = database ?? _openDatabase();

  /// The Realtime Database, or null when this build has none.
  ///
  /// `FirebaseDatabase.instance` throws on a build whose `FirebaseOptions` has
  /// no `databaseURL`, and that is the normal case for a project that has
  /// never opened the Realtime Database. There is no stream to show then, so
  /// the answer is null and the panel says so — never a silent empty map.
  static FirebaseDatabase? _openDatabase() {
    try {
      return FirebaseDatabase.instance;
    } catch (error) {
      debugPrint('[live-location] no Realtime Database on this build: $error');
      return null;
    }
  }

  final FirebaseFirestore _firestore;
  final FirebaseDatabase? _database;

  /// The transport is optional in a way the rest of the SDK is not: a project
  /// with no `databaseURL` has no database, and there is then nothing to show.
  /// The panel says so instead of drawing an empty map.
  bool get hasTransport => _database != null;

  /// Make this Admin readable by the Realtime Database when the role lives in
  /// a Profile rather than in the allowlist.
  ///
  /// Only an allowlisted address can write `live_location_admins`, so this is
  /// a no-op for a promoted Admin until one of them has run the app once — a
  /// deliberate ordering, because the allowlist is the one role that needs no
  /// document to exist and therefore cannot be locked out of itself.
  Future<void> registerReader({required String uid, required bool allowlisted}) async {
    final db = _database;
    if (db == null || !allowlisted) return;
    try {
      await db.ref('$kLiveLocationAdmins/$uid').set(true);
    } catch (error) {
      debugPrint('[live-location] could not register as a stream reader: $error');
    }
  }

  /// Follow one Guest's position for one conversation.
  ///
  /// The returned stream emits a fix, or null with a reason. It closes itself
  /// when the window closes — the Admin app is not left with a subscription
  /// outliving the consent that justified it.
  Stream<LiveFix?> watch({
    required String conversationId,
    String? guestUid,
  }) {
    final db = _database;
    if (db == null) {
      return Stream<LiveFix?>.value(null);
    }
    final controller = StreamController<LiveFix?>();
    StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? sessionSub;
    StreamSubscription<DatabaseEvent>? positionSub;
    Timer? expiry;
    var closed = false;

    void emitStop() {
      if (closed || controller.isClosed) return;
      controller.add(null);
    }

    void stop([LiveLocationStop? reason]) {
      if (closed) return;
      closed = true;
      expiry?.cancel();
      sessionSub?.cancel();
      positionSub?.cancel();
      if (!controller.isClosed) controller.close();
      if (reason != null) debugPrint('[live-location] ${conversationId}: $reason');
    }

    sessionSub = _firestore.collection(kLocationSessions).doc(conversationId).snapshots().listen((snapshot) {
      if (!snapshot.exists) {
        emitStop();
        stop(LiveLocationStop.noSession);
        return;
      }
      final next = LiveLocationSession.fromDoc(snapshot);
      if (next == null || !next.isLive) {
        emitStop();
        stop(next == null ? LiveLocationStop.foreign : LiveLocationStop.expired);
        return;
      }
      // The window closing ends the stream from the Admin's side too, without
      // waiting for the server to sweep the node.
      expiry?.cancel();
      expiry = Timer(next.remaining, () {
        emitStop();
        stop(LiveLocationStop.expired);
      });

      final target = guestUid ?? next.guestUid;
      positionSub?.cancel();
      positionSub = db
          .ref('$kLiveLocationPath/$conversationId/$target')
          .onValue
          .listen((event) {
        if (closed) return;
        // `onValue` hands over a `DatabaseEvent`, which carries the snapshot
        // rather than being one (firebase_database 12).
        final data = event.snapshot.value;
        if (data == null) {
          // The node is gone: the Guest stopped, or the server swept it.
          emitStop();
          return;
        }
        final fix = LiveFix.fromData(data, next);
        if (fix == null) {
          emitStop();
          stop(LiveLocationStop.foreign);
          return;
        }
        if (controller.isClosed) return;
        controller.add(fix);
      }, onError: (Object error) {
        debugPrint('[live-location] $conversationId: stream error $error');
        emitStop();
      });
    }, onError: (Object error) {
      debugPrint('[live-location] $conversationId: session error $error');
      emitStop();
      stop(LiveLocationStop.noSession);
    });

    controller.onCancel = () {
      closed = true;
      expiry?.cancel();
      sessionSub?.cancel();
      positionSub?.cancel();
    };
    return controller.stream;
  }
}
