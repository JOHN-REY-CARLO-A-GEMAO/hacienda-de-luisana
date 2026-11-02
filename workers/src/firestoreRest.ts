/**
 * Firestore REST implementation of the shared `FirestoreLike` seam.
 *
 * It covers exactly what the booking/quote core needs: document reads,
 * equality/range collection queries, full and partial writes, create
 * preconditions, server-time field transforms, and read/write transactions
 * with bounded retries on Firestore's `ABORTED` contention signal.
 */

import {
  isServerTimestamp,
  type CollectionReferenceLike,
  type DocumentData,
  type DocumentReferenceLike,
  type DocumentSnapshotLike,
  type FirestoreLike,
  type QueryLike,
  type QuerySnapshotLike,
  type TransactionLike,
  type WhereOperator,
} from '../../functions/src/firestoreLike'
import { base64ToBytes, bytesToBase64 } from './encoding'
import { bindGlobalFetch } from './fetch'
import type { AccessTokenProvider } from './googleAuth'

type RestValue = Record<string, unknown>
type RestDocument = {
  name?: string
  fields?: Record<string, RestValue>
}
type RestWrite = Record<string, unknown>
type WriteKind = 'set' | 'create' | 'update'

interface PendingWrite {
  kind: WriteKind
  reference: RestDocumentReference
  data: DocumentData
}

interface QueryFilter {
  field: string
  operator: WhereOperator
  value: unknown
}

export class FirestoreRestError extends Error {
  constructor(
    readonly status: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'FirestoreRestError'
  }
}

function isAborted(error: unknown): boolean {
  return error instanceof FirestoreRestError && error.status === 'ABORTED'
}

interface RestErrorBody {
  code?: unknown
  status?: unknown
  message?: unknown
  details?: unknown
}

const GRPC_STATUS_BY_CODE: Record<number, string> = {
  0: 'OK',
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED',
}

const HTTP_STATUS_BY_GRPC_STATUS: Record<string, number> = {
  CANCELLED: 499,
  UNKNOWN: 500,
  INVALID_ARGUMENT: 400,
  DEADLINE_EXCEEDED: 504,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PERMISSION_DENIED: 403,
  RESOURCE_EXHAUSTED: 429,
  FAILED_PRECONDITION: 400,
  ABORTED: 409,
  OUT_OF_RANGE: 400,
  UNIMPLEMENTED: 501,
  INTERNAL: 500,
  UNAVAILABLE: 503,
  DATA_LOSS: 500,
  UNAUTHENTICATED: 401,
}

function restErrorFromPayload(payload: unknown): RestErrorBody | undefined {
  if (Array.isArray(payload)) {
    // Streaming Firestore methods such as runQuery can report an error as an
    // entry in the JSON array rather than as the usual top-level API error.
    for (const entry of payload) {
      const error = restErrorFromPayload(entry)
      if (error) return error
    }
    return undefined
  }
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
    return record.error as RestErrorBody
  }
  if ('code' in record || 'status' in record || 'message' in record) {
    return record as RestErrorBody
  }
  return undefined
}

function statusFromRestError(error: RestErrorBody | undefined, httpStatus: number): string {
  if (typeof error?.status === 'string' && error.status) return error.status
  if (typeof error?.code === 'number') {
    return GRPC_STATUS_BY_CODE[error.code] ?? (error.code >= 100 ? `HTTP_${error.code}` : `GRPC_${error.code}`)
  }
  return `HTTP_${httpStatus}`
}

function httpStatusFromRestError(error: RestErrorBody | undefined, fallback: number): number {
  if (typeof error?.code === 'number' && error.code >= 100) return error.code
  const status = statusFromRestError(error, fallback)
  return HTTP_STATUS_BY_GRPC_STATUS[status] ?? fallback
}

function messageFromRestError(error: RestErrorBody | undefined): string | undefined {
  if (typeof error?.message === 'string' && error.message) return error.message
  if (!Array.isArray(error?.details)) return undefined
  const descriptions: string[] = []
  for (const detail of error.details) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue
    const violations = (detail as { fieldViolations?: unknown }).fieldViolations
    if (!Array.isArray(violations)) continue
    for (const violation of violations) {
      if (!violation || typeof violation !== 'object' || Array.isArray(violation)) continue
      const description = (violation as { description?: unknown }).description
      if (typeof description === 'string' && description) descriptions.push(description)
    }
  }
  return descriptions.length > 0 ? descriptions.join('; ') : undefined
}

function operationFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const marker = '/documents'
    const index = pathname.indexOf(marker)
    return index >= 0 ? pathname.slice(index) : pathname
  } catch {
    return 'Firestore request'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function encodeFirestoreValue(value: unknown): RestValue {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError('Firestore integer is outside JavaScript safe-integer range.')
      }
      return { integerValue: String(value) }
    }
    if (Number.isNaN(value)) return { doubleValue: 'NaN' }
    if (value === Number.POSITIVE_INFINITY) return { doubleValue: 'Infinity' }
    if (value === Number.NEGATIVE_INFINITY) return { doubleValue: '-Infinity' }
    return { doubleValue: value }
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError('Cannot encode an invalid Date for Firestore.')
    return { timestampValue: value.toISOString() }
  }
  if (value instanceof Uint8Array) {
    return { bytesValue: bytesToBase64(value) }
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } }
  }
  if (isServerTimestamp(value)) {
    throw new TypeError('SERVER_TIMESTAMP must be converted to a field transform before encoding.')
  }
  if (isPlainObject(value)) {
    return { mapValue: { fields: encodeFirestoreFields(value) } }
  }
  throw new TypeError(`Unsupported Firestore value type: ${typeof value}`)
}

export function encodeFirestoreFields(data: DocumentData): Record<string, RestValue> {
  const fields: Record<string, RestValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      throw new TypeError(`Firestore field ${key} is undefined.`)
    }
    fields[key] = encodeFirestoreValue(value)
  }
  return fields
}

export function decodeFirestoreValue(value: RestValue): unknown {
  if (!value || typeof value !== 'object') throw new TypeError('Malformed Firestore REST value.')
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('stringValue' in value) return String(value.stringValue)
  if ('integerValue' in value) {
    const parsed = Number(value.integerValue)
    if (!Number.isSafeInteger(parsed)) {
      throw new TypeError('Firestore integer is outside JavaScript safe-integer range.')
    }
    return parsed
  }
  if ('doubleValue' in value) {
    const raw = value.doubleValue
    if (raw === 'NaN') return Number.NaN
    if (raw === 'Infinity') return Number.POSITIVE_INFINITY
    if (raw === '-Infinity') return Number.NEGATIVE_INFINITY
    return Number(raw)
  }
  if ('timestampValue' in value) return new Date(String(value.timestampValue))
  if ('bytesValue' in value) return base64ToBytes(String(value.bytesValue))
  if ('arrayValue' in value) {
    const array = value.arrayValue as { values?: RestValue[] } | undefined
    return (array?.values ?? []).map(decodeFirestoreValue)
  }
  if ('mapValue' in value) {
    const map = value.mapValue as { fields?: Record<string, RestValue> } | undefined
    return decodeFirestoreFields(map?.fields ?? {})
  }
  if ('referenceValue' in value) {
    const name = String(value.referenceValue)
    const marker = '/documents/'
    const index = name.indexOf(marker)
    return index >= 0 ? name.slice(index + marker.length) : name
  }
  if ('geoPointValue' in value) {
    const point = value.geoPointValue as { latitude?: unknown; longitude?: unknown }
    return { latitude: Number(point.latitude ?? 0), longitude: Number(point.longitude ?? 0) }
  }
  throw new TypeError('Unsupported Firestore REST value.')
}

export function decodeFirestoreFields(fields: Record<string, RestValue>): DocumentData {
  const data: DocumentData = {}
  for (const [key, value] of Object.entries(fields)) {
    data[key] = decodeFirestoreValue(value)
  }
  return data
}

function cloneData(data: DocumentData): DocumentData {
  return structuredClone(data)
}

function pathSegments(path: string, kind: 'document' | 'collection'): string[] {
  const normalized = path.replace(/^\/+|\/+$/g, '')
  const segments = normalized === '' ? [] : normalized.split('/')
  if (segments.some((segment) => segment === '')) {
    throw new Error(`Invalid Firestore ${kind} path: ${path}`)
  }
  if (kind === 'document' && (segments.length < 2 || segments.length % 2 !== 0)) {
    throw new Error(`Invalid Firestore document path: ${path}`)
  }
  if (kind === 'collection' && (segments.length < 1 || segments.length % 2 !== 1)) {
    throw new Error(`Invalid Firestore collection path: ${path}`)
  }
  return segments
}

function validateSegment(segment: string, label: string): string {
  if (!segment || segment.includes('/') || segment === '.' || segment === '..') {
    throw new Error(`Invalid Firestore ${label}: ${segment}`)
  }
  return segment
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function formatFieldPath(path: readonly string[]): string {
  return path.map((segment) => {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) return segment
    return `\`${segment.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
  }).join('.')
}

const OMIT = Symbol('omit-server-timestamp')

function containsServerTimestamp(value: unknown): boolean {
  if (isServerTimestamp(value)) return true
  if (Array.isArray(value)) return value.some(containsServerTimestamp)
  if (isPlainObject(value)) return Object.values(value).some(containsServerTimestamp)
  return false
}

function splitServerTimestamps(
  value: unknown,
  path: readonly string[],
  transformPaths: string[][],
): unknown | typeof OMIT {
  if (isServerTimestamp(value)) {
    if (path.length === 0) throw new TypeError('A document cannot itself be a server timestamp.')
    transformPaths.push([...path])
    return OMIT
  }
  if (Array.isArray(value)) {
    if (containsServerTimestamp(value)) {
      throw new TypeError('SERVER_TIMESTAMP cannot be stored inside a Firestore array.')
    }
    return value
  }
  if (isPlainObject(value)) {
    const clean: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const child = splitServerTimestamps(entry, [...path, key], transformPaths)
      if (child !== OMIT) clean[key] = child
    }
    return clean
  }
  return value
}

class RestDocumentSnapshot implements DocumentSnapshotLike {
  constructor(
    readonly id: string,
    readonly exists: boolean,
    private readonly value: DocumentData | undefined,
  ) {}

  data(): DocumentData | undefined {
    return this.value === undefined ? undefined : cloneData(this.value)
  }
}

class RestQuerySnapshot implements QuerySnapshotLike {
  readonly empty: boolean
  readonly size: number

  constructor(readonly docs: Array<{ id: string; data(): DocumentData }>) {
    this.empty = docs.length === 0
    this.size = docs.length
  }
}

export interface FirestoreRestClientOptions {
  fetchFn?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
  maxTransactionAttempts?: number
}

const FILTER_OPERATORS: Record<WhereOperator, string> = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  'in': 'IN',
  'not-in': 'NOT_IN',
  'array-contains': 'ARRAY_CONTAINS',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
}

export class FirestoreRestClient implements FirestoreLike {
  private readonly fetchFn: typeof fetch
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxTransactionAttempts: number

  constructor(
    private readonly projectId: string,
    private readonly databaseId: string,
    private readonly tokenProvider: AccessTokenProvider,
    options: FirestoreRestClientOptions = {},
  ) {
    this.fetchFn = bindGlobalFetch(options.fetchFn)
    this.baseUrl = (options.baseUrl ?? 'https://firestore.googleapis.com/v1').replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxTransactionAttempts = Math.max(1, Math.min(10, options.maxTransactionAttempts ?? 5))
  }

  doc(path: string): DocumentReferenceLike {
    return new RestDocumentReference(this, path)
  }

  collection(path: string): CollectionReferenceLike {
    return new RestCollectionReference(this, path)
  }

  private databaseResource(): string {
    return `projects/${this.projectId}/databases/${this.databaseId}`
  }

  private documentsBaseUrl(): string {
    const databaseUrlPath = `projects/${encodeURIComponent(this.projectId)}/databases/${encodeURIComponent(this.databaseId)}`
    return `${this.baseUrl}/${databaseUrlPath}/documents`
  }

  resourceName(path: string): string {
    // Percent-encoding belongs in the HTTP URL, not in a JSON resource name.
    // Firestore document IDs may contain spaces (the inventory-lock ID is the
    // accommodation name); encoding one here would address a different doc.
    return `${this.databaseResource()}/documents/${path}`
  }

  private documentUrl(path: string): string {
    return `${this.documentsBaseUrl()}/${encodePath(path)}`
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private async requestJson<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let forceRefresh = false
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await this.tokenProvider.getAccessToken(forceRefresh)
      const response = await this.fetchWithTimeout(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })

      const text = await response.text()
      let payload: unknown = undefined
      if (text) {
        try {
          payload = JSON.parse(text) as unknown
        } catch {
          payload = undefined
        }
      }

      if (response.ok) return payload as T
      if (response.status === 401 && attempt === 0) {
        this.tokenProvider.invalidateAccessToken()
        forceRefresh = true
        continue
      }

      const error = restErrorFromPayload(payload)
      const status = statusFromRestError(error, response.status)
      const rawDetail = payload === undefined && text.trim() ? text.replace(/\s+/g, ' ').trim().slice(0, 600) : undefined
      const detail = messageFromRestError(error) ?? rawDetail
      const operation = operationFromUrl(url)
      const message = detail
        ? `Firestore ${method} ${operation} failed: ${detail}`
        : `Firestore ${method} ${operation} failed (${response.status}).`
      throw new FirestoreRestError(status, response.status, message)
    }
    throw new FirestoreRestError('UNAUTHENTICATED', 401, 'Firestore REST authentication failed.')
  }

  private snapshotFromDocument(document: RestDocument | undefined, fallbackId: string): RestDocumentSnapshot {
    if (!document?.name) return new RestDocumentSnapshot(fallbackId, false, undefined)
    const id = document.name.split('/').at(-1) ?? fallbackId
    return new RestDocumentSnapshot(id, true, decodeFirestoreFields(document.fields ?? {}))
  }

  async getDocument(reference: RestDocumentReference): Promise<DocumentSnapshotLike> {
    try {
      const document = await this.requestJson<RestDocument>(this.documentUrl(reference.path))
      return this.snapshotFromDocument(document, reference.id)
    } catch (error) {
      if (error instanceof FirestoreRestError && error.status === 'NOT_FOUND') {
        return new RestDocumentSnapshot(reference.id, false, undefined)
      }
      throw error
    }
  }

  private async batchGetDocument(
    reference: RestDocumentReference,
    transaction: string,
  ): Promise<DocumentSnapshotLike> {
    const name = this.resourceName(reference.path)
    const response = await this.requestJson<Array<{ found?: RestDocument; missing?: string }>>(
      `${this.documentsBaseUrl()}:batchGet`,
      { body: { documents: [name], transaction } },
    )
    const entry = response.find((item) => item.found?.name === name || item.missing === name) ?? response[0]
    if (!entry) throw new FirestoreRestError('INTERNAL', 500, 'Firestore batchGet returned no result.')
    return this.snapshotFromDocument(entry.found, reference.id)
  }

  async runQuery(query: RestQuery, transaction?: string): Promise<QuerySnapshotLike> {
    const segments = pathSegments(query.path, 'collection')
    const collectionId = segments.at(-1)!
    const parentPath = segments.slice(0, -1).join('/')
    const url = `${this.documentsBaseUrl()}${parentPath ? `/${encodePath(parentPath)}` : ''}:runQuery`

    const fieldFilters = query.filters.map((filter) => ({
      fieldFilter: {
        field: { fieldPath: filter.field },
        op: FILTER_OPERATORS[filter.operator],
        value: encodeFirestoreValue(filter.value),
      },
    }))
    const where = fieldFilters.length === 0
      ? undefined
      : fieldFilters.length === 1
        ? fieldFilters[0]
        : { compositeFilter: { op: 'AND', filters: fieldFilters } }

    // Firestore requires every inequality field to be present in the query
    // ordering. The Admin SDK's implicit ordering appends those fields by
    // field-path name, then __name__. Make that ordering explicit in REST so
    // the overlap query deterministically uses the matching composite index
    // (equality field, check_in, check_out, __name__) instead of depending on
    // backend normalization of an orderless StructuredQuery.
    const inequalityFields = [...new Set(query.filters
      .filter((filter) => ['<', '<=', '>', '>=', '!=', 'not-in'].includes(filter.operator))
      .map((filter) => filter.field))]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const orderBy = inequalityFields.length > 0
      ? [...new Set([...inequalityFields, '__name__'])].map((fieldPath) => ({
          field: { fieldPath },
          direction: 'ASCENDING',
        }))
      : undefined

    const response = await this.requestJson<Array<{ document?: RestDocument; error?: RestErrorBody }>>(url, {
      body: {
        structuredQuery: {
          from: [{ collectionId, allDescendants: false }],
          ...(where ? { where } : {}),
          ...(orderBy ? { orderBy } : {}),
        },
        ...(transaction ? { transaction } : {}),
      },
    })

    const docs: Array<{ id: string; data(): DocumentData }> = []
    for (const entry of response) {
      if (entry.error) {
        const status = statusFromRestError(entry.error, 500)
        throw new FirestoreRestError(
          status,
          httpStatusFromRestError(entry.error, 500),
          messageFromRestError(entry.error) ?? 'Firestore query failed.',
        )
      }
      if (!entry.document?.name) continue
      const snapshot = this.snapshotFromDocument(entry.document, entry.document.name.split('/').at(-1) ?? '')
      docs.push({
        id: snapshot.id,
        data: () => snapshot.data() ?? {},
      })
    }
    return new RestQuerySnapshot(docs)
  }

  private toCommitWrites(write: PendingWrite): RestWrite[] {
    const transformPaths: string[][] = []
    const split = splitServerTimestamps(write.data, [], transformPaths)
    if (split === OMIT || !isPlainObject(split)) {
      throw new TypeError('A Firestore write must contain a document object.')
    }
    const clean = split as DocumentData
    const name = this.resourceName(write.reference.path)
    const writes: RestWrite[] = []

    if (!(write.kind === 'update' && Object.keys(clean).length === 0)) {
      const updateWrite: RestWrite = {
        update: {
          name,
          fields: encodeFirestoreFields(clean),
        },
      }
      if (write.kind === 'update') {
        updateWrite.updateMask = { fieldPaths: Object.keys(clean).map((key) => formatFieldPath([key])) }
        updateWrite.currentDocument = { exists: true }
      }
      if (write.kind === 'create') {
        updateWrite.currentDocument = { exists: false }
      }
      writes.push(updateWrite)
    }

    if (transformPaths.length > 0) {
      writes.push({
        transform: {
          document: name,
          fieldTransforms: transformPaths.map((path) => ({
            fieldPath: formatFieldPath(path),
            setToServerValue: 'REQUEST_TIME',
          })),
        },
      })
    }

    if (writes.length === 0) {
      throw new TypeError('A Firestore write cannot be empty.')
    }
    return writes
  }

  private async commitWrites(writes: readonly PendingWrite[], transaction?: string): Promise<void> {
    await this.requestJson(`${this.documentsBaseUrl()}:commit`, {
      body: {
        writes: writes.flatMap((write) => this.toCommitWrites(write)),
        ...(transaction ? { transaction } : {}),
      },
    })
  }

  async writeDocument(write: PendingWrite): Promise<void> {
    await this.commitWrites([write])
  }

  private async beginTransaction(retryTransaction?: string): Promise<string> {
    const response = await this.requestJson<{ transaction?: unknown }>(
      `${this.documentsBaseUrl()}:beginTransaction`,
      {
        body: {
          options: {
            readWrite: retryTransaction ? { retryTransaction } : {},
          },
        },
      },
    )
    if (typeof response.transaction !== 'string' || !response.transaction) {
      throw new FirestoreRestError('INTERNAL', 500, 'Firestore did not return a transaction ID.')
    }
    return response.transaction
  }

  private async rollback(transaction: string): Promise<void> {
    await this.requestJson(`${this.documentsBaseUrl()}:rollback`, { body: { transaction } })
  }

  async runTransaction<T>(updateFunction: (transaction: TransactionLike) => Promise<T>): Promise<T> {
    let retryTransaction: string | undefined

    for (let attempt = 0; attempt < this.maxTransactionAttempts; attempt += 1) {
      const transactionId = await this.beginTransaction(retryTransaction)
      const transaction = new RestTransaction(this, transactionId)
      try {
        const result = await updateFunction(transaction)
        if (transaction.pendingWrites.length > 0) {
          await this.commitWrites(transaction.pendingWrites, transactionId)
        } else {
          await this.rollback(transactionId).catch(() => undefined)
        }
        return result
      } catch (error) {
        await this.rollback(transactionId).catch(() => undefined)
        if (isAborted(error) && attempt + 1 < this.maxTransactionAttempts) {
          retryTransaction = transactionId
          continue
        }
        throw error
      }
    }

    throw new FirestoreRestError('ABORTED', 409, 'Firestore transaction was aborted repeatedly.')
  }

  async transactionGet(
    transactionId: string,
    target: DocumentReferenceLike | QueryLike,
  ): Promise<DocumentSnapshotLike | QuerySnapshotLike> {
    if (target instanceof RestDocumentReference) {
      return this.batchGetDocument(target, transactionId)
    }
    if (target instanceof RestQuery) {
      return this.runQuery(target, transactionId)
    }
    throw new Error('A non-REST reference reached the Firestore REST transaction adapter.')
  }
}

function randomDocumentId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
}

class RestDocumentReference implements DocumentReferenceLike {
  readonly id: string
  readonly path: string

  constructor(
    private readonly client: FirestoreRestClient,
    path: string,
  ) {
    const segments = pathSegments(path, 'document')
    this.path = segments.join('/')
    this.id = segments.at(-1)!
  }

  async get(): Promise<DocumentSnapshotLike> {
    return this.client.getDocument(this)
  }

  async set(data: DocumentData): Promise<void> {
    await this.client.writeDocument({ kind: 'set', reference: this, data })
  }

  async update(data: DocumentData): Promise<void> {
    await this.client.writeDocument({ kind: 'update', reference: this, data })
  }

  collection(name: string): CollectionReferenceLike {
    return new RestCollectionReference(this.client, `${this.path}/${validateSegment(name, 'collection ID')}`)
  }
}

class RestQuery implements QueryLike {
  readonly path: string

  constructor(
    protected readonly client: FirestoreRestClient,
    path: string,
    readonly filters: readonly QueryFilter[] = [],
  ) {
    this.path = pathSegments(path, 'collection').join('/')
  }

  where(field: string, operator: WhereOperator, value: unknown): QueryLike {
    return new RestQuery(this.client, this.path, [...this.filters, { field, operator, value }])
  }

  async get(): Promise<QuerySnapshotLike> {
    return this.client.runQuery(this)
  }
}

class RestCollectionReference extends RestQuery implements CollectionReferenceLike {
  doc(id?: string): DocumentReferenceLike {
    return new RestDocumentReference(
      this.client,
      `${this.path}/${id === undefined ? randomDocumentId() : validateSegment(id, 'document ID')}`,
    )
  }
}

class RestTransaction implements TransactionLike {
  readonly pendingWrites: PendingWrite[] = []
  private writing = false

  constructor(
    private readonly client: FirestoreRestClient,
    private readonly transactionId: string,
  ) {}

  get(reference: DocumentReferenceLike): Promise<DocumentSnapshotLike>
  get(query: QueryLike): Promise<QuerySnapshotLike>
  async get(target: DocumentReferenceLike | QueryLike): Promise<DocumentSnapshotLike | QuerySnapshotLike> {
    if (this.writing) {
      throw new Error('Firestore transaction reads must happen before writes.')
    }
    return this.client.transactionGet(this.transactionId, target)
  }

  private requireReference(reference: DocumentReferenceLike): RestDocumentReference {
    if (!(reference instanceof RestDocumentReference)) {
      throw new Error('A non-REST document reference reached the Firestore REST transaction adapter.')
    }
    return reference
  }

  private add(kind: WriteKind, reference: DocumentReferenceLike, data: DocumentData): this {
    this.writing = true
    this.pendingWrites.push({
      kind,
      reference: this.requireReference(reference),
      data: structuredClone(data),
    })
    return this
  }

  set(reference: DocumentReferenceLike, data: DocumentData): unknown {
    return this.add('set', reference, data)
  }

  create(reference: DocumentReferenceLike, data: DocumentData): unknown {
    return this.add('create', reference, data)
  }

  update(reference: DocumentReferenceLike, data: DocumentData): unknown {
    return this.add('update', reference, data)
  }
}
