import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createHash } from 'node:crypto';
import { Actor, CaseRecord, Command, DAY, PolicyError, PrivateRecord, canRead, newCase, policyFrom, reduceCase, requireThat, text } from './domain';
import { CHUNK_SIZE, MAX_FILE, TYPES, validateEvidence } from './evidence';
import { calendarMonthsAfter, mayPurge, mayDeleteApprovedEvidence } from './privacy';
initializeApp();
const db = getFirestore();
const options = { region: 'asia-southeast1', maxInstances: 5, memory: '512MiB' as const, timeoutSeconds: 120 };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (value: unknown) => { requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'Invalid identifier.', 'invalid-argument'); return value; };
const bootstrap = ['haciendadeluisiana@gmail.com', 'gemaojohnreyarguilles@gmail.com'];
let privateBucketCheckedAt = 0;
async function evidenceBucket() {
  const bucket = getStorage().bucket(process.env.DISPUTE_EVIDENCE_BUCKET || undefined);
  if (!process.env.STORAGE_EMULATOR_HOST && Date.now() - privateBucketCheckedAt > 300_000) {
    const [metadata] = await bucket.getMetadata(); const [policy] = await bucket.iam.getPolicy();
    requireThat(metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled === true, 'Evidence bucket must use uniform bucket-level access.');
    requireThat(!(policy.bindings || []).some(binding => binding.members?.some(member => ['allUsers', 'allAuthenticatedUsers'].includes(member))), 'Evidence bucket must not grant public access.');
    privateBucketCheckedAt = Date.now();
  }
  return bucket;
}
function enabled() { requireThat(process.env.DISPUTES_ENABLED === 'true' || process.env.FUNCTIONS_EMULATOR === 'true', 'Dispute service is not enabled. Contact the Hacienda through official channels.'); }
async function actorFor(request: CallableRequest): Promise<Actor> {
  enabled();
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to report or track a case.');
  // Look up the current Auth account: revoked sessions and stale email claims cannot grant Admin.
  requireThat(request.auth.token.firebase?.sign_in_provider !== 'anonymous', 'Refresh your linked account session.', 'permission-denied');
  const user = await getAuth().getUser(request.auth.uid);
  requireThat(!user.disabled && user.providerData.length > 0, 'Link this anonymous identity to a recoverable account before continuing.', 'permission-denied');
  requireThat(user.tokensValidAfterTime === undefined || Number(request.auth.token.auth_time) >= Math.floor(Date.parse(user.tokensValidAfterTime) / 1000), 'Sign in again.', 'permission-denied');
  const profile = (await db.doc(`profiles/${user.uid}`).get()).data();
  const admin = (user.emailVerified && bootstrap.includes((user.email || '').toLowerCase())) || profile?.role === 'admin';
  const privacy = admin && (process.env.DISPUTE_PRIVACY_ADMINS || '').split(',').map(x => x.trim()).includes(user.uid);
  return { uid: user.uid, admin, privacy };
}
async function isAdminUid(uid: string) {
  try {
    const user = await getAuth().getUser(uid); const profile = (await db.doc(`profiles/${uid}`).get()).data();
    return !user.disabled && user.providerData.length > 0 && ((user.emailVerified && bootstrap.includes((user.email || '').toLowerCase())) || profile?.role === 'admin');
  } catch { return false; }
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
  return value;
}
function notify(tx: Transaction, key: string, c: CaseRecord, caseId: string, event: string, sender: string) {
  const recipients = new Set<string>(['admin']);
  if (c.assigned_to) recipients.add(c.assigned_to);
  if (c.reviewer_id) recipients.add(c.reviewer_id);
  if (c.visibility === 'guest' && c.guest_id && !['note', 'hold', 'priority', 'assign', 'evidence_decision', 'link'].includes(event)) recipients.add(c.guest_id);
  recipients.delete(sender);
  for (const user of recipients) tx.set(db.doc(`caseNotifications/${hash(key + ':' + user)}`), {
    user_id: user, case_id: caseId, reference: c.reference, type: event,
    title: `Case ${c.reference}`, message: 'There is an update requiring your attention. Open the case for details.',
    created_at: Date.now(), read_by: [],
  });
}
async function protect<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof PolicyError) throw new HttpsError(error.code, error.message);
    // Do not leak SDK paths, private data or scanner diagnostics to clients/logs.
    console.error('dispute command failed', error instanceof Error ? error.name : 'unknown');
    throw new HttpsError('internal', 'The action could not be completed. Retry with the same operation identifier.');
  }
}
export const disputeCommand = onCall(options, request => protect(async () => {
  const a = await actorFor(request); const cmd = request.data as Command;
  requireThat(cmd && typeof cmd === 'object', 'Command required.', 'invalid-argument');
  const operationId = id(cmd.operationId); requireThat(operationId.length >= 8, 'Operation identifier too short.', 'invalid-argument'); const opKey = hash(a.uid + ':' + operationId);
  const fingerprint = hash(JSON.stringify(normalize(cmd))); const now = Date.now();
  const creates = cmd.action === 'create'; const caseId = creates ? opKey : id(cmd.caseId);
  const ref = db.doc(`cases/${caseId}`); const priv = db.doc(`casePrivate/${caseId}`); const receipt = db.doc(`caseOperations/${opKey}`);
  const targetAdmin = cmd.targetUid ? await isAdminUid(id(cmd.targetUid)) : false;
  return db.runTransaction(async tx => {
    const done = await tx.get(receipt);
    if (done.exists) { requireThat(done.data()!.fingerprint === fingerprint, 'Operation identifier was already used for a different action.', 'invalid-argument'); return done.data()!.result; }
    const config = (await tx.get(db.doc('casePolicy/current'))).data() || {};
    const policy = policyFrom(config);
    const quotaRef = db.doc(`caseRateLimits/${hash(a.uid + ':' + Math.floor(now / DAY))}`);
    const quota = (await tx.get(quotaRef)).data() || { creates: 0, actions: 0 };
    requireThat(quota.actions < 300 && (!creates || quota.creates < 10), 'Daily case action limit reached. Contact official support for urgent matters.', 'resource-exhausted');
    let c: CaseRecord; let p: PrivateRecord; let publicText: string | null = null; let privateText: string | null = null;
    let targetEvidence: FirebaseFirestore.DocumentSnapshot | undefined;
    requireThat(cmd.attachmentIds === undefined || Array.isArray(cmd.attachmentIds), 'Attachment IDs must be a list.', 'invalid-argument');
    const attachments = Array.isArray(cmd.attachmentIds) ? cmd.attachmentIds : [];
    requireThat(attachments.length <= 5 && new Set(attachments).size === attachments.length, 'At most five distinct attachments per message.', 'invalid-argument');
    requireThat(!attachments.length || cmd.action === 'message', 'Attach evidence to a message.', 'invalid-argument');
    const evidenceDocs = await Promise.all(attachments.map(evidenceId => tx.get(db.doc(`caseUploads/${id(evidenceId)}`))));
    if (cmd.evidenceId) targetEvidence = await tx.get(db.doc(`caseUploads/${id(cmd.evidenceId)}`));
    if (creates) {
      requireThat(!attachments.length, 'Create the case before uploading evidence.');
      requireThat(!(await tx.get(ref)).exists, 'This case already exists. Refresh the case list; do not recreate it.');
      const year = new Date(now).getUTCFullYear(); const counterRef = db.doc(`caseCounters/${year}`);
      const counter = await tx.get(counterRef); const sequence = (counter.data()?.sequence || 0) + 1;
      c = newCase(cmd, a, now, `HDL-${year}-${String(sequence).padStart(6, '0')}`, policy);
      p = { participants: [], hold: false, hold_reason: null, hold_review_at: null, reopening_requested: false, request_reason: null, source_case: null };
      if (cmd.bookingId) {
        const booking = (await tx.get(db.doc(`bookings/${id(cmd.bookingId)}`))).data();
        requireThat(booking && (a.admin || booking.uid === a.uid), 'Booking ownership could not be verified.', 'permission-denied');
        c.accommodation = typeof booking.accommodation === 'string' ? booking.accommodation : null;
        if (a.admin && c.visibility === 'guest') { requireThat(typeof booking.uid === 'string', 'Booking has no verified owner.'); c.guest_id = booking.uid; }
      }
      if (a.admin && c.visibility === 'guest') {
        requireThat(cmd.bookingId && c.guest_id, 'Admin-created guest cases must use a verified booking.');
        const owner = await getAuth().getUser(c.guest_id); requireThat(!owner.disabled && owner.providerData.length > 0, 'Link/verify the Guest account before sharing.');
      }
      if (cmd.sourceCase) {
        requireThat(a.admin && c.visibility === 'guest', 'Only Admins may share an operational report.', 'permission-denied');
        const source = (await tx.get(db.doc(`cases/${id(cmd.sourceCase)}`))).data() as CaseRecord | undefined;
        requireThat(source && source.visibility === 'internal' && source.booking_id === c.booking_id, 'Share only a linked operational report.');
        p.source_case = cmd.sourceCase;
      }
      publicText = c.visibility === 'guest' ? c.description : null;
      // Counter committed with all other writes below.
      c.reference = `HDL-${year}-${String(sequence).padStart(6, '0')}`;
    } else {
      const snapshot = await tx.get(ref); const secret = await tx.get(priv);
      requireThat(snapshot.exists && secret.exists, 'Case not found or not migrated.');
      const original = snapshot.data() as CaseRecord; const originalPrivate = secret.data() as PrivateRecord;
      let duplicate: CaseRecord | undefined;
      if (cmd.targetCase) {
        requireThat(cmd.targetCase !== caseId, 'A case cannot duplicate itself.');
        duplicate = (await tx.get(db.doc(`cases/${id(cmd.targetCase)}`))).data() as CaseRecord | undefined;
      }
      const result = reduceCase(original, originalPrivate, cmd, a, now, { targetIsAdmin: targetAdmin, duplicate, policy });
      c = result.record; p = result.privateRecord; publicText = result.publicText; privateText = result.privateText;
      for (const file of evidenceDocs) {
        const data = file.data();
        requireThat(data && data.case_id === caseId && data.owner === a.uid && data.state === 'ready' && data.expires_at > now && !data.restricted, 'An attachment is unavailable or validation is incomplete.');
      }
      if (['evidence_request', 'evidence_decision'].includes(cmd.action)) {
        const evidence = targetEvidence?.data();
        requireThat(evidence && evidence.case_id === caseId && evidence.state === 'attached', 'Submitted evidence not found.');
        if (cmd.action === 'evidence_request') requireThat(evidence.owner === a.uid, 'Only the uploader can request withdrawal.', 'permission-denied');
        if (cmd.action === 'evidence_decision') {
          requireThat(typeof cmd.restricted === 'boolean', 'Specify evidence restriction.', 'invalid-argument');
          requireThat(!cmd.completed || !p.hold, 'A legal hold prevents deletion.');
        }
      }
    }
    if (['resolve', 'final_decision', 'complete_remedy', 'propose'].includes(cmd.action) && cmd.completed === true && ['payment', 'charges_refunds'].includes(c.category)) {
      // No money is executed here. A reasoned no-remedy decision or an existing
      // Booking Activity reference/external execution confirmation must be explicit.
      const proof = text(cmd.executionRef, 10, 500);
      if (proof.startsWith('booking-activity:')) {
        const activityId = id(proof.slice('booking-activity:'.length));
        requireThat(c.booking_id, 'A Booking Activity reference requires a linked Booking.');
        const execution = (await tx.get(db.doc(`bookings/${c.booking_id}/activity/${activityId}`))).data();
        const booking = (await tx.get(db.doc(`bookings/${c.booking_id}`))).data();
        requireThat(execution && (execution.actor_role === 'admin' || execution.actor === 'admin') && execution.booking_id === c.booking_id, 'Existing authorized Booking Activity not found.');
        requireThat((execution.action === 'MarkRefunded' && booking?.refund_status === 'refunded') || (['Approve', 'VerifyPayment'].includes(execution.action) && booking?.payment_status === 'verified') || (execution.action === 'Cancel' && booking?.status === 'Cancelled'), 'The Booking must show the financial action actually completed.');
      } else requireThat((proof.startsWith('external:') && proof.slice(9).trim().length >= 10) || (cmd.action !== 'complete_remedy' && proof.startsWith('no-remedy:') && proof.slice(10).trim().length >= 10), 'Use booking-activity:<id>, external:<execution reference>, or no-remedy:<decision basis>, with an adequate explanation.');
      privateText = [privateText, `Execution / determination reference: ${proof}`].filter(Boolean).join('\n');
    }
    if (['propose', 'final_decision', 'resolve'].includes(cmd.action)) {
      const restricted = await tx.get(ref.collection('evidence').where('restricted', '==', true).limit(1));
      if (!restricted.empty) requireThat(typeof cmd.summary === 'string' && cmd.summary.trim().length >= 20, 'A privacy-safe summary is required when restricted evidence exists. Do not decide on undisclosed allegations.');
      if (cmd.summary) publicText = `${publicText || ''}\nPrivacy-safe evidence summary: ${text(cmd.summary, 20)}`;
    }
    // All transaction reads are above this line.
    if (creates) tx.set(db.doc(`caseCounters/${new Date(now).getUTCFullYear()}`), { sequence: Number(c.reference.split('-').at(-1)) });
    tx.set(ref, c); tx.set(priv, p);
    const activity = { action: cmd.action, actor_uid: a.uid, actor_role: a.admin ? 'admin' : 'guest', created_at: now, version: c.version,
      text: publicText, attachment_ids: attachments, status: c.status };
    tx.create(ref.collection('activity').doc(opKey), activity);
    if (privateText) tx.create(priv.collection('notes').doc(opKey), { action: cmd.action, text: privateText, actor_uid: a.uid, created_at: now, target_uid: cmd.targetUid || null });
    for (const file of evidenceDocs) {
      const data = file.data()!;
      tx.update(file.ref, { state: 'attached', attached_at: now, activity_id: opKey, expires_at: null });
      tx.create(ref.collection('evidence').doc(file.id), { name: data.name, type: data.type, size: data.size, owner: a.uid, restricted: false, created_at: now });
    }
    if (targetEvidence && ['evidence_request', 'evidence_decision'].includes(cmd.action)) {
      const restrict = cmd.action === 'evidence_request' || cmd.restricted === true || cmd.completed === true;
      tx.update(targetEvidence.ref, { restricted: restrict, withdrawal_requested: cmd.action === 'evidence_request', delete_requested: cmd.action === 'evidence_decision' && cmd.completed === true });
      tx.update(ref.collection('evidence').doc(targetEvidence.id), { restricted: restrict, name: restrict ? '[Restricted evidence]' : targetEvidence.data()!.name });
    }
    tx.set(quotaRef, { creates: quota.creates + (creates ? 1 : 0), actions: quota.actions + 1, expires_at: now + 2 * DAY });
    notify(tx, opKey, c, caseId, cmd.action, a.uid);
    const result = { caseId, reference: c.reference, version: c.version };
    tx.create(receipt, { fingerprint, result, created_at: now, expires_at: calendarMonthsAfter(now, 24) });
    return result;
  });
}));

export const disputeEvidence = onCall({ ...options, concurrency: 1 }, request => protect(async () => {
  const a = await actorFor(request); const input = request.data || {}; const now = Date.now();
  if (input.action === 'begin') {
    const caseId = id(input.caseId); const uploadId = hash(a.uid + ':' + id(input.operationId));
    const fileSize = Number(input.size); const type = text(input.type, 1, 100); const name = text(input.name, 1, 160).replace(/[\x00-\x1f/\\]/g, '_');
    requireThat(Number.isInteger(fileSize) && fileSize > 0 && fileSize <= MAX_FILE && TYPES.includes(type), 'Allowed: JPEG, PNG, WebP, PDF, at most 10 MB.', 'invalid-argument');
    if (type === 'application/pdf') requireThat(process.env.CLAMAV_HOST, 'PDF scanning is unavailable. Upload an image instead.');
    return db.runTransaction(async tx => {
      const ref = db.doc(`caseUploads/${uploadId}`); const existing = await tx.get(ref); const cRef = db.doc(`cases/${caseId}`); const snap = await tx.get(cRef); const c = snap.data() as CaseRecord;
      const privateState = (await tx.get(db.doc(`casePrivate/${caseId}`))).data();
      requireThat(!privateState?.retention_lock, 'Privacy cleanup is in progress.');
      requireThat(c && canRead(c, a) && !['resolved', 'closed'].includes(c.status), 'Active case access required.', 'permission-denied');
      if (existing.exists) { const e = existing.data()!; requireThat(e.case_id === caseId && (e.declared_size ?? e.size) === fileSize && (e.declared_type ?? e.type) === type && e.name === name, 'Upload identifier already used.'); requireThat(!['expired', 'expiring', 'deleted'].includes(e.state), 'Upload expired. Select the file again to start a new upload.'); return { uploadId, chunkSize: CHUNK_SIZE }; }
      requireThat(input.expectedVersion === c.version, 'Case changed. Refresh before uploading.', 'aborted');
      requireThat(c.attachment_count < 50, 'Case attachment limit reached.', 'resource-exhausted');
      tx.create(ref, { owner: a.uid, case_id: caseId, name, type, size: fileSize, declared_size: fileSize, declared_type: type, state: 'uploading', restricted: false, created_at: now, expires_at: now + DAY });
      tx.update(cRef, { attachment_count: c.attachment_count + 1 });
      return { uploadId, chunkSize: CHUNK_SIZE };
    });
  }
  const uploadId = id(input.uploadId); const ref = db.doc(`caseUploads/${uploadId}`); const file = (await ref.get()).data();
  requireThat(file, 'Evidence not found.'); const c = (await db.doc(`cases/${file.case_id}`).get()).data() as CaseRecord;
  requireThat(c && canRead(c, a), 'Evidence access denied.', 'permission-denied');
  if (input.action === 'download') {
    requireThat(file.state === 'attached' && !file.delete_requested, 'Evidence unavailable.');
    if (file.restricted) {
      requireThat(a.admin && (a.privacy || (c.independent_review ? c.reviewer_id : c.assigned_to) === a.uid), 'Restricted evidence requires a designated reviewer.', 'permission-denied');
      await db.doc(`casePrivate/${file.case_id}`).collection('notes').add({ action: 'restricted_evidence_access', actor_uid: a.uid, evidence_id: uploadId, created_at: now, text: 'Restricted evidence accessed.' });
    }
    const [bytes] = await (await evidenceBucket()).file(`caseEvidence/${file.case_id}/${uploadId}/validated`).download();
    return { base64: bytes.toString('base64'), type: file.type, name: file.name };
  }
  requireThat(file.owner === a.uid && file.expires_at > now && !['resolved', 'closed'].includes(c.status), 'Upload expired or case is inactive.', 'permission-denied');
  const prefix = `caseEvidence/${file.case_id}/${uploadId}`;
  if (input.action === 'chunk') {
    requireThat(file.state === 'uploading', 'Upload is already validated.');
    requireThat(Number.isInteger(input.index) && input.index >= 0 && input.index < Math.ceil(file.size / CHUNK_SIZE), 'Invalid chunk index.', 'invalid-argument');
    requireThat(typeof input.base64 === 'string' && input.base64.length <= CHUNK_SIZE * 4 / 3 + 8 && /^[A-Za-z0-9+/]*={0,2}$/.test(input.base64), 'Invalid upload chunk.', 'invalid-argument');
    const bytes = Buffer.from(input.base64, 'base64'); const expected = Math.min(CHUNK_SIZE, file.size - input.index * CHUNK_SIZE);
    requireThat(bytes.length === expected, 'Incomplete upload chunk.', 'invalid-argument');
    const object = (await evidenceBucket()).file(`${prefix}/chunks/${input.index}`);
    try { await object.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream', metadata: { sha256: hash(bytes.toString('base64')) } } }); }
    catch (error) { if ((error as { code?: number }).code !== 412) throw error; const [existing] = await object.download(); requireThat(existing.equals(bytes), 'Chunk retry contains different bytes.', 'invalid-argument'); }
    return { ok: true };
  }
  requireThat(input.action === 'finalize', 'Unknown evidence action.', 'invalid-argument');
  if (file.state === 'ready') return { uploadId };
  requireThat(file.state === 'uploading', 'Upload is no longer available.');
  const buffers: Buffer[] = [];
  for (let i = 0; i < Math.ceil(file.size / CHUNK_SIZE); i++) buffers.push((await (await evidenceBucket()).file(`${prefix}/chunks/${i}`).download())[0]);
  const original = Buffer.concat(buffers); requireThat(original.length === file.size, 'Incomplete upload.');
  const validated = await validateEvidence(original, file.type);
  await (await evidenceBucket()).file(`${prefix}/validated`).save(validated.bytes, { resumable: false, metadata: { contentType: validated.type, cacheControl: 'no-store' } });
  try { await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data(); const caseNow = (await tx.get(db.doc(`cases/${file.case_id}`))).data() as CaseRecord;
    requireThat(current?.state === 'uploading' || current?.state === 'ready', 'Upload is no longer pending.');
    requireThat(current.expires_at > Date.now() && caseNow && !['resolved', 'closed'].includes(caseNow.status), 'Upload expired or case became inactive.');
    tx.update(ref, { state: 'ready', type: validated.type, size: validated.bytes.length, validated_at: Date.now() });
  }); } catch (error) {
    const current = (await ref.get()).data();
    if (!current || ['expired', 'expiring'].includes(current.state)) await (await evidenceBucket()).deleteFiles({ prefix: `${prefix}/` });
    throw error;
  }
  await (await evidenceBucket()).deleteFiles({ prefix: `${prefix}/chunks/` });
  return { uploadId };
}));

/** Persistent inbox, scoped by server. Shared Admin notifications have per-user read state. */
export const disputeInbox = onCall(options, request => protect(async () => {
  const a = await actorFor(request); const input = request.data || {};
  if (input.action === 'read') {
    const ref = db.doc(`caseNotifications/${id(input.notificationId)}`);
    await db.runTransaction(async tx => {
      const item = (await tx.get(ref)).data(); requireThat(item && (item.user_id === a.uid || (a.admin && item.user_id === 'admin')), 'Notification access denied.', 'permission-denied');
      tx.update(ref, { read_by: FieldValue.arrayUnion(a.uid) });
    }); return { ok: true };
  }
  const ids = a.admin ? [a.uid, 'admin'] : [a.uid];
  let query = db.collection('caseNotifications').where('user_id', 'in', ids).orderBy('created_at', 'desc').limit(50);
  if (input.cursor) { const cursor = await db.doc(`caseNotifications/${id(input.cursor)}`).get(); requireThat(cursor.exists && ids.includes(cursor.data()!.user_id), 'Invalid inbox cursor.', 'permission-denied'); query = query.startAfter(cursor); }
  const items = await query.get();
  return { items: items.docs.map(d => ({ id: d.id, user_id: d.data().user_id, case_id: d.data().case_id, reference: d.data().reference, type: d.data().type, title: d.data().title, message: d.data().message, created_at: d.data().created_at, read: (d.data().read_by || []).includes(a.uid) })) };
}));

export const disputeDirectory = onCall(options, request => protect(async () => {
  const a = await actorFor(request); requireThat(a.admin, 'Admin required.', 'permission-denied');
  const profiles = await db.collection('profiles').where('role', '==', 'admin').limit(100).get();
  const uids = new Set(profiles.docs.map(d => d.id));
  for (const email of bootstrap) { try { uids.add((await getAuth().getUserByEmail(email)).uid); } catch { /* not provisioned */ } }
  const admins: { uid: string; name: string }[] = [];
  for (const uid of uids) if (await isAdminUid(uid)) {
    const user = await getAuth().getUser(uid); admins.push({ uid, name: user.displayName || user.email || uid });
  }
  return { admins, privacy: a.privacy };
}));

/** Off by default until retention/legal and deployment approval. No production data touched by source changes. */
export const disputeMaintenance = onSchedule({ ...options, schedule: 'every 60 minutes', timeZone: 'Asia/Manila' }, async () => {
  if (process.env.DISPUTES_ENABLED !== 'true') return;
  const now = Date.now(); const config = (await db.doc('casePolicy/current').get()).data() || {};
  // Bounded batches. Repeated runs advance because sent timestamps/deletion markers are persisted.
  const alerts = await db.collection('cases').where('next_alert_at', '<=', now).orderBy('next_alert_at').limit(100).get();
  for (const snapshot of alerts.docs) await db.runTransaction(async tx => {
    const fresh = await tx.get(snapshot.ref); const c = fresh.data() as CaseRecord;
    if (!c || ['closed', 'resolved'].includes(c.status)) return;
    const isDue = c.due_at !== null && c.due_at <= now && c.due_notified_for !== c.due_at;
    const isReminder = c.reminder_at !== null && c.reminder_at <= now && c.reminder_notified_for !== c.reminder_at;
    if (!isDue && !isReminder) return;
    const kind = isDue ? 'overdue' : 'reminder'; const stamp = isDue ? c.due_at : c.reminder_at;
    notify(tx, `deadline:${snapshot.id}:${kind}:${stamp}`, c, snapshot.id, kind, 'system');
    if (isDue) c.due_notified_for = c.due_at;
    if (isReminder) c.reminder_notified_for = c.reminder_at;
    const future = [c.due_at !== c.due_notified_for ? c.due_at : null, c.reminder_at !== c.reminder_notified_for ? c.reminder_at : null].filter((n): n is number => n !== null);
    tx.update(snapshot.ref, { due_notified_for: c.due_notified_for, reminder_notified_for: c.reminder_notified_for, next_alert_at: future.length ? Math.min(...future) : null });
  });
  const pending = await db.collection('caseUploads').where('expires_at', '<=', now).orderBy('expires_at').limit(100).get();
  for (const upload of pending.docs) {
    const data = upload.data(); if (data.state === 'attached' || data.state === 'expired') { await upload.ref.update({ expires_at: null }); continue; }
    // Hold/cleanup checks and the per-file lock are in the same transaction.
    // A hold cannot slip in between authorization and irreversible byte removal.
    const privateRef = db.doc(`casePrivate/${data.case_id}`);
    const claimed = await db.runTransaction(async tx => {
      const current = (await tx.get(upload.ref)).data(); const cRef = db.doc(`cases/${data.case_id}`); const c = (await tx.get(cRef)).data();
      const p = (await tx.get(privateRef)).data() as PrivateRecord | undefined;
      if (!current || !['uploading', 'ready', 'expiring'].includes(current.state)) return null;
      // Orphan uploads may be cleaned; a case missing its private policy must
      // instead be quarantined, never assumed to have no hold.
      if ((c && !p) || (p && !mayDeleteApprovedEvidence(p, upload.id))) return null;
      tx.update(upload.ref, { state: 'expiring' });
      if (p) tx.update(privateRef, { retention_lock: true, privacy_deleting: upload.id });
      if (current.state !== 'expiring' && c) tx.update(cRef, { attachment_count: Math.max(0, c.attachment_count - 1) });
      return { privateLocked: !!p };
    });
    if (!claimed) continue;
    await (await evidenceBucket()).deleteFiles({ prefix: `caseEvidence/${data.case_id}/${upload.id}/` });
    await db.runTransaction(async tx => {
      const p = claimed.privateLocked ? (await tx.get(privateRef)).data() : undefined;
      if (claimed.privateLocked) requireThat(p?.privacy_deleting === upload.id && !p?.hold, 'Expiry cleanup lock lost.');
      tx.update(upload.ref, { state: 'expired', expires_at: null });
      if (claimed.privateLocked) tx.update(privateRef, { retention_lock: false, privacy_deleting: null });
    });
  }
  const deletions = await db.collection('caseUploads').where('delete_requested', '==', true).limit(50).get();
  for (const item of deletions.docs) {
    const file = item.data(); const privateRef = db.doc(`casePrivate/${file.case_id}`);
    const claimed = await db.runTransaction(async tx => {
      const p = (await tx.get(privateRef)).data(); const e = (await tx.get(item.ref)).data();
      if (!e?.delete_requested || !mayDeleteApprovedEvidence(p as PrivateRecord | undefined, item.id)) return false;
      tx.update(privateRef, { retention_lock: true, privacy_deleting: item.id }); return true;
    });
    if (!claimed) continue;
    await (await evidenceBucket()).deleteFiles({ prefix: `caseEvidence/${file.case_id}/${item.id}/` });
    await db.runTransaction(async tx => {
      const p = (await tx.get(privateRef)).data(); requireThat(p?.privacy_deleting === item.id && !p?.hold, 'Privacy deletion lock lost.');
      tx.update(item.ref, { delete_requested: false, state: 'deleted', name: '[Deleted by privacy review]' });
      tx.update(db.doc(`cases/${file.case_id}/evidence/${item.id}`), { restricted: true, deleted: true, name: '[Deleted by privacy review]' });
      tx.update(privateRef, { retention_lock: false, privacy_deleting: null });
    });
  }
  for (const collection of ['caseOperations', 'caseRateLimits']) {
    const expired = await db.collection(collection).where('expires_at', '<=', now).limit(100).get();
    for (const item of expired.docs) {
      const caseId = item.data().result?.caseId;
      if (caseId && (await db.doc(`cases/${caseId}`).get()).exists) await item.ref.update({ expires_at: now + 30 * DAY });
      else await item.ref.delete();
    }
  }
  if (config.retentionApproved !== true || process.env.DISPUTE_RETENTION_ENABLED !== 'true') return;
  const closed = await db.collection('cases').where('retention_due_at', '<=', now).orderBy('retention_due_at').limit(50).get();
  for (const candidate of closed.docs) {
    // Retention acquires a lock that commands check, preventing reopening/deletion races.
    const locked = await db.runTransaction(async tx => {
      const c = (await tx.get(candidate.ref)).data() as CaseRecord; const pRef = db.doc(`casePrivate/${candidate.id}`); const p = (await tx.get(pRef)).data();
      if (!mayPurge(c, p as PrivateRecord | undefined, now, 'content')) return false;
      tx.update(pRef, { retention_lock: true, retention_lease_until: now + 10 * 60_000 }); return true;
    });
    if (!locked) { await candidate.ref.update({ retention_due_at: now + DAY }); continue; }
    await (await evidenceBucket()).deleteFiles({ prefix: `caseEvidence/${candidate.id}/` });
    const uploads = await db.collection('caseUploads').where('case_id', '==', candidate.id).get();
    for (const upload of uploads.docs) await upload.ref.delete();
    const activities = await candidate.ref.collection('activity').get();
    // Keep minimal action signatures; remove correspondence, attachment metadata and full rationale.
    for (const activity of activities.docs) await activity.ref.update({ text: null, attachment_ids: [] });
    await db.recursiveDelete(candidate.ref.collection('evidence'));
    await db.recursiveDelete(db.doc(`casePrivate/${candidate.id}`).collection('notes'));
    await candidate.ref.update({ description: '[Removed under retention policy]', resolution: null, retention_due_at: null });
    await db.doc(`casePrivate/${candidate.id}`).update({ evidence_purged: true, retention_lock: false, retention_lease_until: 0, hold_reason: null, request_reason: null });
  }
  // A one-day conservative query margin covers leap-day clamping. mayPurge
  // re-checks the exact Manila anniversary before any destructive action.
  const minimalCutoff = calendarMonthsAfter(now, -24) + DAY;
  const maintenanceRef = db.doc('caseMaintenance/cursor'); const checkpoint = (await maintenanceRef.get()).data();
  let oldQuery = db.collection('cases').where('status', '==', 'closed').where('closed_at', '<=', minimalCutoff).orderBy('closed_at').orderBy('__name__').limit(50);
  if (checkpoint?.closed_at && checkpoint?.case_id) oldQuery = oldQuery.startAfter(checkpoint.closed_at, db.doc(`cases/${checkpoint.case_id}`));
  const old = await oldQuery.get();
  for (const candidate of old.docs) {
    const locked = await db.runTransaction(async tx => {
      const c = (await tx.get(candidate.ref)).data(); const pRef = db.doc(`casePrivate/${candidate.id}`); const p = (await tx.get(pRef)).data();
      if (!mayPurge(c as CaseRecord | undefined, p as PrivateRecord | undefined, now, 'minimal')) return false;
      tx.update(pRef, { retention_lock: true, retention_lease_until: now + 10 * 60_000 }); return true;
    });
    if (!locked) continue;
    await (await evidenceBucket()).deleteFiles({ prefix: `caseEvidence/${candidate.id}/` });
    await db.recursiveDelete(candidate.ref);
    await db.recursiveDelete(db.doc(`casePrivate/${candidate.id}`));
    const notifications = await db.collection('caseNotifications').where('case_id', '==', candidate.id).get();
    for (const notification of notifications.docs) await notification.ref.delete();
  }

  const last = old.docs.at(-1); await maintenanceRef.set(last ? { closed_at: last.data().closed_at, case_id: last.id } : { closed_at: null, case_id: null });

});
