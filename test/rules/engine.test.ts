/**
 * The evaluator's own semantics, pinned.
 *
 * Every decision `firestore-rules.test.ts` and `storage-rules.test.ts` report
 * rests on the operators and methods below behaving the way the rules language
 * documents. If one of these fixtures is wrong, the suites above are wrong, so
 * each fixture here is written from the published reference for the construct
 * rather than from this repository's rules.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEMANTICS,
  RuleEvaluationError,
  UnsupportedConstructError,
  allows,
  evaluate,
  type RuleRequest,
  type Store,
} from './engine'

/** A rule set whose only job is to make one expression visible. */
function fixture(expression: string, extra = ''): string {
  return `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isAdmin() { return signedIn() && request.auth.token.email in ['admin@example.com']; }
    ${extra}
    match /docs/{docId} {
      allow read, write: if ${expression};
    }
    match /{document=**} { allow read, write: if false; }
  }
}
`
}

const asGuest = (uid = 'guest-1', token: Record<string, unknown> = {}) =>
  ({ uid, token }) satisfies NonNullable<RuleRequest['auth']>

function check(
  expression: string,
  request: Partial<RuleRequest> = {},
  options: { extra?: string; store?: Store; method?: RuleRequest['method'] } = {},
): boolean {
  // A request that carries new data is a write; the caller can still say otherwise.
  const method =
    options.method ?? (request.requestData ? (request.resourceData ? 'update' : 'create') : 'get')
  return allows(
    {
      path: 'docs/one',
      method,
      auth: null,
      resourceData: null,
      requestData: null,
      ...request,
    },
    fixture(expression, options.extra),
    { store: options.store },
  )
}

describe('evaluator: literals and operators', () => {
  it('compares equality, ordering and arithmetic the way the reference documents', () => {
    expect(check('1 + 2 * 3 == 7')).toBe(true)
    expect(check('(1 + 2) * 3 == 9')).toBe(true)
    expect(check('7 % 2 == 1')).toBe(true)
    expect(check('7 / 2 == 3.5')).toBe(true)
    expect(check('10 - 4 > 5')).toBe(true)
    expect(check('1 <= 1 && 2 >= 2')).toBe(true)
    expect(check("'a' < 'b'")).toBe(true)
    expect(check("'a' + 'b' == 'ab'")).toBe(true)
    expect(check('-1 < 0')).toBe(true)
    expect(check('true == true && false != true')).toBe(true)
    expect(check('null == null')).toBe(true)
  })

  it('handles `in` over lists, maps and strings', () => {
    expect(check("'b' in ['a', 'b']")).toBe(true)
    expect(check("'c' in ['a', 'b']")).toBe(false)
    expect(check("'k' in {'k': 1}")).toBe(true)
    expect(check("'nope' in {'k': 1}")).toBe(false)
    expect(check("'ell' in 'hello'")).toBe(true)
  })

  it('handles `is` type checks', () => {
    expect(check("'x' is string")).toBe(true)
    expect(check('1 is int')).toBe(true)
    expect(check('1.5 is float')).toBe(true)
    expect(check('1 is number')).toBe(true)
    expect(check('[1] is list')).toBe(true)
    expect(check("{'a': 1} is map")).toBe(true)
    expect(check("1 is string")).toBe(false)
  })

  it('handles ternaries, negation and nesting', () => {
    expect(check("(true ? 'a' : 'b') == 'a'")).toBe(true)
    expect(check('!(1 == 2)')).toBe(true)
    expect(check("!('a' in ['b'])")).toBe(true)
    expect(check('(true ? (false ? 1 : 2) : 3) == 2')).toBe(true)
  })
})

describe('evaluator: request and resource bindings', () => {
  it('binds request.auth and treats auth as null when signed out', () => {
    expect(check('request.auth == null')).toBe(true)
    expect(check('request.auth != null', { auth: asGuest() })).toBe(true)
    expect(check('request.auth.uid == "guest-1"', { auth: asGuest() })).toBe(true)
    expect(check('request.auth.uid == "guest-2"', { auth: asGuest() })).toBe(false)
  })

  it('binds the captured path variables', () => {
    expect(check('docId == "one"')).toBe(true)
    expect(check('docId == "two"')).toBe(false)
    expect(check('database == "(default)"')).toBe(true)
  })

  it('exposes request.method for each operation', () => {
    expect(check("request.method == 'get'", {}, { method: 'get' })).toBe(true)
    expect(check("request.method == 'update'", { resourceData: { title: 'a' } }, { method: 'update' })).toBe(true)
    expect(check("request.method == 'delete'", { resourceData: { owner: 'x' } }, { method: 'delete' })).toBe(true)
    expect(check("request.method == 'create'", { requestData: { owner: 'x' } }, { method: 'create' })).toBe(true)
  })

  it('has resource.data on update and request.resource.data on create/update', () => {
    expect(check("resource.data.owner == 'guest-1'", { resourceData: { owner: 'guest-1' } })).toBe(true)
    expect(check("request.resource.data.owner == 'guest-1'", { requestData: { owner: 'guest-1' } }, { method: 'create' })).toBe(true)
  })

  it('has request.resource == null on delete', () => {
    expect(check('request.resource == null', { resourceData: { owner: 'x' } }, { method: 'delete' })).toBe(true)
    expect(check('request.resource == null', { requestData: { owner: 'x' } }, { method: 'create' })).toBe(false)
  })
})

describe('evaluator: map and list methods', () => {
  it('reads keys, values, size and get(key, default)', () => {
    expect(check("request.resource.data.keys().hasAll(['a', 'b'])", { requestData: { a: 1, b: 2 } })).toBe(true)
    expect(check("request.resource.data.keys().hasAll(['a', 'c'])", { requestData: { a: 1, b: 2 } })).toBe(false)
    expect(check("request.resource.data.keys().hasOnly(['a', 'b'])", { requestData: { a: 1, b: 2 } })).toBe(true)
    expect(check("request.resource.data.keys().hasOnly(['a'])", { requestData: { a: 1, b: 2 } })).toBe(false)
    expect(check("request.resource.data.size() == 2", { requestData: { a: 1, b: 2 } })).toBe(true)
    expect(check("request.resource.data.get('missing', 'fallback') == 'fallback'", { requestData: {} })).toBe(true)
    expect(check("request.resource.data.get('a', 'fallback') == 1", { requestData: { a: 1 } })).toBe(true)
    expect(check("request.resource.data.values().size() == 2", { requestData: { a: 1, b: 2 } })).toBe(true)
    expect(check("['a', 'b'].hasAll(['a'])")).toBe(true)
    expect(check("['a', 'b'].hasOnly(['a'])")).toBe(false)
    expect(check("['a', 'b'].size() == 2")).toBe(true)
    expect(check("'abc'.size() == 3")).toBe(true)
  })

  it('diffs two maps and reports the affected keys', () => {
    const both = { resourceData: { a: 1, b: 2 }, requestData: { a: 9, c: 3 } }
    expect(check("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['a', 'b', 'c'])", both)).toBe(true)
    // `b` was removed, so it is affected too: a list without it cannot cover the diff.
    expect(check("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['a', 'c'])", both)).toBe(false)
    expect(check("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['a'])", both)).toBe(false)
    expect(check("request.resource.data.diff(resource.data).addedKeys().hasOnly(['c'])", both)).toBe(true)
    expect(check("request.resource.data.diff(resource.data).removedKeys().hasOnly(['b'])", both)).toBe(true)
    expect(check("request.resource.data.diff(resource.data).changedKeys().hasOnly(['a'])", both)).toBe(true)
    expect(check("request.resource.data.diff(resource.data).unchangedKeys().hasOnly([])", both)).toBe(true)
  })

  it('matches strings with full-match semantics', () => {
    expect(check("'image/png'.matches('image/.*')")).toBe(true)
    expect(check("'image/png'.matches('png')")).toBe(false)
    expect(check("'image/png'.matches('.*')")).toBe(true)
  })

  it('indexes lists and maps', () => {
    expect(check("['a', 'b'][1] == 'b'")).toBe(true)
    expect(check("{'k': 'v'}['k'] == 'v'")).toBe(true)
  })
})

describe('evaluator: functions, reads and paths', () => {
  const store: Store = {
    'profiles/guest-1': { role: 'guest' },
    'profiles/admin-1': { role: 'admin' },
  }

  it('calls user-defined functions with arguments, in the declaring scope', () => {
    expect(check('signedIn()', { auth: asGuest() })).toBe(true)
    expect(check('isAdmin()', { auth: { uid: 'a', token: { email: 'admin@example.com' } } })).toBe(true)
    expect(check('isAdmin()', { auth: { uid: 'a', token: { email: 'other@example.com' } } })).toBe(false)
  })

  it('resolves get() and exists() against the store, through path captures', () => {
    expect(check("get(/databases/$(database)/documents/profiles/$(request.auth.uid)).data.role == 'guest'", { auth: asGuest() }, { store })).toBe(true)
    expect(check('exists(/databases/$(database)/documents/profiles/$(request.auth.uid))', { auth: asGuest() }, { store })).toBe(true)
    expect(check('exists(/databases/$(database)/documents/profiles/$(request.auth.uid))', { auth: asGuest('nobody') }, { store })).toBe(false)
  })

  it('reads are not themselves subject to the rules', () => {
    // The `match /{document=**}` block below denies everything; a `get()` still sees the document.
    const rules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
    match /docs/{docId} {
      allow read: if exists(/databases/$(database)/documents/hidden/$(docId));
    }
  }
}
`
    expect(allows({ path: 'docs/x', method: 'get', auth: null, resourceData: null }, rules, { store: { 'hidden/x': { a: 1 } } })).toBe(true)
    expect(allows({ path: 'docs/y', method: 'get', auth: null, resourceData: null }, rules, { store: { 'hidden/x': { a: 1 } } })).toBe(false)
  })

  it('binds the glob capture to the whole remaining path', () => {
    const rules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read: if document == 'a/b/c'; }
  }
}
`
    expect(allows({ path: 'a/b/c', method: 'get', auth: null, resourceData: null }, rules)).toBe(true)
    expect(allows({ path: 'a/b', method: 'get', auth: null, resourceData: null }, rules)).toBe(false)
  })

  it('applies a match block only to paths under it', () => {
    expect(check('true', { path: 'docs/one' })).toBe(true)
    // The fixture's own catch-all denies; `docs/one/sub/x` is matched by the glob only.
    expect(allows({ path: 'other/one', method: 'get', auth: null, resourceData: null }, fixture('true'))).toBe(false)
  })
})

describe('evaluator: errors deny, and never silently allow', () => {
  it('treats a read of an absent key as an error by default', () => {
    const request: RuleRequest = { path: 'docs/one', method: 'get', auth: asGuest(), resourceData: { role: 'guest' } }
    expect(evaluate(request, fixture("resource.data.missing == 'x'")).allow).toBe(false)
    // The same request under the other documented reading of an absent key.
    expect(evaluate(request, fixture("resource.data.missing == 'x'"), { semantics: { missingKeys: 'null' } }).allow).toBe(false)
    expect(evaluate(request, fixture('resource.data.missing == null'), { semantics: { missingKeys: 'null' } }).allow).toBe(true)
  })

  it('leaves .get(key, default) unaffected by that policy', () => {
    const request: RuleRequest = { path: 'docs/one', method: 'get', auth: asGuest(), resourceData: {} }
    expect(evaluate(request, fixture("resource.data.get('missing', 'none') == 'none'")).allow).toBe(true)
    expect(evaluate(request, fixture("resource.data.get('missing', 'none') == 'none'"), { semantics: { missingKeys: 'null' } }).allow).toBe(true)
  })

  it('absorbs errors in || and && the way CEL does', () => {
    const request: RuleRequest = { path: 'docs/one', method: 'get', auth: asGuest(), resourceData: { role: 'guest' } }
    // An error on the left, a true on the right: the expression is true.
    expect(evaluate(request, fixture("resource.data.missing == 'x' || true")).allow).toBe(true)
    // An error on the right, a true on the left: still true.
    expect(evaluate(request, fixture("true || resource.data.missing == 'x'")).allow).toBe(true)
    // `&&` is false when either side is false, error or not.
    expect(evaluate(request, fixture("false && resource.data.missing == 'x'")).allow).toBe(false)
    expect(evaluate(request, fixture("resource.data.missing == 'x' && false")).allow).toBe(false)
    // An error next to a non-decisive operand still denies.
    expect(evaluate(request, fixture("resource.data.missing == 'x' || false")).allow).toBe(false)
    expect(evaluate(request, fixture("resource.data.missing == 'x' && true")).allow).toBe(false)
    // Whatever happens, no error can turn into an allow on its own.
    expect(evaluate(request, fixture('resource.data.missing')).allow).toBe(false)
  })

  it('reports which statements were evaluated and how each one went', () => {
    const request = { path: 'docs/one', method: 'get' as const, auth: asGuest(), resourceData: {} }
    expect(evaluate(request, fixture('false')).statements[0]).toMatchObject({ at: '/databases/{database}/documents/docs/{docId}', result: false })
    // An expression that raised is reported as such, and still denies.
    const errored = evaluate(request, fixture("resource.data.missing == 'x' || false"))
    expect(errored.allow).toBe(false)
    expect(errored.statements[0]).toMatchObject({ at: '/databases/{database}/documents/docs/{docId}', result: 'error' })
    expect(errored.statements[0].error).toContain('missing')
  })

  it('denies a non-boolean condition instead of coercing it', () => {
    expect(evaluate({ path: 'docs/one', method: 'get', auth: null, resourceData: null }, fixture('1')).allow).toBe(false)
    expect(() => new RuleEvaluationError('x')).not.toThrow()
  })

  it('throws on constructs it does not model, so coverage failures are loud', () => {
    const request = { path: 'docs/one', method: 'get' as const, auth: null, resourceData: null }
    // The clock is not modelled at all.
    expect(() => allows(request, fixture('request.time > timestamp.date(2020, 1, 1)'))).toThrow(UnsupportedConstructError)
    // Nor is an unknown global, nor a member read of a path.
    expect(() => allows(request, fixture('math.abs(-1) == 1'))).toThrow(UnsupportedConstructError)
    expect(() =>
      allows(request, fixture("get(/databases/$(database)/documents/docs/one).nope == 1"), { store: { 'docs/one': { a: 1 } } }),
    ).toThrow(UnsupportedConstructError)
    // A claim this engine was not handed is a rules error, which denies.
    expect(evaluate({ ...request, auth: asGuest('guest-1', {}) }, fixture("request.auth.token.admin == true")).allow).toBe(false)
  })

  it('has a default semantics object that the suites share', () => {
    expect(DEFAULT_SEMANTICS.missingKeys).toBe('error')
  })
})

describe('evaluator: permission declarations and operation aliases', () => {
  const rules = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /docs/{docId} {
      allow read: if true;
      allow write: if request.resource != null;
      allow delete: if false;
    }
  }
}
`
  const base: RuleRequest = { path: 'docs/one', method: 'get', auth: null, resourceData: null, requestData: null }

  it('expands read into get and list', () => {
    expect(allows({ ...base, method: 'get' }, rules)).toBe(true)
    // A query names the collection; its rules are the collection's document rules.
    expect(allows({ ...base, path: 'docs', method: 'list' }, rules)).toBe(true)
    expect(allows({ ...base, path: 'other', method: 'list' }, rules)).toBe(false)
  })

  it('expands write into create, update and delete', () => {
    expect(allows({ ...base, method: 'create', requestData: {} }, rules)).toBe(true)
    // A delete carries no request.resource, so the write statement is false and
    // the explicit `allow delete: if false` settles it.
    expect(allows({ ...base, method: 'delete', resourceData: {} }, rules)).toBe(false)
  })

  it('denies operations no statement covers', () => {
    const readOnly = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /docs/{docId} { allow read: if true; }
  }
}
`
    expect(allows({ ...base, method: 'update', requestData: {}, resourceData: {} }, readOnly)).toBe(false)
  })
})
