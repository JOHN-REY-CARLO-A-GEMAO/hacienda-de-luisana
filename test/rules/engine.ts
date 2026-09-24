/**
 * A local evaluator for Firebase Security Rules — the fallback used to *execute*
 * `firestore.rules` and `storage.rules` in an environment that cannot download
 * Google's Java emulator (see docs/VERIFICATION.md § Why not the emulator).
 *
 * WHAT THIS IS
 *   The rules files are parsed with Firebase's own ANTLR grammar, shipped by
 *   `@firebase/eslint-plugin-security-rules`, and the resulting parse tree is
 *   evaluated against a request context. The rules text under test is therefore
 *   the real `firestore.rules` / `storage.rules`; nothing about the decisions is
 *   hard-coded here.
 *
 * WHAT THIS IS NOT
 *   It is not Google's implementation. Emulator-backed results remain the only
 *   canonical proof; `test/emulator/*` holds that suite and
 *   `npm run test:emulator` runs it wherever Java and the emulator download are
 *   available. Differences that matter are listed in docs/VERIFICATION.md.
 *
 * Unknown constructs throw instead of defaulting to allow or deny, so a rules
 * change that this evaluator does not model fails the suite instead of quietly
 * passing it. `engine.test.ts` pins the semantics of every operator and method
 * the rules files use.
 */
import { parseForESLint } from '@firebase/eslint-plugin-security-rules/parser'

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** A document body, as stored in the (simulated) database. */
export type DocData = { [key: string]: unknown }

/** The simulated database: canonical path → document body (or null for a tombstone). */
export type Store = Record<string, DocData | null>

/** Firestore rules' Set type. */
export type RuleSet = { readonly __set: unknown[] }
/** Firestore rules' MapDiff type. */
export type MapDiff = {
  readonly __diff: { added: string[]; removed: string[]; changed: string[]; unchanged: string[] }
}
/** A resolved resource path, produced by a path literal such as `/databases/$(d)/documents/x/y`. */
export type RulePath = { readonly __rulePath: string }

const setOf = (items: unknown[]): RuleSet => ({ __set: items })
const isSet = (value: unknown): value is RuleSet => !!value && typeof value === 'object' && '__set' in value
const isDiff = (value: unknown): value is MapDiff => !!value && typeof value === 'object' && '__diff' in value
const isPath = (value: unknown): value is RulePath => !!value && typeof value === 'object' && '__rulePath' in value

/** A write that the rules engine is evaluating. */
export type RequestMethod = 'get' | 'list' | 'create' | 'update' | 'delete'

export type AuthState = {
  uid: string
  token: Record<string, unknown>
} | null

export type RuleRequest = {
  /** Collection/document path without a leading slash, e.g. `bookings/abc123`. */
  path: string
  method: RequestMethod
  auth: AuthState
  /** The stored document for update/delete; null for create/list/get-of-missing. */
  resourceData?: DocData | null
  /** The document being written for create/update; null for delete. */
  requestData?: DocData | null
  /** Storage only: size in bytes of the upload. */
  size?: number
  /** Storage only: content type of the upload. */
  contentType?: string
}

export type Decision = {
  allow: boolean
  /** Every `allow` statement that matched the request, with its outcome. */
  statements: { at: string; ops: string[]; result: boolean | 'error'; error?: string }[]
}

/**
 * Two behaviours of the rules language that no public document pins down beyond
 * the reference pages, and that this repository's rules depend on:
 *
 *  - `missingKeys`: Firestore's reference for `rules.Map` documents `get(key,
 *    default)` as the way to read a key that may be absent, and the data-validation
 *    examples treat `resource.data.absent == null` as an error, so the default here
 *    is that reading an absent key raises an error that denies the statement.
 *    The alternative reading — an absent key is `null` — is one flag away, because
 *    the two readings differ on real cases in this rules file (`role()` reads
 *    `request.auth.token.email`, which an anonymous Guest's token has no claim for).
 *
 * Errors themselves follow CEL, the language underneath Security Rules: `a || b`
 * is true when either side is true even if the other errored, and `a && b` is
 * false when either side is false, because the engine is free to evaluate either
 * side first. `docs/VERIFICATION.md` records the cases where the reading matters;
 * the emulator suite is what settles them for good.
 */
export type Semantics = { missingKeys: 'error' | 'null' }

export const DEFAULT_SEMANTICS: Semantics = { missingKeys: 'error' }

/** Raised for anything this evaluator does not model; never silently swallowed into a verdict. */
export class UnsupportedConstructError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedConstructError'
  }
}

/** Raised while evaluating a rule (a type error, a missing document read, …). Denies, like Firestore. */
export class RuleEvaluationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleEvaluationError'
  }
}

const unsupported = (what: string): never => {
  throw new UnsupportedConstructError(`rules engine does not model ${what}`)
}

// ---------------------------------------------------------------------------
// Parse-tree helpers
// ---------------------------------------------------------------------------

type Node = {
  constructor?: { name?: string }
  children?: Node[] | null
  getText?: () => string
  symbol?: { line: number; column: number }
}

/**
 * The rule name of a parse-tree node. ANTLR's terminal nodes arrive as `Fe`
 * (the grammar's token class); everything else is a rule context, named
 * `<Rule>Context`. Terminals report as `''` so nothing mistakes a token for a
 * sub-expression — the distinction is what keeps an operator from being read as
 * an operand.
 */
const kind = (node: Node): string => {
  const name = node.constructor?.name ?? ''
  if (name === 'Fe' || name === 'TerminalNodeImpl' || name === '') return ''
  return name.replace(/Context$/, '')
}
const text = (node: Node): string => node.getText?.() ?? ''
const children = (node: Node): Node[] => node.children ?? []
const kids = (node: Node, name: string): Node[] => children(node).filter((child) => kind(child) === name)
const kid = (node: Node, name: string): Node | undefined => children(node).find((child) => kind(child) === name)
const terminals = (node: Node): string[] => children(node).filter((child) => !kind(child)).map(text)
const firstTerminal = (node: Node, symbol: string): boolean => terminals(node).includes(symbol)

/** Children that are expressions (everything that is not a raw operator/terminal token). */
const expressionChildren = (node: Node): Node[] => children(node).filter((child) => !!kind(child))

function parseRules(source: string): Node {
  const { services } = parseForESLint(source) as unknown as { services: { tree: Node } }
  return services.tree
}

// ---------------------------------------------------------------------------
// Rule book: services, match declarations, functions
// ---------------------------------------------------------------------------

type FnDecl = { params: string[]; body: Node }
/** A declared function, plus the capture scope it was declared in: `$(database)`
 *  inside a helper resolves in the block that declared the helper, not in the
 *  block that called it. */
type FnBinding = { decl: FnDecl; vars: Record<string, unknown> }

type MatchRule = {
  segments: Segment[]
  functions: Map<string, FnDecl>
  statements: { ops: string[]; body: Node | null; literal: boolean }[]
  children: MatchRule[]
  /** The literal path of the enclosing `match` declarations, for error messages. */
  at: string
}

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'capture'; name: string }
  | { kind: 'glob'; name: string }

class RuleBook {
  readonly services = new Map<string, MatchRule[]>()

  constructor(tree: Node) {
    // The tree is `ruleset → (version, ruleset-statement → service-declaration)`.
    const declarations = [
      ...kids(tree, 'ServiceDeclaration'),
      ...kids(tree, 'RulesetStatement').flatMap((statement) => kids(statement, 'ServiceDeclaration')),
    ]
    for (const serviceDecl of declarations) {
      const id = text(kid(serviceDecl, 'ServiceId') ?? serviceDecl).trim()
      const roots: MatchRule[] = []
      for (const statement of kids(serviceDecl, 'ServiceStatement')) {
        for (const match of kids(statement, 'MatchRuleDeclaration')) roots.push(this.matchRule(match, ''))
      }
      this.services.set(id, roots)
    }
  }

  private matchRule(node: Node, prefix: string): MatchRule {
    const pathDecl = kid(node, 'PathDecl')
    const segments = (pathDecl ? children(pathDecl) : []).flatMap((segment) => this.segment(segment))
    const at = '/' + segments.map((s) => (s.kind === 'literal' ? s.value : s.kind === 'capture' ? `{${s.name}}` : `{${s.name}=**}`)).join('/')
    const rule: MatchRule = {
      segments,
      functions: new Map(),
      statements: [],
      children: [],
      at: prefix ? `${prefix}${at}` : at,
    }
    for (const statement of kids(node, 'MatchStatement')) {
      for (const fn of kids(statement, 'FunctionDeclaration')) {
        const name = text(kid(fn, 'LocalFunctionId') ?? fn).trim()
        const signature = kid(fn, 'FunctionSignature')
        const params = (signature ? kids(signature, 'ParamList') : []).flatMap((list) =>
          kids(list, 'LocalVariableId').map((param) => text(param).trim()),
        )
        const body = kid(fn, 'FunctionBody')
        if (!body) unsupported('a function without a body')
        rule.functions.set(name, { params, body })
      }
      for (const permission of kids(statement, 'PermissionDeclaration')) {
        const ops = (kid(permission, 'OperationId') ? kids(kid(permission, 'OperationId')!, 'Id') : []).map((id) =>
          text(id).trim(),
        )
        const body = kid(permission, 'PermissionBody')
        const expression = body ? expressionChildren(body).at(-1) ?? null : null
        rule.statements.push({ ops, body: expression, literal: expression ? isLiteralTrue(expression) : false })
        if (ops.length === 0) unsupported('an `allow` with no operation')
        if (!body) unsupported('an `allow` without a body')
      }
      for (const nested of kids(statement, 'MatchRuleDeclaration')) {
        rule.children.push(this.matchRule(nested, rule.at))
      }
    }
    return rule
  }

  private segment(node: Node): Segment[] {
    switch (kind(node)) {
      case 'SimpleSegmemnt':
        return text(node).split('/').filter(Boolean).map((value) => ({ kind: 'literal', value }) as Segment)
      case 'CaptureSegment':
        return [{ kind: 'capture', name: text(node).replace(/[{}=\s*/]/g, '') }]
      case 'GlobSegment':
        return [{ kind: 'glob', name: text(node).replace(/[{}=\s*/]/g, '') }]
      default:
        return unsupported(`a path declaration segment of type ${kind(node)}`)
    }
  }
}

function isLiteralTrue(node: Node): boolean {
  return kind(node) === 'PrimaryExpression' && firstTerminal(kid(node, 'LiteralExpression') ?? node, 'true')
}

// ---------------------------------------------------------------------------
// Request context
// ---------------------------------------------------------------------------

type Scope = {
  request: Record<string, unknown>
  resource: Record<string, unknown> | null
  vars: Record<string, unknown>
  functions: Map<string, FnBinding>
  store: Store
  calls: number
  semantics: Semantics
}

/** The `request` maps of the requests being evaluated, so `request.time` can be refused loudly. */
const REQUEST_OBJECTS = new WeakSet<object>()
/** Document snapshots returned by `get()`, whose members are fixed by the rules API. */
const RESOURCE_OBJECTS = new WeakSet<object>()

const METHOD_ALIASES: Record<string, string[]> = {
  read: ['get', 'list'],
  write: ['create', 'update', 'delete'],
}

/**
 * The Storage object metadata a request carries: `request.resource` on a write,
 * `resource` on a read. In Storage rules those are `{size, contentType}` maps,
 * not documents, so the same fields are read from the request's metadata payload.
 */
function storageMetadata(input: RuleRequest, data: DocData | null | undefined): Record<string, unknown> {
  const size = input.size ?? (typeof data?.size === 'number' ? data.size : undefined)
  const contentType = input.contentType ?? (typeof data?.contentType === 'string' ? data.contentType : undefined)
  const metadata: Record<string, unknown> = {}
  if (size !== undefined) metadata.size = size
  if (contentType !== undefined) metadata.contentType = contentType
  return metadata
}

function requestObject(input: RuleRequest, service: string): Record<string, unknown> {
  const request: Record<string, unknown> = {
    auth: input.auth ? { uid: input.auth.uid, token: input.auth.token } : null,
    method: input.method,
    path: '/' + input.path,
    resource: null,
  }
  REQUEST_OBJECTS.add(request)
  if (input.method === 'create' || input.method === 'update') {
    if (service === 'firebase.storage') {
      request.resource = storageMetadata(input, input.requestData)
    } else {
      request.resource = { data: input.requestData ?? {} }
    }
  }
  return request
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate one request against a rules file.
 *
 * `rulesText` is the rules source; `service` is `cloud.firestore` or
 * `firebase.storage`; `store` answers `get()`/`exists()` reads.
 */
export function evaluate(
  input: RuleRequest,
  rulesText: string,
  options: { service?: string; store?: Store; semantics?: Semantics; bucket?: string } = {},
): Decision {
  const service = options.service ?? 'cloud.firestore'
  const store = options.store ?? {}
  const semantics = options.semantics ?? DEFAULT_SEMANTICS
  const book = new RuleBook(parseRules(rulesText))
  const roots = book.services.get(service)
  if (!roots) throw new UnsupportedConstructError(`the rules file declares no \`service ${service}\``)

  // Clients address `bookings/abc`, but `match` declarations in both rule
  // languages are rooted at the service's own prefix — Firestore at
  // `/databases/{database}/documents`, Storage at `/b/{bucket}/o`. A request
  // given in full is taken as-is; a short one is placed under the prefix, the
  // way the service does it before consulting the rules.
  const segs = fullPath(input.path, service, options).split('/').filter(Boolean)
  // A query names a collection, not a document; the service evaluates the
  // collection's rules against a document of it, so a listing gets a stand-in
  // final segment and matching needs no special case.
  if (input.method === 'list') segs.push('(list)')

  /**
   * A `match` declaration covers the paths it consumes and nothing below them:
   * `match /bookings/{id}` governs that document, while `/bookings/{id}/activity/x`
   * is governed by the nested declaration — and by nothing else in this block.
   * That is why only a declaration that consumes the whole path contributes
   * statements, and why the walk still descends past the shorter ones.
   */
  type Frame = { rule: MatchRule; vars: Record<string, unknown> }
  const matched: { rule: MatchRule; vars: Record<string, unknown>; chain: Frame[] }[] = []
  const walk = (rules: MatchRule[], index: number, vars: Record<string, unknown>, chain: Frame[]) => {
    for (const rule of rules) {
      const match = matchSegments(rule.segments, segs, index)
      if (!match) continue
      const scopeVars = { ...vars, ...match.vars }
      const nextChain = [...chain, { rule, vars: scopeVars }]
      if (index + match.consumed >= segs.length) matched.push({ rule, vars: scopeVars, chain: nextChain })
      walk(rule.children, index + match.consumed, scopeVars, nextChain)
    }
  }
  walk(roots, 0, {}, [])

  const statements: Decision['statements'] = []
  const scope: Scope = {
    request: requestObject(input, service),
    resource: input.resourceData ? resourceObject(input, input.resourceData, service) : null,
    vars: {},
    functions: new Map(),
    store,
    calls: 0,
    semantics,
  }

  // Firestore evaluates matching `allow` statements until one grants.
  for (const { rule, vars, chain } of matched) {
    const statementScope: Scope = { ...scope, vars, functions: collectFunctions(chain) }
    for (const statement of rule.statements) {
      const applies = statement.ops.some((op) => (METHOD_ALIASES[op] ?? [op]).includes(input.method))
      if (!applies) continue
      if (statement.body === null) {
        statements.push({ at: rule.at, ops: statement.ops, result: 'error', error: 'no body' })
        continue
      }
      try {
        const value = evalExpr(statement.body, statementScope)
        if (typeof value !== 'boolean') {
          throw new RuleEvaluationError(`a condition must be a boolean, got ${describe(value)}`)
        }
        const allowed = value
        statements.push({ at: rule.at, ops: statement.ops, result: allowed })
        if (allowed) return { allow: true, statements }
      } catch (error) {
        if (error instanceof UnsupportedConstructError) throw error
        statements.push({
          at: rule.at,
          ops: statement.ops,
          result: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return { allow: false, statements }
}

function collectFunctions(chain: { rule: MatchRule; vars: Record<string, unknown> }[]): Map<string, FnBinding> {
  // A function is visible in the block that declares it and in every block
  // nested inside it, which is exactly the chain of matches this path went
  // through. A name declared twice is shadowed by the inner declaration.
  const functions = new Map<string, FnBinding>()
  for (const frame of chain) {
    for (const [name, decl] of frame.rule.functions) functions.set(name, { decl, vars: frame.vars })
  }
  return functions
}

/** The full path a service consults its rules with. */
function fullPath(path: string, service: string, options: { bucket?: string }): string {
  const clean = path.replace(/^\//, '')
  if (service === 'firebase.storage') {
    if (clean.startsWith('b/')) return clean
    return `b/${options.bucket ?? 'hacienda-de-luisana.appspot.com'}/o/${clean}`
  }
  if (clean.startsWith('databases/')) return clean
  return `databases/(default)/documents/${clean}`
}

function resourceObject(input: RuleRequest, data: DocData, service: string): Record<string, unknown> {
  if (service === 'firebase.storage') return storageMetadata(input, data)
  return { data, id: input.path.split('/').pop() ?? '' }
}

/**
 * Match one `match` declaration's segments starting at `index`; null when it does
 * not apply. A glob (`{name=**}`) swallows every remaining segment, so the caller
 * is told how much of the path the declaration used, not how many segments it has.
 */
function matchSegments(
  segments: Segment[],
  path: string[],
  index: number,
): { vars: Record<string, unknown>; consumed: number } | null {
  const vars: Record<string, unknown> = {}
  let cursor = index
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    if (segment.kind === 'glob') {
      if (cursor >= path.length) return null
      vars[segment.name] = path.slice(cursor).join('/')
      cursor = path.length
      continue
    }
    if (cursor >= path.length) return null
    const value = path[cursor]
    if (segment.kind === 'literal') {
      if (value !== segment.value) return null
    } else {
      vars[segment.name] = value
    }
    cursor += 1
  }
  return { vars, consumed: cursor - index }
}

function evalExpr(node: Node, scope: Scope): unknown {
  switch (kind(node)) {
    case 'Expression':
    case 'ExprInExpression':
    case 'LogicalOrExpression':
    case 'LogicalAndExpression':
    case 'EqualityExpression':
    case 'RelationalExpression':
    case 'AdditiveExpression':
    case 'MultiplicativeExpression':
    case 'UnaryAdditiveExpression':
      return evalBinaryOrUnary(node, scope)
    case 'ExprIsTypeIdExpression': {
      const [left, right] = expressionChildren(node)
      return isType(evalExpr(left, scope), text(kid(right, 'IsOperatorId') ?? right))
    }
    case 'NotExpression': {
      const [operand] = expressionChildren(node)
      return !truthy(evalExpr(operand, scope))
    }
    case 'TernaryExpression': {
      const [condition, then, otherwise] = expressionChildren(node)
      return truthy(evalExpr(condition, scope)) ? evalExpr(then, scope) : evalExpr(otherwise, scope)
    }
    case 'PrimaryExpression': {
      const [inner] = expressionChildren(node)
      if (!inner) unsupported('an empty primary expression')
      return evalExpr(inner, scope)
    }
    case 'ParenSimpleExpression': {
      const [inner] = expressionChildren(node)
      return evalExpr(inner, scope)
    }
    case 'LiteralExpression':
      return literal(kid(node, 'Literal') ?? node)
    case 'VariableSimpleExpression': {
      const name = text(kid(node, 'LocalVariableId') ?? node).trim()
      return lookupVariable(name, scope, node)
    }
    case 'MemberLookupSimpleExpression': {
      const [base] = expressionChildren(node)
      const name = memberName(node)
      return memberGet(evalExpr(base, scope), name, scope.semantics)
    }
    case 'ListLookupSimpleExpression':
    case 'MemberLookupSimpleExpressionIndex':
    case 'IndexLookupSimpleExpression': {
      const [base] = expressionChildren(node)
      const index = kid(node, 'IndexLookup') ?? kid(node, 'ListIndex')
      const [key] = index ? expressionChildren(index) : []
      if (!key) unsupported('a lookup without an index')
      return indexGet(evalExpr(base, scope), evalExpr(key, scope), scope.semantics)
    }
    case 'MemberFunctionCallSimpleExpression': {
      const [base] = expressionChildren(node)
      const name = memberName(node)
      const args = callArgs(node, scope)
      return method(evalExpr(base, scope), name, args)
    }
    case 'FunctionCallSimpleExpression': {
      const name = text(kid(node, 'LocalFunctionId') ?? node).trim()
      const args = callArgs(node, scope)
      return globalCall(name, args, scope, node)
    }
    case 'PathSimpleExpression':
    case 'PathExpression':
      return pathOf(node, scope)
    case 'ListSimpleExpression': {
      const list = kid(node, 'ExpressionList')
      return list ? expressionChildren(list).map((item) => evalExpr(item, scope)) : []
    }
    case 'MapSimpleExpression': {
      const mapExpr = kid(node, 'MapExpression')
      const entries = mapExpr ? kid(mapExpr, 'MapEntries') : undefined
      const result: Record<string, unknown> = {}
      for (const entry of entries ? kids(entries, 'MapEntry') : []) {
        const [keyNode, valueNode] = expressionChildren(entry)
        const key = evalExpr(keyNode, scope)
        result[String(key)] = evalExpr(valueNode, scope)
      }
      return result
    }
    case 'ExpressionList':
      return expressionChildren(node).map((item) => evalExpr(item, scope))
    default:
      return unsupported(`an expression of type ${kind(node)}`)
  }
}

function callArgs(node: Node, scope: Scope): unknown[] {
  const list = kid(node, 'ExpressionList')
  return list ? expressionChildren(list).map((arg) => evalExpr(arg, scope)) : []
}

function evalBinaryOrUnary(node: Node, scope: Scope): unknown {
  const parts = children(node)
  const operators: string[] = []
  const operands: Node[] = []
  for (const part of parts) {
    if (kind(part)) operands.push(part)
    else operators.push(text(part))
  }
  if (operands.length === 1) {
    const value = evalExpr(operands[0], scope)
    // A lone operand is either a parenthesised expression or a signed one.
    return operators.includes('-') ? -number(value) : value
  }

  // A chain of `&&`/`||` follows CEL, the language underneath Security Rules:
  // it is decided by whichever operand settles it, so `a || b` is true when
  // either side is true even if the other raised, and `a && b` is false when
  // either side is false. The engine is free to evaluate either side first, so
  // an error next to a decisive operand cannot be allowed to decide the answer.
  if (operators.every((op) => op === '&&' || op === '||')) {
    let state = booleanAttempt(operands[0], scope)
    for (let index = 0; index < operators.length; index += 1) {
      const decisive = operators[index] === '&&' ? false : true
      if (state.ok && state.value === decisive) continue
      const right = booleanAttempt(operands[index + 1], scope)
      if (right.ok && right.value === decisive) {
        state = right
        continue
      }
      if (!state.ok) continue
      if (!right.ok) state = right
    }
    if (!state.ok) throw state.error
    return state.value
  }

  // Every other operator is strict: a raised operand raises the expression.
  let value = evalExpr(operands[0], scope)
  for (let index = 0; index < operators.length; index += 1) {
    const right = evalExpr(operands[index + 1], scope)
    value = operators[index] === 'in' ? membership(value, right) : binary(operators[index], value, right)
  }
  return value
}

type Attempt = { ok: true; value: unknown } | { ok: false; error: unknown }

/**
 * Evaluate an operand of `&&`/`||`. A non-boolean is an error, as it is in CEL,
 * but the error is captured so the other operand can still decide the result.
 */
function booleanAttempt(node: Node, scope: Scope): Attempt {
  const attempt = tryAttempt(node, scope)
  if (attempt.ok && typeof attempt.value !== 'boolean') {
    return { ok: false, error: new RuleEvaluationError(`expected a boolean, got ${describe(attempt.value)}`) }
  }
  return attempt
}

/** Evaluate an expression, capturing a rules error instead of letting it escape. */
function tryAttempt(node: Node, scope: Scope): Attempt {
  try {
    return { ok: true, value: evalExpr(node, scope) }
  } catch (error) {
    if (error instanceof UnsupportedConstructError) throw error
    return { ok: false, error }
  }
}

function binary(op: string, left: unknown, right: unknown): unknown {
  switch (op) {
    case '==':
      return deepEqual(left, right)
    case '!=':
      return !deepEqual(left, right)
    case '<':
      return compare(left, right) < 0
    case '<=':
      return compare(left, right) <= 0
    case '>':
      return compare(left, right) > 0
    case '>=':
      return compare(left, right) >= 0
    case '+':
      if (typeof left === 'string' && typeof right === 'string') return left + right
      return number(left) + number(right)
    case '-':
      return number(left) - number(right)
    case '*':
      return number(left) * number(right)
    case '/':
      return number(left) / number(right)
    case '%':
      return number(left) % number(right)
    default:
      return unsupported(`the operator ${op}`)
  }
}

function membership(needle: unknown, haystack: unknown): boolean {
  if (Array.isArray(haystack)) return haystack.some((item) => deepEqual(item, needle))
  if (isSet(haystack)) return haystack.__set.some((item) => deepEqual(item, needle))
  if (typeof haystack === 'string' && typeof needle === 'string') return haystack.includes(needle)
  if (isMap(haystack)) return Object.prototype.hasOwnProperty.call(haystack, String(needle))
  throw new RuleEvaluationError(`\`in\` does not apply to ${describe(haystack)}`)
}

function isType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'int':
      return typeof value === 'number' && Number.isInteger(value)
    case 'float':
      return typeof value === 'number' && !Number.isInteger(value)
    case 'number':
      return typeof value === 'number'
    case 'bool':
      return typeof value === 'boolean'
    case 'list':
      return Array.isArray(value)
    case 'map':
      return isMap(value)
    case 'set':
      return isSet(value)
    case 'null':
      return value === null
    default:
      return unsupported(`the type check \`is ${type}\``)
  }
}

function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  throw new RuleEvaluationError(`expected a boolean, got ${describe(value)}`)
}

const number = (value: unknown): number => {
  if (typeof value === 'number') return value
  throw new RuleEvaluationError(`expected a number, got ${describe(value)}`)
}

function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left === right ? 0 : left < right ? -1 : 1
  if (typeof left === 'string' && typeof right === 'string') return left === right ? 0 : left < right ? -1 : 1
  throw new RuleEvaluationError(`cannot order ${describe(left)} against ${describe(right)}`)
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !isSet(value) && !isDiff(value) && !isPath(value)

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'list'
  if (isSet(value)) return 'set'
  if (isDiff(value)) return 'map diff'
  if (isPath(value)) return 'path'
  if (isMap(value)) return 'map'
  return typeof value
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left === 'number' && typeof right === 'number') return left === right
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
  }
  if (isSet(left) && isSet(right)) {
    return left.__set.length === right.__set.length && left.__set.every((item) => right.__set.some((other) => deepEqual(item, other)))
  }
  if (isMap(left) && isMap(right)) {
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]))
  }
  return false
}

// ---------------------------------------------------------------------------
// Members, lookups and methods
// ---------------------------------------------------------------------------

/**
 * Read one key of a map under the configured missingKeys policy.
 *
 * `.get(key, default)` stays the documented way to read a key that may be
 * absent; this is the bare `map.key` / `map[key]` read.
 */
function mapKey(base: Record<string, unknown>, name: string, semantics: Semantics): unknown {
  if (Object.prototype.hasOwnProperty.call(base, name)) return base[name]
  if (semantics.missingKeys === 'null') return null
  throw new RuleEvaluationError(`\`${name}\` is not set on the map`)
}

function memberName(node: Node): string {
  const named = kid(node, 'MemberId') ?? kid(node, 'KeywordId')
  if (!named) unsupported(`a member access without a name in \`${text(node)}\``)
  return text(named).trim()
}

function memberGet(base: unknown, name: string, semantics: Semantics = DEFAULT_SEMANTICS): unknown {
  if (base === null || base === undefined) {
    throw new RuleEvaluationError(`cannot read \`.${name}\` of ${describe(base)}`)
  }
  if (isPath(base)) {
    // Rules paths expose `id`/`__name__`; nothing in this repository's rules uses them.
    return unsupported(`a member read of a path (\`.${name}\`)`)
  }
  if (Array.isArray(base)) {
    if (name === 'size') return base.length
    return unsupported(`the list member \`.${name}\``)
  }
  if (isSet(base)) return unsupported(`the set member \`.${name}\``)
  if (typeof base === 'object' && base !== null && RESOURCE_OBJECTS.has(base)) {
    // A `get()` result is a document resource, not a plain map: its members are
    // the ones the rules API defines, and anything else is not a read this
    // evaluator can answer.
    if (name === 'data') return (base as { data: unknown }).data
    if (name === 'id') return (base as { id: unknown }).id
    return unsupported(`the document member \`.${name}\` of a get() result`)
  }
  if (typeof base === 'object' && base !== null && REQUEST_OBJECTS.has(base) && name === 'time') {
    // The rules files here do not read the clock; a rule that did would need a
    // real timestamp type, so refuse instead of answering with a stand-in.
    return unsupported('request.time (the evaluation timestamp)')
  }
  if (isMap(base)) return mapKey(base, name, semantics)
  return unsupported(`the member \`.${name}\` of ${describe(base)}`)
}

function indexGet(base: unknown, key: unknown, semantics: Semantics = DEFAULT_SEMANTICS): unknown {
  if (Array.isArray(base)) {
    if (typeof key !== 'number') throw new RuleEvaluationError('a list index must be an int')
    if (key < 0 || key >= base.length) throw new RuleEvaluationError('list index out of range')
    return base[key]
  }
  if (isMap(base)) return mapKey(base, String(key), semantics)
  throw new RuleEvaluationError(`cannot index ${describe(base)}`)
}

function method(base: unknown, name: string, args: unknown[]): unknown {
  switch (name) {
    case 'size':
      if (typeof base === 'string') return base.length
      if (Array.isArray(base)) return base.length
      if (isSet(base)) return base.__set.length
      if (isMap(base)) return Object.keys(base).length
      break
    case 'get': {
      const key = String(args[0])
      if (!isMap(base)) break
      if (Object.prototype.hasOwnProperty.call(base, key)) return base[key]
      if (args.length > 1) return args[1]
      throw new RuleEvaluationError(`\`${key}\` is not set on the map`)
    }
    case 'keys':
      if (isMap(base)) return setOf(Object.keys(base))
      break
    case 'values':
      if (isMap(base)) return Object.values(base)
      break
    case 'hasAll':
      return hasAll(base, args[0])
    case 'hasOnly':
      return hasOnly(base, args[0])
    case 'diff':
      if (isMap(base) && isMap(args[0])) return mapDiff(base, args[0])
      break
    case 'affectedKeys':
      if (isDiff(base)) return setOf([...base.__diff.added, ...base.__diff.changed, ...base.__diff.removed])
      break
    case 'addedKeys':
      if (isDiff(base)) return setOf(base.__diff.added)
      break
    case 'removedKeys':
      if (isDiff(base)) return setOf(base.__diff.removed)
      break
    case 'changedKeys':
      if (isDiff(base)) return setOf(base.__diff.changed)
      break
    case 'unchangedKeys':
      if (isDiff(base)) return setOf(base.__diff.unchanged)
      break
    case 'matches':
      if (typeof base === 'string' && typeof args[0] === 'string') {
        // Rules use RE2 full-match semantics: the whole string must match.
        return new RegExp(`^(?:${args[0]})$`, 'u').test(base)
      }
      break
    case 'lower':
    case 'toLowerCase':
      if (typeof base === 'string') return base.toLowerCase()
      break
    case 'upper':
    case 'toUpperCase':
      if (typeof base === 'string') return base.toUpperCase()
      break
    case 'split':
      if (typeof base === 'string') return base.split(String(args[0]))
      break
    case 'concat':
      if (Array.isArray(base) && Array.isArray(args[0])) return [...base, ...args[0]]
      break
    case 'join':
      if (Array.isArray(base)) return base.join(String(args[0] ?? ''))
      break
    case 'toSet':
      if (Array.isArray(base)) return setOf([...base])
      break
    case 'union':
      if (isSet(base) && isSet(args[0])) return setOf([...base.__set, ...args[0].__set])
      break
    case 'intersection':
      if (isSet(base) && isSet(args[0])) return setOf(base.__set.filter((item) => args[0].__set.some((other) => deepEqual(item, other))))
      break
    case 'difference':
      if (isSet(base) && isSet(args[0])) return setOf(base.__set.filter((item) => !args[0].__set.some((other) => deepEqual(item, other))))
      break
    case 'removeAll':
      if (Array.isArray(base) && Array.isArray(args[0])) return base.filter((item) => !args[0].some((other) => deepEqual(item, other)))
      break
  }
  return unsupported(`the method \`.${name}()\` on ${describe(base)}`)
}

function itemsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isSet(value)) return value.__set
  if (isMap(value)) return Object.keys(value)
  throw new RuleEvaluationError(`expected a list, set or map, got ${describe(value)}`)
}

function hasAll(base: unknown, other: unknown): boolean {
  const mine = itemsOf(base)
  return itemsOf(other).every((item) => mine.some((own) => deepEqual(own, item)))
}

function hasOnly(base: unknown, other: unknown): boolean {
  const allowed = itemsOf(other)
  return itemsOf(base).every((item) => allowed.some((own) => deepEqual(own, item)))
}

function mapDiff(next: Record<string, unknown>, previous: Record<string, unknown>): MapDiff {
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  const unchanged: string[] = []
  for (const key of Object.keys(next)) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) added.push(key)
    else if (deepEqual(next[key], previous[key])) unchanged.push(key)
    else changed.push(key)
  }
  for (const key of Object.keys(previous)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) removed.push(key)
  }
  return { __diff: { added, removed, changed, unchanged } }
}

// ---------------------------------------------------------------------------
// Paths, variables and calls
// ---------------------------------------------------------------------------

function pathOf(node: Node, scope: Scope): RulePath {
  const expression = kind(node) === 'PathExpression' ? node : kid(node, 'PathExpression') ?? node
  const parts: string[] = []
  for (const segment of kids(expression, 'PathExpressionSegment')) {
    // A segment is a literal (`/documents`) or an interpolation (`$(uid)`);
    // a lone `/` before an interpolation is a separator, not a segment of its own.
    const literalSegment = kid(segment, 'SimpleSegmemnt')
    if (literalSegment) {
      parts.push(text(literalSegment))
      continue
    }
    const interpolation = kid(segment, 'PrimaryExpression') ?? kid(segment, 'VariableSimpleExpression')
    if (interpolation) {
      parts.push('/', interpolated(interpolation, scope))
      continue
    }
  }
  const raw = parts
    .join('')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '')
  // `/databases/(default)/documents/<collection>/<doc>` → `<collection>/<doc>`
  const marker = 'documents/'
  const index = raw.indexOf(marker)
  return { __rulePath: index >= 0 ? raw.slice(index + marker.length) : raw }
}

function interpolated(node: Node, scope: Scope): string {
  if (kind(node) === 'MemberLookupSimpleExpression' || kind(node) === 'VariableSimpleExpression') {
    const value = evalExpr(node, scope)
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    throw new RuleEvaluationError(`a path interpolation produced ${describe(value)}`)
  }
  const value = evalExpr(node, scope)
  return String(value)
}

function lookupVariable(name: string, scope: Scope, node: Node): unknown {
  if (name === 'request') return scope.request
  if (name === 'resource') {
    if (scope.resource === null) throw new RuleEvaluationError('`resource` is null for this request')
    return scope.resource
  }
  if (name === 'get' || name === 'exists') return { __global: name }
  if (Object.prototype.hasOwnProperty.call(scope.vars, name)) return scope.vars[name]
  if (name === 'database') return '(default)'
  return unsupported(`the variable \`${name}\` at \`${text(node)}\``)
}

function globalCall(name: string, args: unknown[], scope: Scope, node: Node): unknown {
  const local = scope.functions.get(name)
  if (local) return callUserFunction(local, args, scope, name)

  switch (name) {
    case 'get':
    case 'getAfter': {
      const path = asPath(args[0], name)
      const data = scope.store[path]
      if (data === null || data === undefined) {
        // Firestore errors on a `get()` of a missing document (an error denies the
        // rule). Both readings deny in this repository's rules, and `exists()`
        // guards every read: see docs/VERIFICATION.md.
        return null
      }
      const snapshot = { data, id: path.split('/').pop() ?? '', __path: path, __exists: true }
      RESOURCE_OBJECTS.add(snapshot)
      return snapshot
    }
    case 'exists':
    case 'existsAfter': {
      const path = asPath(args[0], name)
      return scope.store[path] !== null && scope.store[path] !== undefined
    }
    case 'debug':
      return args[0]
    default:
      return unsupported(`the function \`${name}()\` at \`${text(node)}\``)
  }
}

function asPath(value: unknown, fn: string): string {
  if (isPath(value)) return value.__rulePath
  if (typeof value === 'string') return value.replace(/^\//, '')
  throw new RuleEvaluationError(`${fn}() expects a path, got ${describe(value)}`)
}

function callUserFunction(binding: FnBinding, args: unknown[], scope: Scope, name: string): unknown {
  const fn = binding.decl
  if (scope.calls > 64) throw new RuleEvaluationError(`the function \`${name}\` recurses`)
  if (args.length !== fn.params.length) {
    throw new RuleEvaluationError(`\`${name}\` takes ${fn.params.length} arguments, got ${args.length}`)
  }
  // Arguments are evaluated in the caller's scope; the body runs in the scope
  // the function was declared in, extended with its parameters.
  const vars = { ...binding.vars }
  fn.params.forEach((param, index) => {
    vars[param] = args[index]
  })
  const inner: Scope = { ...scope, vars, calls: scope.calls + 1 }
  const returns = collectReturns(fn.body)
  if (returns.length !== 1) unsupported(`a function body with ${returns.length} return statements`)
  return evalExpr(expressionChildren(returns[0]).at(-1)!, inner)
}

function collectReturns(node: Node, out: Node[] = []): Node[] {
  if (kind(node) === 'ReturnStatement') out.push(node)
  for (const child of children(node)) collectReturns(child, out)
  return out
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

function literal(node: Node): unknown {
  const raw = text(node).trim()
  if (raw.startsWith("'") || raw.startsWith('"')) return raw.slice(1, -1)
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10)
  if (/^-?\d*\.\d+$/.test(raw)) return Number.parseFloat(raw)
  return unsupported(`the literal \`${raw}\``)
}

/** Convenience for tests: a request from a uid plus a token, with no data. */
export function requestOf(partial: Partial<RuleRequest> & { path: string; method: RequestMethod }): RuleRequest {
  return { auth: null, ...partial }
}

export const ALLOW: Decision['allow'] = true
export const DENY: Decision['allow'] = false

/** Assertion helper: true when the request is allowed by the rules text. */
export function allows(
  input: RuleRequest,
  rulesText: string,
  options?: { service?: string; store?: Store; semantics?: Semantics; bucket?: string },
): boolean {
  return evaluate(input, rulesText, options).allow
}
