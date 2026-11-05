// ----------------------------------------------------------------------------
// The one place the CARTO basemap key is set.
//
// The Admin app is a compiled binary. Any key it uses has to travel inside that
// binary, and anyone holding the APK can read it back out with `strings`. So
// "set the key in the app" and "publish the key" are the same act — there is no
// build of a mobile app where that is not true. What a key like this protects is
// not a secret; it lets CARTO see who is using the service and how much, so that
// a runaway client can be cut off without affecting everybody else's maps.
//
// Which is why this file has an obvious place to paste it, and why the risk is
// stated here rather than hidden:
//
//   * The key is free and its abuse costs quota, not money. The ceiling is one
//     million tile requests a month on the commercial tier; if it were exhausted
//     deliberately, the maps would draw watermarked until the month turned. No
//     invoice, no outage outside this one panel.
//   * CARTO's dashboard can rotate or delete a key without a code change
//     (`https://dashboard.basemaps.carto.com`). If a key ever needs pulling,
//     that is the switch.
//   * This repository is PUBLIC. A key pasted below is a key published. That was
//     weighed and accepted, because the alternative — a build that only works on
//     the machine that remembers a command-line flag — is the kind of thing that
//     fails the day somebody else builds the app, or the day the owner builds it
//     from a new laptop and cannot work out why the map is watermarked.
//
// If you would rather not publish it, use the build flag instead and leave the
// paste slot below empty:
//
//     flutter run --dart-define=CARTO_KEY=your-key
//     flutter run --dart-define-from-file=carto.json     # gitignored
//
// The build flag wins when both are present, so a shared machine or a CI build
// can override whatever is pasted here without editing any code.
// ----------------------------------------------------------------------------

/// Paste the key between the quotes. Nothing else in this file needs to change.
///
/// Free from <https://carto.com/basemaps/apikey/> — an email address, no account,
/// no approval queue, back in a minute. Leave it empty and the map still draws;
/// it is watermarked and says so.
const String kCartoKeyPasted = '';

/// The key supplied at build time, if any. See the note above.
const String kCartoKeyFromBuild = String.fromEnvironment('CARTO_KEY');

/// The key the tile layer actually uses.
///
/// The build flag takes precedence, so an override never requires an edit here
/// and never gets committed by accident.
String get cartoKey =>
    kCartoKeyFromBuild.isNotEmpty ? kCartoKeyFromBuild : kCartoKeyPasted;

/// True when a key came from either place.
bool get hasCartoKey => cartoKey.isNotEmpty;
