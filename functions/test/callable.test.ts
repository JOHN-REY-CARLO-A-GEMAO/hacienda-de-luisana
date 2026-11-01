import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeErrorForLog } from '../src/callable'

class UpstreamError extends Error {
  readonly status = 'FAILED_PRECONDITION'
  readonly httpStatus = 400

  constructor(message: string) {
    super(message)
    this.name = 'FirestoreRestError'
  }
}

test('describes an upstream error with its status and one-line message', () => {
  const description = describeErrorForLog(
    new UpstreamError('The query requires an index.\nPlease create it.'),
  )

  assert.equal(
    description,
    'FirestoreRestError [FAILED_PRECONDITION HTTP 400]: The query requires an index. Please create it.',
  )
})

test('redacts bearer tokens and caps long upstream messages', () => {
  const description = describeErrorForLog(
    new Error(`Bearer abc.def-123 ${'x'.repeat(700)}`),
  )

  assert.match(description, /Bearer \[redacted\]/)
  assert.doesNotMatch(description, /abc\.def-123/)
  assert.ok(description.length <= 607)
  assert.ok(description.endsWith('...'))
})

test('describes non-Error failures as unknown', () => {
  assert.equal(describeErrorForLog('boom'), 'unknown')
})
