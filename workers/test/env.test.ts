import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkerConfig, WorkerConfigurationError, type Env } from '../src/env'

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'

test('reads a downloaded service-account JSON secret', () => {
  const config = parseWorkerConfig({
    FIREBASE_PROJECT_ID: 'demo-project',
    BOOKING_QUOTES_ENABLED: 'true',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'demo-project',
      client_email: 'worker@demo-project.iam.gserviceaccount.com',
      private_key: PRIVATE_KEY,
      private_key_id: 'key-id-1',
    }),
  } satisfies Env)

  assert.equal(config.projectId, 'demo-project')
  assert.equal(config.databaseId, '(default)')
  assert.equal(config.serviceAccount.clientEmail, 'worker@demo-project.iam.gserviceaccount.com')
  assert.equal(config.serviceAccount.privateKeyId, 'key-id-1')
  assert.equal(config.quotesEnabled, true)
})

test('reads split secrets and restores escaped private-key newlines', () => {
  const config = parseWorkerConfig({
    FIREBASE_PROJECT_ID: 'demo-project',
    FIREBASE_CLIENT_EMAIL: 'worker@demo-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: PRIVATE_KEY.replace(/\n/g, '\\n'),
    ALLOWED_ORIGINS: 'https://example.com, http://localhost:5173',
    BOOKING_QUOTES_ENABLED: 'false',
    QUOTE_TTL_MINUTES: '90',
  })

  assert.equal(config.serviceAccount.privateKeyPem, `${PRIVATE_KEY}\n`)
  assert.deepEqual(config.allowedOrigins, ['https://example.com', 'http://localhost:5173'])
  assert.equal(config.quotesEnabled, false)
  assert.equal(config.quoteTtlMinutes, 90)
})

test('refuses a service account for a different Firebase project', () => {
  assert.throws(
    () => parseWorkerConfig({
      FIREBASE_PROJECT_ID: 'demo-project',
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'another-project',
        client_email: 'worker@another-project.iam.gserviceaccount.com',
        private_key: PRIVATE_KEY,
      }),
    }),
    WorkerConfigurationError,
  )
})
