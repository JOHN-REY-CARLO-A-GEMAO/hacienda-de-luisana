# Phase 0 safety design — recorded before harness implementation

Date: 2026-10-01. Reviewed baseline: `5297ec7a1432222c0e2c1f24bd3af353e786c116`.

## Authorization and scope

Only Phase 0 tests, fixtures, test runners/configuration, reports and non-application CI gates are authorized. R1–R10, production authorization, booking/payment/lifecycle semantics, production rules, schemas and device behavior must remain unchanged. A required production-code testing seam would require stopping and reporting before editing it.

## Inspection findings

- React/Vite/TypeScript guest app: `src/`. Flutter Admin app: `lib/`, native `android/`, `ios/`.
- Web initialization: `src/lib/firebase.ts`; environment resolver: `firebaseConfig.ts`; production defaults: `firebaseDefaults.ts`.
- Development without configured variables selects browser-local/demo adapters. Development with variables can reach real Firebase; the emulator switch must be exactly `true`.
- Production builds can select committed Firebase project `hacienda-de-luisana` even with absent variables. Flutter also carries that project's public configuration.
- Firebase Auth/Firestore/RTDB/Storage emulators are declared in `firebase.json` on ports 9099/8080/9000/9199, currently bound to all interfaces. This configuration is not a running emulator.
- Existing emulator runner selects a project from inherited environment and accepts a shell test-command override. Ordinary `.firebaserc` selects the real project. These are unsafe defaults for destructive verification.
- Only the web Vitest config overrides its env directory. An env directory alone does not exclude inherited variables or stop SDK network access.
- Supabase browser configuration uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Private proof bucket `payment-proofs` grants anonymous insertion under `payments/`; no anonymous read policy exists.
- The existing Supabase function verifies Firebase ID tokens and checks an Admin profile. Service account and Supabase service-role secrets are server-only environment inputs. Do not execute it against the linked project during Phase 0.
- Supabase config identifies a real linked project. No separate local/test bucket setup, safe integration runner, or verified staging project is present. Docker, Supabase CLI, Deno, Flutter and Java were initially unavailable.
- The sandbox permits unprivileged user/network namespaces. Landlock ABI 2 has no network filtering; do not claim Landlock isolation.

## Smallest proposed mechanism

1. A fixed-action Phase 0 runner rejects inherited Firebase/Supabase credentials, real project/endpoint settings, unexpected emulator endpoints, environment preload/command overrides and non-example dotenv files. Error messages identify names, never values.
2. Before executing any test/build-check payload, enter a fresh unprivileged Linux user + network namespace, enable only loopback, and verify namespace/interface/route isolation from kernel state. No `allow production` switch, no hosted staging mode, no portable weaker fallback.
3. Network isolation is inherited by native processes and workers, not merely a mocked fetch function. It prevents SDK traffic to external production services even if a committed public default is inadvertently instantiated.
4. Tests/configs verify actual isolation before collection. All standard JS test commands route through this boundary. Direct invocation of repository configs outside it fails closed.
5. Emulator runs use only `demo-hacienda`, a generated config with 127.0.0.1 bindings, fixed suite commands, no imported/exported developer datasets, no global process sweeping, and cleanup limited to the runner's process group.
6. Dependency/tool downloads happen separately, with no cloud credentials, before execution. They are not runtime tests and do not establish service behavior.
7. Offline tests may exercise actual adapters through explicitly labelled SDK doubles. Canonical Firebase rule/transaction cases run only on owned local emulators. SQL/source checks and mocks do not count as Supabase runtime proof.
8. Current-behavior characterization and desired-invariant tests are separate. Desired failures remain ordinary failing tests with nonzero exit codes; no expected-failure wrapper makes defects look remediated.
9. No real Supabase, staging, or physical-device execution is enabled. Specifications state the prerequisite isolation and evidence required later.

## Limitations and completion conditions

This is an accidental-production-access boundary for trusted repository tests, not a sandbox against malicious code able to exploit the operating system, privileged host agents or manually bypass repository tooling. Tests have no approved route to host orchestration sockets or real cloud secrets. Root/host-network execution is not an acceptable substitute.

A supported Linux machine with namespace permission is required. If namespaces, prerequisites or emulators cannot run, record BLOCKED; never fall back to a live project. A green characterization suite means the baseline was reproduced, not that security invariants pass. Phase 0 completion requires recorded safe execution results, all findings mapped, shared fixtures, reproducible critical scenarios and an explicit runtime/owner-decision backlog.
