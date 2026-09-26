// Which Firebase project a build talks to — the decision, asserted.
//
// This is the seam where a mistake is invisible: a deployment without a project
// is a website that looks finished and quietly keeps Guest bookings in their own
// browser. So every branch of the order — variables, committed project, nothing —
// is a case here, and so is every way a value can arrive wrong (a placeholder, a
// quoted paste, a key that is not a Firebase key).
import {
  describeSource,
  fieldReport,
  isApiKeyLike,
  isUsableValue,
  maskValue,
  readEnvValue,
  resolveFirebaseConfig,
  type FirebaseConfig,
} from '../../src/lib/firebaseConfig'
import { COMMITTED_PROJECT } from '../../src/lib/firebaseDefaults'

const EMPTY: FirebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
  measurementId: '',
}

const REAL: FirebaseConfig = {
  apiKey: 'AIzaSyA-this-is-a-key-value-1234567890',
  authDomain: 'hacienda-de-luisana.firebaseapp.com',
  projectId: 'hacienda-de-luisana',
  storageBucket: 'hacienda-de-luisana.firebasestorage.app',
  messagingSenderId: '648433185',
  appId: '1:648433185:web:abcdef',
  measurementId: 'G-ABCDEF',
}

const FULL_ENV = {
  VITE_FIREBASE_API_KEY: REAL.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: REAL.authDomain,
  VITE_FIREBASE_PROJECT_ID: REAL.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: REAL.storageBucket,
  VITE_FIREBASE_MESSAGING_SENDER_ID: REAL.messagingSenderId,
  VITE_FIREBASE_APP_ID: REAL.appId,
  VITE_FIREBASE_MEASUREMENT_ID: REAL.measurementId,
}

describe('reading a value out of the environment', () => {
  it('trims, unquotes and treats an empty string as absent', () => {
    expect(readEnvValue('  AIza123  ')).toBe('AIza123')
    expect(readEnvValue('"AIza123"')).toBe('AIza123')
    expect(readEnvValue("'AIza123'")).toBe('AIza123')
    expect(readEnvValue('   ')).toBeUndefined()
    expect(readEnvValue(undefined)).toBeUndefined()
    expect(readEnvValue(42)).toBeUndefined()
  })

  it('refuses the placeholders .env.example leaves behind', () => {
    expect(isUsableValue('your_api_key_here')).toBe(false)
    expect(isUsableValue('YOUR_PROJECT_ID')).toBe(false)
    expect(isUsableValue('<paste yours>')).toBe(false)
    expect(isUsableValue('placeholder')).toBe(false)
    expect(isUsableValue('XXXX-XXXX')).toBe(false)
    expect(isUsableValue('hacienda-de-luisana')).toBe(true)
  })

  it('only accepts a Firebase web API key', () => {
    expect(isApiKeyLike('AIzaSyBLiLB2JFcyKMkrCkrjY30-oZ2XJ6qP_E0')).toBe(true)
    expect(isApiKeyLike('my-api-key')).toBe(false)
    expect(isApiKeyLike('AIza-short')).toBe(false)
  })
})

describe('the project a build talks to', () => {
  it('has no project at all when neither a variable nor a default supplies one', () => {
    const report = resolveFirebaseConfig({ env: {}, defaults: EMPTY, allowDefaults: false })

    expect(report.configured).toBe(false)
    expect(report.source).toBe('none')
    expect(report.missingRequired).toEqual(['apiKey', 'projectId', 'authDomain'])
  })

  it('uses the variables when the build has them, and nothing else', () => {
    const report = resolveFirebaseConfig({
      env: { ...FULL_ENV, VITE_FIREBASE_PROJECT_ID: REAL.projectId },
      defaults: COMMITTED_PROJECT,
      allowDefaults: true,
    })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('env')
    expect(report.config.projectId).toBe(REAL.projectId)
    expect(report.config.appId).toBe(REAL.appId)
    expect(report.fields.every((f) => f.state === 'env')).toBe(true)
  })

  it('falls back to the committed project on a production build with an empty dashboard', () => {
    const report = resolveFirebaseConfig({ env: {}, defaults: COMMITTED_PROJECT, allowDefaults: true })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('defaults')
    expect(report.config.projectId).toBe(COMMITTED_PROJECT.projectId)
    expect(report.config.apiKey).toBe(COMMITTED_PROJECT.apiKey)
    // Every required value came from there; the optional ones the project does
    // not have (the Web app id) stay absent rather than invented.
    expect(report.fields.filter((f) => f.required).every((f) => f.state === 'default')).toBe(true)
    expect(fieldReport(report, 'appId').state).toBe('missing')
  })

  it('keeps local development in demo mode unless .env.local says otherwise', () => {
    // `npm run dev` and the test run: no variables, and the committed project is
    // not applied — the demo adapter and its emulator workflow stay as documented.
    const report = resolveFirebaseConfig({ env: {}, defaults: COMMITTED_PROJECT, allowDefaults: false })

    expect(report.configured).toBe(false)
    expect(report.source).toBe('none')
  })

  it('lets a variable over the committed project, value by value', () => {
    const report = resolveFirebaseConfig({
      env: { VITE_FIREBASE_PROJECT_ID: 'staging-project' },
      defaults: COMMITTED_PROJECT,
      allowDefaults: true,
    })

    expect(report.configured).toBe(true)
    expect(report.source).toBe('mixed')
    expect(report.config.projectId).toBe('staging-project')
    expect(report.config.authDomain).toBe(COMMITTED_PROJECT.authDomain)
  })

  it('is connected without an app id: Auth, Firestore and Storage do not read one', () => {
    const report = resolveFirebaseConfig({ env: {}, defaults: COMMITTED_PROJECT, allowDefaults: true })

    expect(report.configured).toBe(true)
    expect(fieldReport(report, 'appId').value).toBe('')
    expect(fieldReport(report, 'appId').required).toBe(false)
  })

  it('refuses a placeholder variable instead of initialising a Firebase app with it', () => {
    const report = resolveFirebaseConfig({
      env: { VITE_FIREBASE_API_KEY: 'your_api_key_here', VITE_FIREBASE_PROJECT_ID: REAL.projectId },
      defaults: EMPTY,
      allowDefaults: false,
    })

    expect(report.configured).toBe(false)
    expect(report.refusedEnvKeys).toEqual(['VITE_FIREBASE_API_KEY'])
    expect(fieldReport(report, 'apiKey').state).toBe('invalid')
    expect(fieldReport(report, 'apiKey').problem).toMatch(/AIza/)
  })

  it('reads a quoted paste as the value somebody meant', () => {
    const report = resolveFirebaseConfig({
      env: { ...FULL_ENV, VITE_FIREBASE_API_KEY: `"${REAL.apiKey}"` },
      defaults: EMPTY,
      allowDefaults: false,
    })

    expect(report.configured).toBe(true)
    expect(report.config.apiKey).toBe(REAL.apiKey)
  })

  it('says where the connection came from, in words', () => {
    expect(describeSource('env')).toMatch(/environment variables/)
    expect(describeSource('defaults')).toMatch(/committed/)
    expect(describeSource('mixed')).toMatch(/rest/)
    expect(describeSource('none')).toMatch(/this browser/)
  })

  it('shows a public key the way a public key may be shown', () => {
    expect(maskValue(REAL.apiKey)).toBe('AIzaSyA…7890')
    expect(maskValue('short')).toBe('sho…')
    expect(maskValue('')).toBe('')
  })
})
