## 2026-10-11 - Restrict Granted Physical Access Log Creation to Admins
**Vulnerability:** Any authenticated guest user could write `access_logs` entries with `result: 'granted'`, forging physical access / door unlock events.
**Learning:** `access_logs` creation rules previously only validated field presence, `uid == request.auth.uid`, and `result in ['granted', 'denied']`. Because `result: 'granted'` triggers check-in cues and physical access events, allowing non-admin clients to report `granted` events represents a critical security risk.
**Prevention:** In Firestore rules for access / physical entry logs, restrict `result == 'granted'` creation to verified administrative roles (`isAdmin()`), allowing general users to log `result == 'denied'` events only.
