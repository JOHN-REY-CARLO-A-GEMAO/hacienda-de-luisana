#!/usr/bin/env node
// Compare fresh reports; does not execute SDKs, change rules, or contact the network.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ROOT, assertSafeInputs } from '../phase0/boundary.mjs'
assertSafeInputs()
const BASE = 'e5155dec0e2255c3f6b29dbec7b1f5e063f1d878'
const resultDir = path.join(ROOT, '.cache/phase0/results')
const read = name => JSON.parse(fs.readFileSync(path.join(resultDir, name), 'utf8'))
const current = read('rules.json'), baseline = read('rules-baseline.json')
const currentCommand = read('rules.command.json'), baselineCommand = read('rules-baseline.command.json')
function results(report) {
  return new Map(report.testResults.filter(file => !path.basename(file.name).startsWith('disputes')).flatMap(file =>
    file.assertionResults.map(test => [path.basename(file.name) + ':' + test.fullName, { status: test.status, messages: test.failureMessages }]),
  ))
}
// A truncated/empty/stale report must never produce a reassuring comparison.
const reportProblems = []
for (const [action, report, command, expectedCount] of [['rules', current, currentCommand, 323], ['rules-baseline', baseline, baselineCommand, 314]]) {
  const assertions = report.testResults.flatMap(f => f.assertionResults)
  const started = Date.parse(command.startedAt), ended = Date.parse(command.endedAt)
  if (command.action !== action || command.environment !== 'TEST / Linux loopback-only network namespace' || command.project !== 'demo-hacienda') reportProblems.push(`${action}: wrong execution boundary`)
  if (!Number.isFinite(started) || !Number.isFinite(ended) || report.startTime < started || report.startTime > ended) reportProblems.push(`${action}: report does not belong to recorded command`)
  if (assertions.length !== expectedCount || report.numTotalTests !== expectedCount || assertions.some(t => !['passed', 'failed'].includes(t.status))) reportProblems.push(`${action}: missing, skipped, duplicated or unexpected assertions`)
  if (new Set(assertions.map(t => t.fullName)).size !== assertions.length) reportProblems.push(`${action}: duplicate assertion identifiers`)
  if (report.numFailedTests !== assertions.filter(t => t.status === 'failed').length || report.numPassedTests !== assertions.filter(t => t.status === 'passed').length) reportProblems.push(`${action}: inconsistent result counters`)
  if (command.exitCode !== (report.numFailedTests ? 1 : 0) || !command.steps?.some(step => step.command === command.command && step.exitCode === command.exitCode)) reportProblems.push(`${action}: incomplete command execution`)
}
const a = results(current), b = results(baseline)
const changes = [...new Set([...a.keys(), ...b.keys()])].filter(key => a.get(key)?.status !== b.get(key)?.status)
const failing = [...a].filter(([, t]) => t.status === 'failed')
const setErrors = failing.filter(([, t]) => t.messages.some(m => m.includes('`.toSet()` on set')))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const fixtures = ['engine.ts', 'engine.test.ts', 'context.ts', 'firestore-rules.test.ts', 'storage-rules.test.ts', 'booking-lead-time.rules.test.ts', 'firestore-rule-limits.test.ts']
const unchangedFixtures = fixtures.every(file => sha(fs.readFileSync(path.join(ROOT, 'test/rules', file))) === sha(execFileSync('git', ['show', `${BASE}:test/rules/${file}`], { cwd: ROOT })))
// Reject stale evidence if any inspected source changed after the report commands began.
const start = Math.min(Date.parse(currentCommand.startedAt), Date.parse(baselineCommand.startedAt))
const inputs = ['firestore.rules', 'storage.rules', 'vitest.rules.config.ts', 'vitest.rules-baseline.config.ts', 'test/rules/baseline.setup.ts', ...fixtures.map(f => `test/rules/${f}`), 'test/rules/disputes.rules.test.ts', 'scripts/phase0/run.mjs', 'scripts/phase0/inside.mjs', 'scripts/phase0/boundary.mjs', 'package-lock.json']
const stale = inputs.filter(file => fs.statSync(path.join(ROOT, file)).mtimeMs > start)
const summary = {
  baselineCommit: BASE, verification: 'SUPPLEMENTAL — not Firebase emulator verification',
  generatedAt: new Date().toISOString(), sourceHashes: Object.fromEntries(['firestore.rules', 'storage.rules'].map(file => [file, { current: sha(fs.readFileSync(path.join(ROOT, file))), baseline: sha(execFileSync('git', ['show', `${BASE}:${file}`], { cwd: ROOT })) }])),
  unchangedFixtures, verifiedFixtureCount: fixtures.length, reportProblems, staleInputs: stale, comparedAssertions: a.size,
  currentExistingFailures: failing.length, baselineExistingFailures: [...b.values()].filter(t => t.status === 'failed').length,
  evaluatorToSetErrors: setErrors.length, otherAssertionFailures: failing.length - setErrors.length,
  changedAssertionStatuses: changes,
  newDisputeTests: current.testResults.filter(f => path.basename(f.name).startsWith('disputes')).flatMap(f => f.assertionResults.map(t => ({ name: t.fullName, status: t.status }))),
  failures: failing.map(([name, t]) => ({ name, kind: t.messages.some(m => m.includes('`.toSet()` on set')) ? 'unsupported evaluator method' : 'assertion mismatch — not dismissed as an evaluator bug' })),
}
fs.writeFileSync(path.join(resultDir, 'dispute-rule-comparison.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, failures: undefined, newDisputeTests: { total: summary.newDisputeTests.length, passed: summary.newDisputeTests.filter(t => t.status === 'passed').length } }, null, 2))
if (reportProblems.length || a.size !== 314 || b.size !== 314 || summary.newDisputeTests.length !== 9 || !unchangedFixtures || stale.length || changes.length || summary.newDisputeTests.some(t => t.status !== 'passed')) process.exitCode = 1
