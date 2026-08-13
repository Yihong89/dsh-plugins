/**
 * The per-workspace memory store: a JSON file (`.dsh-memory/memory.json` by
 * default) holding the codebase knowledge entries, with atomic writes and
 * mtime-based refresh so several sessions/processes can share one file.
 *
 * @module dsh-codebase-memory/store
 */
import { type MemoryEntry, type MemoryKind, type MemorySearchRow } from './types.js';
/** Options fixed at construction. */
export interface MemoryStoreOptions {
    /** Hard cap on entries; the oldest by `updatedAt` are dropped beyond it. */
    maxEntries: number;
    /** Default result limit for search/list. */
    defaultLimit: number;
    /** Absolute maximum a caller may request. */
    maxLimit: number;
}
/** An entry as submitted for creation or update. */
export interface MemoryInput {
    kind?: MemoryKind;
    subject: string;
    content: string;
    scope?: string;
    tags?: string[];
    /** When present, updates that entry instead of upserting by (kind, subject, scope). */
    id?: string;
}
export interface UpsertOutcome {
    entry: MemoryEntry;
    created: boolean;
}
export interface QueryOptions {
    kind?: MemoryKind;
    scope?: string;
    tags?: string[];
    limit?: number;
}
export interface QueryOutcome {
    total: number;
    entries: MemorySearchRow[];
}
/**
 * One memory file's in-process view. Reads refresh on external change
 * (mtime/size); mutations serialize through an internal promise queue and
 * write atomically (tmp file + rename).
 */
export declare class MemoryStore {
    private readonly filePath;
    private readonly maxEntries;
    private readonly defaultLimit;
    private readonly maxLimit;
    private entries;
    private readonly fileDir;
    private loadedStat;
    private queue;
    private loadWarned;
    constructor(filePath: string, options: MemoryStoreOptions);
    /** The resolved memory file path this store owns. */
    get path(): string;
    /** Re-read the file when its mtime/size changed since the last load. */
    private refresh;
    /** Atomic persist: write the tmp file, then rename over the target. */
    private persist;
    /** Serialize one mutation through the per-store queue. */
    private mutate;
    /** Drop the oldest entries (by `updatedAt`) beyond the cap. */
    private enforceCap;
    /**
     * Insert or update one entry. An explicit `id` targets that entry; otherwise
     * the (kind, subject, scope) triple upserts.
     * @returns the entry and whether it was created.
     */
    upsert(input: MemoryInput, sourceSession?: string): Promise<UpsertOutcome>;
    /**
     * Keyword search over the entries, ranked by relevance then recency. An
     * empty query returns the most recent entries.
     */
    search(query: string, options: QueryOptions): Promise<QueryOutcome>;
    /** List entries, newest first, with optional kind filter. */
    list(options: QueryOptions): Promise<QueryOutcome>;
    /**
     * Delete entries by exact id, or by exact (kind, subject, scope).
     * @returns the number of removed entries.
     */
    remove(target: {
        id?: string;
        kind?: MemoryKind;
        subject?: string;
        scope?: string;
    }): Promise<number>;
    /** Current entry count. */
    count(): Promise<number>;
    /** The N most recent entries as plain text (for session-start injection). */
    digest(limit: number, maxChars: number): string;
}
/**
 * Resolve the memory file path for one workspace directory.
 * @param workspaceDir - the session's working directory.
 * @param dirName - the memory directory name inside the workspace (default `.dsh-memory`).
 * @param fileName - the memory file name inside that directory (default `memory.json`).
 * @returns the absolute memory file path.
 */
export declare function memoryFilePath(workspaceDir: string, dirName: string, fileName: string): string;
/** A text content block helper reused by the command/tool renderers. */
export declare const text: (text: string) => {
    type: "text";
    text: string;
};
