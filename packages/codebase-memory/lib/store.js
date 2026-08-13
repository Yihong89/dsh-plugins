/**
 * The per-workspace memory store: a JSON file (`.dsh-memory/memory.json` by
 * default) holding the codebase knowledge entries, with atomic writes and
 * mtime-based refresh so several sessions/processes can share one file.
 *
 * @module dsh-codebase-memory/store
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FILE_VERSION } from './types.js';
const textBlock = (text) => ({ type: 'text', text });
const EMPTY_FILE = { version: FILE_VERSION, entries: [] };
/** Lowercase tokens of a string: word splits plus camelCase/snake_case segmentation. */
function tokensOf(value) {
    const tokens = new Set();
    for (const part of value.split(/[^a-zA-Z0-9]+/)) {
        if (part.length === 0)
            continue;
        tokens.add(part.toLowerCase());
        for (const segment of part.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
            const lower = segment.toLowerCase();
            if (lower.length > 0)
                tokens.add(lower);
        }
    }
    return tokens;
}
/** Keyword relevance score of one entry against the query tokens. */
function scoreOf(entry, queryTokens) {
    let score = 0;
    const subjectTokens = tokensOf(entry.subject);
    const tagTokens = tokensOf(entry.tags?.join(' ') ?? '');
    const scopeTokens = tokensOf(entry.scope ?? '');
    const contentTokens = tokensOf(entry.content);
    for (const token of queryTokens) {
        if (subjectTokens.has(token))
            score += 3;
        if (tagTokens.has(token))
            score += 2;
        if (scopeTokens.has(token))
            score += 2;
        if (contentTokens.has(token))
            score += 1;
        if (entry.subject.toLowerCase().includes(token))
            score += 1;
    }
    return score;
}
function toRow(entry) {
    return {
        id: entry.id,
        kind: entry.kind,
        subject: entry.subject,
        content: entry.content,
        ...(entry.scope === undefined ? {} : { scope: entry.scope }),
        ...(entry.tags === undefined ? {} : { tags: entry.tags }),
        updatedAt: entry.updatedAt,
    };
}
/**
 * One memory file's in-process view. Reads refresh on external change
 * (mtime/size); mutations serialize through an internal promise queue and
 * write atomically (tmp file + rename).
 */
export class MemoryStore {
    filePath;
    maxEntries;
    defaultLimit;
    maxLimit;
    entries = [];
    fileDir;
    loadedStat = null;
    queue = Promise.resolve();
    loadWarned = false;
    constructor(filePath, options) {
        this.filePath = filePath;
        this.fileDir = dirname(filePath);
        this.maxEntries = options.maxEntries;
        this.defaultLimit = options.defaultLimit;
        this.maxLimit = options.maxLimit;
        this.refresh();
    }
    /** The resolved memory file path this store owns. */
    get path() {
        return this.filePath;
    }
    /** Re-read the file when its mtime/size changed since the last load. */
    refresh() {
        if (!existsSync(this.filePath))
            return;
        const stat = statSync(this.filePath);
        if (this.loadedStat !== null
            && stat.mtimeMs === this.loadedStat.mtimeMs
            && stat.size === this.loadedStat.size)
            return;
        this.loadedStat = { mtimeMs: stat.mtimeMs, size: stat.size };
        let raw;
        try {
            raw = readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed?.version !== FILE_VERSION || !Array.isArray(parsed.entries)) {
                throw new Error(`unsupported memory file version/shape: ${JSON.stringify(parsed?.version)}`);
            }
            this.entries = parsed.entries.filter(isEntry);
        }
        catch (error) {
            // Never clobber or crash on a foreign/corrupt file: back it up once and
            // start empty, keeping the operator's data recoverable.
            if (!this.loadWarned) {
                this.loadWarned = true;
                const backup = `${this.filePath}.corrupt-${Date.now()}`;
                try {
                    renameSync(this.filePath, backup);
                    process.stderr.write(`dsh-codebase-memory: ${this.filePath} unreadable (${String(error)}); moved to ${backup}\n`);
                }
                catch {
                    // The backup move failing is not worth crashing the plugin over.
                }
                this.entries = [];
            }
        }
    }
    /** Atomic persist: write the tmp file, then rename over the target. */
    persist() {
        mkdirSync(this.fileDir, { recursive: true });
        const payload = `${JSON.stringify({ version: FILE_VERSION, entries: this.entries }, null, 2)}\n`;
        const tmp = `${this.filePath}.tmp-${process.pid}`;
        writeFileSync(tmp, payload, 'utf8');
        renameSync(tmp, this.filePath);
        const stat = statSync(this.filePath);
        this.loadedStat = { mtimeMs: stat.mtimeMs, size: stat.size };
    }
    /** Serialize one mutation through the per-store queue. */
    mutate(operation) {
        const next = this.queue.then(operation, operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    /** Drop the oldest entries (by `updatedAt`) beyond the cap. */
    enforceCap() {
        if (this.entries.length <= this.maxEntries)
            return;
        const sorted = [...this.entries].sort((a, b) => a.updatedAt - b.updatedAt);
        const keep = new Set(sorted.slice(-this.maxEntries).map(entry => entry.id));
        this.entries = this.entries.filter(entry => keep.has(entry.id));
    }
    /**
     * Insert or update one entry. An explicit `id` targets that entry; otherwise
     * the (kind, subject, scope) triple upserts.
     * @returns the entry and whether it was created.
     */
    upsert(input, sourceSession) {
        return this.mutate(() => {
            this.refresh();
            const now = Date.now();
            const kind = input.kind ?? 'note';
            const existing = input.id !== undefined
                ? this.entries.find(entry => entry.id === input.id)
                : this.entries.find(entry => entry.kind === kind
                    && entry.subject === input.subject
                    && (entry.scope ?? undefined) === (input.scope ?? undefined));
            if (existing !== undefined) {
                const mergedTags = mergeTags(existing.tags, input.tags);
                const merged = {
                    ...existing,
                    kind,
                    content: input.content,
                    ...(input.scope === undefined ? {} : { scope: input.scope }),
                    ...(mergedTags === undefined ? {} : { tags: mergedTags }),
                    updatedAt: now,
                };
                this.entries = this.entries.map(entry => entry.id === existing.id ? merged : entry);
                this.persist();
                return { entry: merged, created: false };
            }
            const entry = {
                id: `m_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
                kind,
                subject: input.subject,
                content: input.content,
                ...(input.scope === undefined ? {} : { scope: input.scope }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                createdAt: now,
                updatedAt: now,
                ...(sourceSession === undefined ? {} : { sourceSession }),
            };
            this.entries.push(entry);
            this.enforceCap();
            this.persist();
            return { entry, created: true };
        });
    }
    /**
     * Keyword search over the entries, ranked by relevance then recency. An
     * empty query returns the most recent entries.
     */
    search(query, options) {
        return this.mutate(() => {
            this.refresh();
            const queryTokens = tokensOf(query);
            const tags = options.tags;
            const filtered = this.entries.filter(entry => (options.kind === undefined || entry.kind === options.kind)
                && (options.scope === undefined
                    || (entry.scope ?? '') === options.scope
                    || (entry.scope ?? '').startsWith(options.scope))
                && (tags === undefined || (entry.tags ?? []).some(tag => tags.includes(tag))));
            const scored = filtered
                .map(entry => ({ entry, score: queryTokens.size === 0 ? 1 : scoreOf(entry, queryTokens) }))
                .filter(item => queryTokens.size === 0 || item.score > 0);
            scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);
            const limit = clampLimit(options.limit, this.defaultLimit, this.maxLimit);
            return {
                total: scored.length,
                entries: scored.slice(0, limit).map(item => toRow(item.entry)),
            };
        });
    }
    /** List entries, newest first, with optional kind filter. */
    list(options) {
        return this.mutate(() => {
            this.refresh();
            const filtered = this.entries.filter(entry => (options.kind === undefined || entry.kind === options.kind)
                && (options.scope === undefined || (entry.scope ?? '').startsWith(options.scope)));
            filtered.sort((a, b) => b.updatedAt - a.updatedAt);
            const limit = clampLimit(options.limit, this.defaultLimit, this.maxLimit);
            return {
                total: filtered.length,
                entries: filtered.slice(0, limit).map(toRow),
            };
        });
    }
    /**
     * Delete entries by exact id, or by exact (kind, subject, scope).
     * @returns the number of removed entries.
     */
    remove(target) {
        return this.mutate(() => {
            this.refresh();
            const before = this.entries.length;
            this.entries = this.entries.filter(entry => {
                if (target.id !== undefined && entry.id === target.id)
                    return false;
                if (target.subject !== undefined
                    && entry.subject === target.subject
                    && (target.kind === undefined || entry.kind === target.kind)
                    && (target.scope === undefined || (entry.scope ?? undefined) === target.scope))
                    return false;
                return true;
            });
            const removed = before - this.entries.length;
            if (removed > 0)
                this.persist();
            return removed;
        });
    }
    /** Current entry count. */
    count() {
        return this.mutate(() => {
            this.refresh();
            return this.entries.length;
        });
    }
    /** The N most recent entries as plain text (for session-start injection). */
    digest(limit, maxChars) {
        this.refresh();
        const sorted = [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
        if (sorted.length === 0)
            return '';
        const lines = sorted.map(entry => {
            const clipped = entry.content.length > 140 ? `${entry.content.slice(0, 139)}…` : entry.content;
            const scope = entry.scope === undefined ? '' : ` (${entry.scope})`;
            return `- [${entry.kind}] ${entry.subject}${scope}: ${clipped}`;
        });
        let text = `Codebase memory — knowledge stored by past sessions:\n${lines.join('\n')}`;
        if (text.length > maxChars)
            text = `${text.slice(0, maxChars - 1)}…`;
        return text;
    }
}
function isEntry(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const entry = value;
    return typeof entry.id === 'string'
        && typeof entry.subject === 'string'
        && typeof entry.content === 'string'
        && (entry.kind === 'entity' || entry.kind === 'decision' || entry.kind === 'convention' || entry.kind === 'note')
        && typeof entry.createdAt === 'number'
        && typeof entry.updatedAt === 'number';
}
function mergeTags(existing, next) {
    if (existing === undefined && next === undefined)
        return undefined;
    const merged = [...(existing ?? []), ...(next ?? [])];
    return [...new Set(merged)];
}
function clampLimit(requested, fallback, max) {
    if (requested === undefined)
        return fallback;
    if (!Number.isFinite(requested) || requested <= 0)
        return fallback;
    return Math.min(Math.floor(requested), max);
}
/**
 * Resolve the memory file path for one workspace directory.
 * @param workspaceDir - the session's working directory.
 * @param dirName - the memory directory name inside the workspace (default `.dsh-memory`).
 * @param fileName - the memory file name inside that directory (default `memory.json`).
 * @returns the absolute memory file path.
 */
export function memoryFilePath(workspaceDir, dirName, fileName) {
    return resolve(join(workspaceDir, dirName, fileName));
}
/** A text content block helper reused by the command/tool renderers. */
export const text = textBlock;
