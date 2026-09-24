// ----------------------------------------------------------------------------
// Erasing a Guest's KYC documents from Storage — the Admin's half of PurgeKyc.
//
// The lifecycle action (PurgeKyc) decides that the erasure is legal and writes
// the Activity entry; this file does the physical delete. The order is the
// point: the caller deletes the objects first and only logs the purge when
// both are gone, so the Activity log never claims an erasure that did not
// happen (the log is append-only — a false entry stays false forever).
//
// storage.rules is what makes this possible at all: the Admin's write grant on
// /kyc admits deletes and nothing else (a delete carries no resource).
// ----------------------------------------------------------------------------
import { deleteObject, ref } from 'firebase/storage'
import { isFirebaseConfigured, storage } from '../firebase'

export type PurgeOutcome =
  | { ok: true }
  | { ok: false; message: string }

/**
 * Delete the ID and/or receipt a Booking still carries.
 *
 * An object that is already gone counts as gone: a Guest who deleted their
 * own copy earlier (storage.rules lets them) has already done half the
 * erasure, and the Admin's purge finishes it and logs it. With no Firebase
 * there are no objects at all (demo mode never receives an upload, ADR-0004),
 * so there is nothing to delete and the purge is a no-op that still gets
 * logged by the caller.
 */
export async function purgeKycDocuments(urls: {
  id?: string | null
  receipt?: string | null
}): Promise<PurgeOutcome> {
  if (!isFirebaseConfigured || !storage) return { ok: true }

  for (const url of [urls.id, urls.receipt]) {
    if (!url) continue
    try {
      // The Booking stores the download URL; ref() reads the bucket and
      // object back out of it, so no second copy of the path is kept.
      await deleteObject(ref(storage, url))
    } catch (e: any) {
      if (e?.code === 'storage/object-not-found') continue
      console.warn('[KYC] purge delete failed', e)
      return {
        ok: false,
        message:
          'The ID could not be erased from Storage. Nothing was logged — try again, ' +
          'or delete the object in the Firebase console.',
      }
    }
  }

  return { ok: true }
}
