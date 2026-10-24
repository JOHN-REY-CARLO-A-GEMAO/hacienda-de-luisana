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
///
/// What this reader deliberately does NOT do is end on a missing node. The
/// panel opens *before* the Guest's first fix — it is the panel that says
/// "Waiting for the Guest's first position…" — and `startSharing` restarts a
/// share by deleting and recreating the consent, so both the position node and
/// the consent document can be briefly absent while everything is working.
/// Absent is `LiveLocationPhase.noSession` or `.waiting`, not death; only a
/// refusal, a foreign payload, or the window closing ends the watch. Every one
/// of those endings carries a [LiveLocationStop] reason the panel shows — an
/// Admin left looking at a spinner is the failure this file exists to prevent.
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

/// Where the Admin roles live, so `registerReader` can mirror them.
const String kProfiles = 'profiles';

/// A fix older than this is shown as stale rather than as "live now".
const Duration kStaleAfter = Duration(seconds: 20);

/// Why a watch ended. The panel says the reason rather than going quietly
/// blank — every one of these replaces what used to be an endless spinner.
enum LiveLocationStop {
  /// No `databaseURL`, or the database is not initialised on this build.
  noTransport,

  /// The position stream dropped: offline, or the connection failed.
  offline,

  /// The Guest pressed Stop, the window closed, or the consent is gone.
  expired,

  /// A payload arrived that does not belong to this session.
  foreign,

  /// Firestore or the Realtime Database refused this Admin a read. On the
  /// Realtime Database that is the allowlist/mirror rules: a Profile-promoted
  /// Admin is only readable once an allowlisted Admin has run the app once
  /// (`registerReader`).
  denied,
}

/// One sentence for the Admin, per ending. Pure, so it is unit-tested in
/// `test/chat_limits_test.dart` beside the parsers.
String liveLocationStopMessage(LiveLocationStop reason) {
  switch (reason) {
    case LiveLocationStop.noTransport:
      return 'This build has no live-location channel configured.';
    case LiveLocationStop.offline:
      return 'The position stream dropped. Check the connection and open the reader again.';
    case LiveLocationStop.expired:
      return 'The Guest stopped sharing, or the time they chose ran out.';
    case LiveLocationStop.foreign:
      return 'What arrived from the database did not match this session.';
    case LiveLocationStop.denied:
      return 'This Admin account cannot read live locations yet. An allowlisted Admin must run the app once.';
  }
}

/// Where the panel is, on the way to drawing a position.
enum LiveLocationPhase {
  /// Listening, but this conversation has no live share on record right now.
  /// The Guest may start at any moment, which is why the watch stays open.
  noSession,

  /// The consent is live and the first position has not arrived yet.
  waiting,

  /// A position has been accepted and is being drawn.
  live,

  /// The watch is over. [LiveLocationView.reason] says why.
  ended,
}

/// One frame of what the Admin's panel should show: the phase, the last
/// position accepted (kept through the ending so a map does not vanish when a
/// share stops), and — for [LiveLocationPhase.ended] — why.
class LiveLocationView {
  const LiveLocationView(this.phase, {this.fix, this.reason});

  final LiveLocationPhase phase;
  final LiveFix? fix;
  final LiveLocationStop? reason;
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
    return data == null ? null : fromData(doc.id, data);
  }

  /// Pure form of [fromDoc], shared by the parser regression test.
  static LiveLocationSession? fromData(String conversationId, Map<String, dynamic> data) {
    final guestUid = data['guest_uid'];
    // Firestore stores the consent as `stream_secret`; the ephemeral RTDB fix
    // restates that value as `session_secret`. Reading the latter here made
    // every otherwise-valid session look foreign before the Admin could watch.
    final secret = data['stream_secret'];
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
      conversationId: conversationId,
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
  /// Only an allowlisted address can write `live_location_admins`, so a
  /// Profile-promoted Admin is admitted by a mirror an allowlisted Admin
  /// writes. This call therefore mirrors every `profiles/{uid}` that carries
  /// `role == 'admin'` — not just the caller — so the promise holds: once one
  /// allowlisted Admin has opened the reader once, every promoted Admin can
  /// read. Until then their read is refused, and the panel says so
  /// (`LiveLocationStop.denied`) instead of spinning.
  ///
  /// Best-effort, and never fatal: the allowlist itself needs no mirror and
  /// cannot be locked out of itself.
  Future<void> registerReader({required String uid, required bool allowlisted}) async {
    final db = _database;
    if (db == null || !allowlisted) return;
    try {
      await db.ref('$kLiveLocationAdmins/$uid').set(true);
      final admins = await _firestore.collection(kProfiles).where('role', isEqualTo: 'admin').get();
      for (final profile in admins.docs) {
        final id = profile.id;
        if (id.isEmpty) continue;
        await db.ref('$kLiveLocationAdmins/$id').set(true);
      }
    } catch (error) {
      debugPrint('[live-location] could not register stream readers: $error');
    }
  }

  /// Follow one Guest's position for one conversation.
  ///
  /// The returned stream emits [LiveLocationView] frames — `noSession` while
  /// no consent is on record, `waiting` while the first fix is outstanding,
  /// `live` once one is accepted, and `ended` with a [LiveLocationStop] reason
  /// when the watch is over. It closes itself when the window closes — the
  /// Admin app is not left with a subscription outliving the consent that
  /// justified it.
  ///
  /// A missing node or a missing consent does NOT end the stream. The panel
  /// opens before the Guest's first fix (it is the panel that says "Waiting for
  /// the Guest's first position…"), and `startSharing` restarts a share with a
  /// delete-then-create of the consent, so both can be briefly absent while
  /// everything is working. Ending on absence is what left the old panel
  /// spinning forever on its first frame.
  Stream<LiveLocationView> watch({
    required String conversationId,
    String? guestUid,
  }) {
    final db = _database;
    if (db == null) {
      return Stream<LiveLocationView>.value(
        const LiveLocationView(LiveLocationPhase.ended, reason: LiveLocationStop.noTransport),
      );
    }
    final controller = StreamController<LiveLocationView>();
    StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? sessionSub;
    StreamSubscription<DatabaseEvent>? positionSub;
    Timer? expiry;
    var closed = false;
    LiveFix? lastFix;

    void emit(LiveLocationPhase phase) {
      if (closed || controller.isClosed) return;
      controller.add(LiveLocationView(phase, fix: lastFix));
    }

    void stop(LiveLocationStop reason) {
      if (closed) return;
      closed = true;
      expiry?.cancel();
      sessionSub?.cancel();
      positionSub?.cancel();
      if (!controller.isClosed) {
        controller.add(LiveLocationView(LiveLocationPhase.ended, fix: lastFix, reason: reason));
        controller.close();
      }
      debugPrint('[live-location] $conversationId: $reason');
    }

    sessionSub = _firestore.collection(kLocationSessions).doc(conversationId).snapshots().listen((snapshot) {
      if (closed) return;
      if (!snapshot.exists) {
        // No consent on record: the Guest has not started, or `startSharing` is
        // between the delete and the create of a restart. Keep listening — the
        // panel's "not sharing right now" is true in both cases, and flips back
        // when a session appears.
        emit(LiveLocationPhase.noSession);
        return;
      }
      final next = LiveLocationSession.fromDoc(snapshot);
      if (next == null) {
        stop(LiveLocationStop.foreign);
        return;
      }
      if (!next.isLive) {
        stop(LiveLocationStop.expired);
        return;
      }
      // The window closing ends the stream from the Admin's side too, without
      // waiting for the server to sweep the node.
      expiry?.cancel();
      expiry = Timer(next.remaining, () => stop(LiveLocationStop.expired));

      final target = guestUid ?? next.guestUid;
      positionSub?.cancel();
      emit(LiveLocationPhase.waiting);
      positionSub = db
          .ref('$kLiveLocationPath/$conversationId/$target')
          .onValue
          .listen((event) {
        if (closed) return;
        // `onValue` hands over a `DatabaseEvent`, which carries the snapshot
        // rather than being one (firebase_database 12).
        final data = event.snapshot.value;
        if (data == null) {
          // The node is absent: the first fix has not landed, or it was
          // removed. Absent is not "ended" — the consent listener owns that —
          // and it is certainly not a reason to tear the listener down and
          // never see the fix that is on its way.
          emit(lastFix == null ? LiveLocationPhase.waiting : LiveLocationPhase.live);
          return;
        }
        final fix = LiveFix.fromData(data, next);
        if (fix == null) {
          stop(LiveLocationStop.foreign);
          return;
        }
        lastFix = fix;
        emit(LiveLocationPhase.live);
      }, onError: (Object error) {
        debugPrint('[live-location] $conversationId: position stream error $error');
        stop(_isPermissionError(error) ? LiveLocationStop.denied : LiveLocationStop.offline);
      });
    }, onError: (Object error) {
      debugPrint('[live-location] $conversationId: session error $error');
      stop(_isPermissionError(error) ? LiveLocationStop.denied : LiveLocationStop.offline);
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

/// A refused read is a rules answer, not a network one: it says who is not
/// allowed, and the panel must say that rather than "check the connection".
bool _isPermissionError(Object error) {
  final code = error.toString().toLowerCase();
  return code.contains('permission') || code.contains('unauthorized') || code.contains('unauthenticated');
}
