/** Fetch binding shared by the Worker's outbound HTTP clients. */

export type FetchFn = typeof fetch

/**
 * Keep an injected or global fetch attached to the realm global when a
 * client stores it in a field. Workerd rejects the platform fetch with
 * `TypeError: Illegal invocation` when it is called as `this.fetchFn(...)`
 * and the client instance becomes its receiver; Node's fetch does not expose
 * that distinction in unit tests.
 */
export function bindGlobalFetch(fetchFn: FetchFn | undefined = fetch): FetchFn {
  const candidate = fetchFn ?? fetch
  return (input, init) => candidate.call(globalThis, input, init)
}
