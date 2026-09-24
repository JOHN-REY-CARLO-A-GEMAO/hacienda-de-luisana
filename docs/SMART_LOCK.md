# ESP32 Smart Lock contract

Canonical collection: `access_logs` (see `firestore.rules`).

## Authentication

The lock gateway signs in with a Firebase Auth identity. Each log row **must** set `uid` to that identity. The rules refuse a row written in someone else's uid.

## Payload

```
{
  timestamp: ISO-8601 string,
  uid: string,          // writer
  ref_id: string,       // booking / credential reference
  result: "granted" | "denied",
  reason: string
}
```

## Authorization

Unlock **only** when the backend/app has a Reserved or in-stay booking for `ref_id` on today's stay dates. Unauthorized credentials must log `denied` and must not actuate the lock.

## Logging

Every attempt is append-mostly. Admins may correct rows; Guests cannot read other people's access logs.

Do not invent a second lock schema.
