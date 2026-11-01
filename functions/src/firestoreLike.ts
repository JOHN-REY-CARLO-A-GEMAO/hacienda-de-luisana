/**
 * The small Firestore surface the booking/quote services actually use.
 *
 * Firebase's Admin SDK and the Cloudflare Worker's Firestore REST client both
 * implement this interface. Keeping the seam this small lets the transactional
 * business rules stay in one implementation while each runtime owns its own
 * transport, authentication, and server-timestamp representation.
 */

export interface ServerTimestampValue {
  readonly __hacienda_server_timestamp__: true
}

/**
 * A shape-recognised sentinel (rather than one object identity), because test
 * fakes and structured clones may copy write payloads before an adapter gets
 * to translate them into `FieldValue.serverTimestamp()` or a REST
 * `REQUEST_TIME` field transform.
 */
export const SERVER_TIMESTAMP: ServerTimestampValue = Object.freeze({
  __hacienda_server_timestamp__: true,
})

export function isServerTimestamp(value: unknown): value is ServerTimestampValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    return false
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.length === 1 && record.__hacienda_server_timestamp__ === true
}

export type DocumentData = Record<string, unknown>

export interface DocumentSnapshotLike {
  readonly id: string
  readonly exists: boolean
  data(): DocumentData | undefined
}

export interface QueryDocumentSnapshotLike {
  readonly id: string
  data(): DocumentData
}

export interface QuerySnapshotLike {
  readonly docs: QueryDocumentSnapshotLike[]
  readonly empty: boolean
  readonly size: number
}

export type WhereOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'not-in'
  | 'array-contains'
  | 'array-contains-any'

export interface QueryLike {
  readonly path: string
  where(field: string, operator: WhereOperator, value: unknown): QueryLike
  get(): Promise<QuerySnapshotLike>
}

export interface CollectionReferenceLike extends QueryLike {
  doc(id?: string): DocumentReferenceLike
}

export interface DocumentReferenceLike {
  readonly id: string
  readonly path: string
  get(): Promise<DocumentSnapshotLike>
  set(data: DocumentData): Promise<unknown>
  update(data: DocumentData): Promise<unknown>
  collection(name: string): CollectionReferenceLike
}

export interface TransactionLike {
  get(reference: DocumentReferenceLike): Promise<DocumentSnapshotLike>
  get(query: QueryLike): Promise<QuerySnapshotLike>
  set(reference: DocumentReferenceLike, data: DocumentData): unknown
  create(reference: DocumentReferenceLike, data: DocumentData): unknown
  update(reference: DocumentReferenceLike, data: DocumentData): unknown
}

export interface FirestoreLike {
  doc(path: string): DocumentReferenceLike
  collection(path: string): CollectionReferenceLike
  runTransaction<T>(updateFunction: (transaction: TransactionLike) => Promise<T>): Promise<T>
}
