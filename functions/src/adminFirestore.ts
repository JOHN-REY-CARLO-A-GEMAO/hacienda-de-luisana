/**
 * Adapt Firebase Admin Firestore to the small `FirestoreLike` surface used by
 * the shared booking/quote core. The only translation this layer performs is
 * the server-timestamp sentinel: core payloads carry `SERVER_TIMESTAMP`, and
 * Admin writes receive a real `FieldValue.serverTimestamp()` at this seam.
 */

import {
  FieldValue,
  type CollectionReference,
  type DocumentData as AdminDocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore'
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
} from './firestoreLike'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function toAdminValue(value: unknown): unknown {
  if (isServerTimestamp(value)) return FieldValue.serverTimestamp()
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map(toAdminValue)
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toAdminValue(entry)]),
    )
  }
  return value
}

function toAdminData(data: DocumentData): AdminDocumentData {
  return toAdminValue(data) as AdminDocumentData
}

class AdminDocumentReference implements DocumentReferenceLike {
  constructor(readonly inner: DocumentReference) {}

  get id(): string {
    return this.inner.id
  }

  get path(): string {
    return this.inner.path
  }

  async get(): Promise<DocumentSnapshotLike> {
    return (await this.inner.get()) as unknown as DocumentSnapshotLike
  }

  async set(data: DocumentData): Promise<unknown> {
    return this.inner.set(toAdminData(data))
  }

  async update(data: DocumentData): Promise<unknown> {
    return this.inner.update(toAdminData(data))
  }

  collection(name: string): CollectionReferenceLike {
    return new AdminCollectionReference(this.inner.collection(name))
  }
}

class AdminQuery implements QueryLike {
  constructor(
    readonly inner: Query,
    readonly path: string,
  ) {}

  where(field: string, operator: WhereOperator, value: unknown): QueryLike {
    return new AdminQuery(this.inner.where(field, operator, value), this.path)
  }

  async get(): Promise<QuerySnapshotLike> {
    return (await this.inner.get()) as unknown as QuerySnapshotLike
  }
}

class AdminCollectionReference extends AdminQuery implements CollectionReferenceLike {
  constructor(private readonly collectionInner: CollectionReference) {
    super(collectionInner, collectionInner.path)
  }

  doc(id?: string): DocumentReferenceLike {
    return new AdminDocumentReference(id === undefined ? this.collectionInner.doc() : this.collectionInner.doc(id))
  }
}

function requireDocument(reference: DocumentReferenceLike): AdminDocumentReference {
  if (!(reference instanceof AdminDocumentReference)) {
    throw new Error('A non-Admin document reference reached the Admin transaction adapter.')
  }
  return reference
}

class AdminTransaction implements TransactionLike {
  constructor(private readonly inner: Transaction) {}

  get(reference: DocumentReferenceLike): Promise<DocumentSnapshotLike>
  get(query: QueryLike): Promise<QuerySnapshotLike>
  async get(target: DocumentReferenceLike | QueryLike): Promise<DocumentSnapshotLike | QuerySnapshotLike> {
    if (target instanceof AdminDocumentReference) {
      return (await this.inner.get(target.inner)) as unknown as DocumentSnapshotLike
    }
    if (target instanceof AdminQuery) {
      return (await this.inner.get(target.inner)) as unknown as QuerySnapshotLike
    }
    throw new Error('A non-Admin query reached the Admin transaction adapter.')
  }

  set(reference: DocumentReferenceLike, data: DocumentData): unknown {
    this.inner.set(requireDocument(reference).inner, toAdminData(data))
    return this
  }

  create(reference: DocumentReferenceLike, data: DocumentData): unknown {
    this.inner.create(requireDocument(reference).inner, toAdminData(data))
    return this
  }

  update(reference: DocumentReferenceLike, data: DocumentData): unknown {
    this.inner.update(requireDocument(reference).inner, toAdminData(data))
    return this
  }
}

export function toFirestoreLike(firestore: Firestore): FirestoreLike {
  return {
    doc(path: string) {
      return new AdminDocumentReference(firestore.doc(path))
    },
    collection(path: string) {
      return new AdminCollectionReference(firestore.collection(path))
    },
    runTransaction<T>(updateFunction: (transaction: TransactionLike) => Promise<T>) {
      return firestore.runTransaction((transaction) => updateFunction(new AdminTransaction(transaction)))
    },
  }
}
