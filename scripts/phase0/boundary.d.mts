export const ROOT: string
export const DEMO_PROJECT: 'demo-hacienda'
export const EMULATOR_HOSTS: Readonly<Record<string, string>>
export class IsolationError extends Error { code: string }
export function assertSafeInputs(options?: { env?: Record<string, string | undefined>; root?: string; home?: string }): true
export function assertIsolatedProcess(): { project: string; interfaces: string[]; parentNetns: number; testNetns: number }
export function assertEmulatorEnvironment(): ReturnType<typeof assertIsolatedProcess>
export const EMULATOR_EXEC_FIREBASE_CONFIG: string
