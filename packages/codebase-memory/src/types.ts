/**
 * Pure types of the codebase-memory domain: the durable entry shape and the
 * on-disk file format. Type-only, importable by any consumer.
 *
 * @module dsh-codebase-memory/types
 */

/** The entry categories the model can store. */
export type MemoryKind = 'entity' | 'decision' | 'convention' | 'note'

/** One durable knowledge entry about the codebase. */
export interface MemoryEntry {
  /** Stable unique id, assigned at creation. */
  id: string
  /** Category: what kind of knowledge this is. */
  kind: MemoryKind
  /** The subject — a function, class, file, module, or area name. */
  subject: string
  /** What was learned — the knowledge text. */
  content: string
  /** Optional file path, glob, or module the entry applies to. */
  scope?: string
  /** Optional search tags. */
  tags?: string[]
  /** Unix epoch milliseconds at creation. */
  createdAt: number
  /** Unix epoch milliseconds at last update. */
  updatedAt: number
  /** Optional id of the session that stored the entry. */
  sourceSession?: string
}

/** The on-disk memory file. Bump {@link FILE_VERSION} on any format change. */
export interface MemoryFile {
  version: 1
  entries: MemoryEntry[]
}

export const FILE_VERSION = 1

/** The model-facing search result row (plain JSON, tool canonical value). */
export interface MemorySearchRow {
  id: string
  kind: MemoryKind
  subject: string
  content: string
  scope?: string
  tags?: string[]
  updatedAt: number
}
