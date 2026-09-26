import { useState } from 'react'
import { Link } from 'react-router-dom'
import { firebaseConfigReport, getFirebaseStatus } from '../lib/firebase'
import {
  describeSource,
  maskValue,
  type FieldReport,
  type FieldState,
} from '../lib/firebaseConfig'
import { lastIdentityFailure } from '../lib/guestAuth'
import { runConnectionCheck, currentIdentity, type Check, type CheckStatus } from '../lib/connectionCheck'

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

const STATE_TONE: Record<FieldState, string> = {
  env: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  default: 'bg-sky-50 text-sky-700 border-sky-200',
  missing: 'bg-amber-50 text-amber-800 border-amber-200',
  invalid: 'bg-red-50 text-red-700 border-red-200',
}

const CHECK_TONE: Record<CheckStatus, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  fail: 'bg-red-50 text-red-700 border-red-200',
  skip: 'bg-cream-100 text-forest-700 border-forest-900/10',
}

const CHECK_MARK: Record<CheckStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '✕',
  skip: '–',
}

export function StatusPage() {
  const status = getFirebaseStatus()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [running, setRunning] = useState(false)
  const identity = currentIdentity()
  const identityFailure = lastIdentityFailure()

  const test = async () => {
    setRunning(true)
    try {
      setChecks(await runConnectionCheck())
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="pt-28 pb-24 bg-cream-50 min-h-screen">
      <div className="mx-auto max-w-3xl px-5">
        <div className="eyebrow">Deployment status</div>
        <h1 className="display text-4xl sm:text-5xl mt-2 text-forest-900">Is this website connected?</h1>
        <p className="mt-4 text-forest-800/80 text-sm leading-relaxed">
          A Guest's Booking request either reaches the Hacienda's Firebase project — where the Admin app
          reads it — or it stays in the Guest's own browser. This page says which, and what to change if
          the answer is wrong.
        </p>

        {/* The verdict */}
        <div
          className={`mt-8 rounded-3xl border p-6 ${
            status.configured ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`text-[11px] uppercase tracking-eyebrow font-semibold ${
                status.configured ? 'text-emerald-800' : 'text-amber-800'
              }`}
            >
              {status.configured ? 'Connected' : 'Demo mode'}
            </span>
            <span className="text-xs text-forest-700/70">
              {status.configured
                ? `Firebase project ${status.projectId}`
                : 'Firebase not configured in this build'}
            </span>
          </div>
          <p className="mt-2 text-sm text-forest-800/90 leading-relaxed">
            {status.configured
              ? 'Booking requests go to Firestore, where the Admin app reads them. Guests can sign in, upload their ID and follow their stay.'
              : 'Booking requests are stored in this browser and never reach the Admin app.'}
          </p>
          <p className="mt-2 text-xs text-forest-800/70 leading-relaxed">
            {describeSource(firebaseConfigReport.source)}
          </p>
          {!status.configured && status.missingRequired.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Missing: {status.missingRequired.join(', ')}
            </p>
          )}
          {status.emulators && (
            <p className="mt-2 text-xs text-amber-800">
              This build points at the local Emulator Suite — right for practice on a laptop, wrong for a
              real deployment.
            </p>
          )}
        </div>

        {/* Which value came from where */}
        <h2 className="font-serif text-2xl mt-12 text-forest-900">Where each setting came from</h2>
        <p className="mt-2 text-xs text-forest-800/70 leading-relaxed">
          These are decided when the site is built, not when it is visited — a hosting dashboard change
          needs a redeploy before it appears here.
        </p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-forest-900/10 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-cream-100 text-forest-700">
              <tr>
                <th className="px-4 py-2 font-semibold">Value</th>
                <th className="px-4 py-2 font-semibold">Setting</th>
                <th className="px-4 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {firebaseConfigReport.fields.map((field: FieldReport) => (
                <tr key={field.field} className="border-t border-forest-900/5">
                  <td className="px-4 py-2 align-top">
                    <span className="font-medium text-forest-900">{field.field}</span>
                    {field.required && <span className="text-forest-600"> · required</span>}
                    <span className="block font-mono text-[11px] text-forest-700/80 break-all">
                      {field.value ? maskValue(field.value) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2 align-top font-mono text-[11px] text-forest-700 break-all">
                    {field.envKey}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 ${STATE_TONE[field.state]}`}
                    >
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

        {/* The live half */}
        <h2 className="font-serif text-2xl mt-12 text-forest-900">Ask the project</h2>
        <p className="mt-2 text-xs text-forest-800/70 leading-relaxed">
          Signs this browser in anonymously — the same sign-in <Link to="/book" className="underline">/book</Link>{' '}
          performs when a request is sent — and reads the published rates. It writes nothing.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={test} disabled={running} className="btn-primary text-xs">
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
              <li
                key={check.id}
                className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${CHECK_TONE[check.status]}`}
              >
                <span className="font-semibold">
                  {CHECK_MARK[check.status]} {check.label}
                </span>
                <span className="mt-1 block">{check.detail}</span>
              </li>
            ))}
          </ul>
        )}

        {identityFailure && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <span className="font-semibold">Last Guest identity attempt failed</span>
            <span className="mt-1 block">
              [{identityFailure.code}] {identityFailure.advice}
            </span>
          </div>
        )}

        {/* What to do about it */}
        <h2 className="font-serif text-2xl mt-12 text-forest-900">If it says Demo mode</h2>
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

        <h2 className="font-serif text-2xl mt-12 text-forest-900">If Guests cannot sign in</h2>
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
      </div>
    </div>
  )
}
