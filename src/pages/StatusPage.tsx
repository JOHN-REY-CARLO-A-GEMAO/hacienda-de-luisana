import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { firebaseConfigReport, getFirebaseStatus } from '../lib/firebase'
import {
  describeSource,
  maskValue,
  type FieldReport,
  type FieldState,
} from '../lib/firebaseConfig'
import { lastIdentityFailure } from '../lib/guestAuth'
import { getSupabaseStatus, describeSupabaseSource, supabaseConfigReport } from '../lib/supabase'
import { runConnectionCheck, currentIdentity, type Check, type CheckStatus } from '../lib/connectionCheck'
import { Alert, Container, Page, PageHeader } from '../components/ui'

/**
 * Where the owner finds out why a deployment says "Demo mode".
 *
 * The silent failure this page exists for: a build without its Firebase
 * settings looks like a working website right up to the moment a Guest's
 * request never arrives. Everything here is build-time fact (which values the
 * build carries, and where each came from) plus one button that asks the live
 * project whether it will talk to this browser. Nothing on it is a secret:
 * a Firebase web config is public by design, and the API key is masked anyway.
 */

const STATE_LABEL: Record<FieldState, string> = {
  env: 'From the dashboard',
  default: 'Committed default',
  missing: 'Not set',
  invalid: 'Refused',
}

// One table of tones for both maps: the badge palette is the alert palette at
// badge size, so a value and a connection check agree on what green means.
const STATE_TONE: Record<FieldState, string> = {
  env: 'badge bg-emerald-50 text-emerald-700 border border-emerald-200',
  default: 'badge bg-sky-50 text-sky-700 border border-sky-200',
  missing: 'badge bg-amber-50 text-amber-800 border border-amber-200',
  invalid: 'badge bg-red-50 text-red-700 border border-red-200',
}

const CHECK_TONE: Record<CheckStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger',
  skip: 'info',
}

const CHECK_MARK: Record<CheckStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '✕',
  skip: '–',
}

export function StatusPage() {
  const status = getFirebaseStatus()
  const proofStorage = getSupabaseStatus()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [running, setRunning] = useState(false)
  const identity = currentIdentity()
  const identityFailure = lastIdentityFailure()
  const [showDemoDialog, setShowDemoDialog] = useState(false)

  const test = async () => {
    setRunning(true)
    try {
      setChecks(await runConnectionCheck())
    } finally {
      setRunning(false)
    }
  }

  return (
    <Page>
      <Container width="narrow">
        <PageHeader
          eyebrow="Deployment status"
          title="Is this website connected?"
          lead={
            <p>
              A Guest&rsquo;s Booking request either reaches the Hacienda&rsquo;s Firebase project — where the
              Admin app reads it — or it stays in the Guest&rsquo;s own browser. This page says which, and
              what to change if the answer is wrong.
            </p>
          }
        />

        {/* The verdict — the same alert shape every other page uses. */}
        <div className="mt-8 space-y-4">
          <Alert
            tone={status.configured ? 'success' : 'warning'}
            title={status.configured ? `Connected — ${status.projectId}` : 'Demo mode'}
          >
            <p>
              {status.configured
                ? 'Booking requests go to Firestore, where the Admin app reads them. Guests can sign in, upload their ID and follow their stay.'
                : 'Firebase not configured in this build. Booking requests are stored in this browser and never reach the Admin app.'}
            </p>
            <p className="mt-2 text-xs opacity-80">{describeSource(firebaseConfigReport.source)}</p>
            {!status.configured && status.missingRequired.length > 0 && (
              <p className="mt-2 text-xs">Missing: {status.missingRequired.join(', ')}</p>
            )}
            {status.emulators && (
              <p className="mt-2 text-xs">
                This build points at the local Emulator Suite — right for practice on a laptop, wrong for a
                real deployment.
              </p>
            )}
          </Alert>

          {/* The second half of the same question: does a Guest's receipt survive? */}
          <Alert
            tone={proofStorage.configured ? 'success' : 'danger'}
            title={
              proofStorage.configured
                ? `Payment proofs reach the Admin — bucket ${proofStorage.bucket}`
                : 'Payment proofs do NOT arrive'
            }
          >
            <p>
              {proofStorage.configured
                ? 'A Guest’s downpayment screenshot is uploaded to the storage bucket the Admin app reads, so every Booking in the review queue has a receipt behind it.'
                : 'No Supabase project in this build. Bookings would still be created, but each Guest’s screenshot would stay in that Guest’s own browser. The Admin would open a Pending booking pointing at a receipt that exists nowhere — and nothing on screen would report an error. This is the failure this page exists to make visible.'}
            </p>
            <p className="mt-2 text-xs opacity-80">{describeSupabaseSource(supabaseConfigReport.source)}</p>
            {proofStorage.refusedEnvKeys.length > 0 && (
              <p className="mt-2 text-xs">Set but refused: {proofStorage.refusedEnvKeys.join(', ')}</p>
            )}
          </Alert>
        </div>

        {/* Which value came from where */}
        <h2 className="h2 mt-12">Where each setting came from</h2>
        <p className="mt-2 text-xs text-forest-800/70 leading-relaxed">
          These are decided when the site is built, not when it is visited — a hosting dashboard change
          needs a redeploy before it appears here.
        </p>
        <div className="card-tight mt-4 overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Value</th>
                <th>Setting</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {firebaseConfigReport.fields.map((field: FieldReport) => (
                <tr key={field.field}>
                  <td>
                    <span className="font-medium text-forest-900">{field.field}</span>
                    {field.required && <span className="text-forest-600"> · required</span>}
                    <span className="block font-mono text-[11px] text-forest-700/80 break-all">
                      {field.value ? maskValue(field.value) : '—'}
                    </span>
                  </td>
                  <td className="font-mono text-[11px] break-all text-forest-700">{field.envKey}</td>
                  <td>
                    <span className={STATE_TONE[field.state]}>
                      {STATE_LABEL[field.state]}
                    </span>
                    {field.problem && (
                      <span className="mt-1 block text-[11px] text-forest-700/80">{field.problem}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ConfirmDialog visual preview */}
        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDemoDialog(true)}
            className="btn-ghost btn-sm"
          >
            Preview ConfirmDialog
          </button>
          <ConfirmDialog
            open={showDemoDialog}
            title="Withdraw this request?"
            body="Are you sure you want to withdraw request HDL-1234? Held dates will be released back into the pool."
            danger
            confirmLabel="Withdraw request"
            cancelLabel="Keep it"
            onConfirm={() => setShowDemoDialog(false)}
            onCancel={() => setShowDemoDialog(false)}
          />
        </div>

        {/* The live half */}
        <h2 className="h2 mt-12">Ask the project</h2>
        <p className="mt-2 text-xs text-forest-800/70 leading-relaxed">
          Signs this browser in anonymously — the same sign-in <Link to="/book" className="underline">/book</Link>{' '}
          performs when a request is sent — and reads the published rates. It writes nothing.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={test} disabled={running} className="btn-primary btn-sm">
            {running ? 'Checking…' : 'Test the connection'}
          </button>
          {identity && (
            <span className="text-[11px] text-forest-700/80">
              This browser: {identity.anonymous ? 'anonymous Guest' : identity.email ?? 'signed in'}{' '}
              ({identity.uid.slice(0, 8)}…)
            </span>
          )}
        </div>

        {checks && (
          <ul className="mt-4 space-y-3">
            {checks.map((check) => (
              <li key={check.id}>
                <Alert tone={CHECK_TONE[check.status]} className="text-xs">
                  <span className="font-semibold">
                    {CHECK_MARK[check.status]} {check.label}
                  </span>
                  <span className="mt-1 block">{check.detail}</span>
                </Alert>
              </li>
            ))}
          </ul>
        )}

        {identityFailure && (
          <Alert tone="warning" className="mt-4 text-xs" title="Last Guest identity attempt failed">
            [{identityFailure.code}] {identityFailure.advice}
          </Alert>
        )}

        {/* What to do about it */}
        <h2 className="h2 mt-8">If payment proofs do not arrive</h2>
        <ol className="mt-3 space-y-3 text-sm text-forest-800/90 leading-relaxed list-decimal pl-5">
          <li>
            On <strong>Vercel → the project → Settings → Environment Variables</strong>, add{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> (Supabase → Project Settings →
            API). Both are public by design; the <code className="font-mono text-xs">service_role</code> key
            never belongs in a <code className="font-mono text-xs">VITE_</code> variable.
          </li>
          <li>
            With no <code className="font-mono text-xs">VITE_SUPABASE_*</code> variables set, a production
            build falls back to the project committed in{' '}
            <code className="font-mono text-xs">src/lib/supabaseDefaults.ts</code>. The deploy workflow builds
            with <code className="font-mono text-xs">SUPABASE_ENV_STRICT=1</code>, so a build that cannot
            resolve a project <em>fails</em> rather than shipping one that loses receipts — if a deployment
            succeeded, this panel should be green.
          </li>
          <li>
            Green here means the bytes will be sent. Whether the bucket <em>accepts</em> them depends on the
            policies in <code className="font-mono text-xs">supabase/01-storage.sql</code> being applied to
            the project in the Supabase dashboard. An upload refused with{' '}
            <code className="font-mono text-xs">42501</code> means they are not, and no booking can be
            submitted until they are.
          </li>
        </ol>

        <h2 className="h2 mt-12">If it says Demo mode</h2>
        <ol className="mt-3 space-y-3 text-sm text-forest-800/90 leading-relaxed list-decimal pl-5">
          <li>
            On <strong>Vercel → the project → Settings → Environment Variables</strong>, add the six{' '}
            <code className="font-mono text-xs">VITE_FIREBASE_*</code> values from Firebase console →{' '}
            Project settings → Your apps → Web app, for <em>Production</em> and <em>Preview</em>.
          </li>
          <li>
            <strong>Redeploy.</strong> Vite reads those variables while building: changing one does nothing
            to a deployment that is already live.
          </li>
          <li>
            With no variables set at all, a production build falls back to the project committed in{' '}
            <code className="font-mono text-xs">src/lib/firebaseDefaults.ts</code>. If this page still says
            Demo mode, that build was made without Firebase at all — check the build log for the Firebase
            lines this repository prints.
          </li>
        </ol>

        <h2 className="h2 mt-12">If Guests cannot sign in</h2>
        <p className="mt-3 text-sm text-forest-800/90 leading-relaxed">
          Three switches in the Firebase console, none of which the website can reach:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-forest-800/90 leading-relaxed list-disc pl-5">
          <li>
            <strong>Authentication → Sign-in method</strong>: enable <em>Anonymous</em> (every booking form
            needs it), plus <em>Email/Password</em> and <em>Google</em>.
          </li>
          <li>
            <strong>Authentication → Settings → Authorized domains</strong>: add{' '}
            <code className="font-mono text-xs">hacienda-de-luisana.vercel.app</code>,{' '}
            <code className="font-mono text-xs">haciendadeluisana.com</code> and{' '}
            <code className="font-mono text-xs">www.haciendadeluisana.com</code>. A domain that is missing
            fails Google sign-in with <code className="font-mono text-xs">auth/unauthorized-domain</code>.
          </li>
          <li>
            <strong>firestore.rules</strong> deployed to the project:{' '}
            <code className="font-mono text-xs">firebase deploy --only firestore:rules,storage</code>.
          </li>
        </ul>

        <p className="mt-10 text-xs text-forest-700/70 leading-relaxed">
          Full walkthrough:{' '}
          <a
            className="underline"
            href="https://github.com/JOHN-REY-CARLO-A-GEMAO/hacienda-de-luisana/blob/main/docs/FIREBASE_SETUP.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/FIREBASE_SETUP.md
          </a>
          .
        </p>
      </Container>
    </Page>
  )
}
