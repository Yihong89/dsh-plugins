/**
 * dsh-codebase-memory: persistent per-workspace codebase knowledge memory for
 * DeepSeek Harness. One host-plane plugin row registers:
 *
 * - the `memory_store` / `memory_recall` / `memory_forget` / `memory_list`
 *   model tools over a per-workspace JSON memory file;
 * - the `/memory` human command (recent entries or keyword search);
 * - an optional one-line system-prompt hint and an optional session-start
 *   injection of the most recent memories.
 *
 * @module dsh-codebase-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { MemoryStore, memoryFilePath } from './store.js'
import type { MemoryKind, MemorySearchRow } from './types.js'
import type { QueryOptions } from './store.js'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'dsh-codebase-memory'
export const inject = ['tools', 'commands']

const KINDS = ['entity', 'decision', 'convention', 'note'] as const
const MAX_LIMIT = 50
const DEFAULT_LIMIT_HINT = 5

/** Plugin configuration, settable from the cordis.yml entry's `config:` block. */
export interface Config {
  /** Directory name for the memory file inside each workspace (default `.dsh-memory`). */
  dirName: string
  /** Memory file name inside that directory (default `memory.json`). */
  fileName: string
  /** Hard cap on entries per workspace; the oldest are dropped beyond it (default 2000). */
  maxEntries: number
  /** Default result limit for recall/list (default 5). */
  defaultLimit: number
  /** Contribute a one-line system-prompt hint about the memory tools (default true). */
  workspaceHint: boolean
  /** Inject the most recent memories into each new session's context (default false). */
  injectOnStart: boolean
  /** How many entries the session-start injection includes (default 5). */
  injectCount: number
  /** Maximum characters of injected digest text (default 2000). */
  injectMaxChars: number
}

export const Config: z<Config> = z.object({
  dirName: z.string().default('.dsh-memory'),
  fileName: z.string().default('memory.json'),
  maxEntries: z.natural().default(2000),
  defaultLimit: z.natural().default(5),
  workspaceHint: z.boolean().default(true),
  injectOnStart: z.boolean().default(false),
  injectCount: z.natural().default(5),
  injectMaxChars: z.natural().default(2000),
})

const textBlock = (text: string): { type: 'text'; text: string } => ({ type: 'text', text })

/** One rendered line of a search/list result row. */
function rowLine(row: MemorySearchRow): string {
  const scope = row.scope === undefined ? '' : ` (${row.scope})`
  return `[${row.kind}] ${row.subject}${scope}: ${row.content}`
}

/** Human text for the `/memory` command and the tools' renders. */
function renderRows(outcome: { total: number; entries: MemorySearchRow[] }, heading: string): string {
  if (outcome.entries.length === 0) {
    return `${heading} — no matches. Store knowledge with memory_store, or tell the agent to.`
  }
  const shown = outcome.total > outcome.entries.length ? ` (${outcome.entries.length} of ${outcome.total})` : ''
  return `${heading}${shown}:\n${outcome.entries.map(rowLine).join('\n')}`
}

/** Build a QueryOptions object without ever materializing `undefined` values. */
function queryOptions(kind: MemoryKind | undefined, scope: string | undefined, tags: string[] | undefined, limit: number | undefined): QueryOptions {
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(scope === undefined ? {} : { scope }),
    ...(tags === undefined ? {} : { tags }),
    ...(limit === undefined ? {} : { limit }),
  }
}

const ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: [...KINDS] },
    subject: { type: 'string', required: true },
    content: { type: 'string', required: true },
    scope: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    updatedAt: { type: 'integer', required: true },
  },
} as const

const ENTRIES_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    total: { type: 'integer', required: true },
    entries: { type: 'array', required: true, items: ROW_SCHEMA },
  },
} as const

/**
 * Register the memory tools, the `/memory` command, and the optional prompt
 * hint / session-start injection on the calling context.
 * @param ctx - registrant context carrying the tool and command registries.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const stores = new Map<string, MemoryStore>()

  /** The memory store for one session's workspace, cached per file path. */
  const storeFor = (session: Session): MemoryStore => {
    const cwd = session.header.cwd ?? process.cwd()
    const filePath = memoryFilePath(cwd, config.dirName, config.fileName)
    let store = stores.get(filePath)
    if (store === undefined) {
      store = new MemoryStore(filePath, {
        maxEntries: config.maxEntries,
        defaultLimit: config.defaultLimit,
        maxLimit: MAX_LIMIT,
      })
      stores.set(filePath, store)
    }
    return store
  }

  ctx.tools.register(defineTool({
    name: 'memory_store',
    description: 'Persist one piece of knowledge about this codebase so future sessions remember it. '
      + 'Use after you learn something non-obvious that later sessions would otherwise re-discover. '
      + 'Upserts by (kind, subject, scope) or by an explicit id.',
    parameters: {
      subject: { type: 'string', required: true, description: 'The subject — a function, class, file, module, or area name.' },
      content: { type: 'string', required: true, description: 'The knowledge itself: concrete, specific, and useful for later sessions.' },
      kind: { type: 'string', enum: [...KINDS], description: 'Category: entity (how a symbol works), decision (why something was done), convention (style/pattern), note (anything else).' },
      scope: { type: 'string', description: 'Optional file path, glob, or module this entry applies to.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional search tags.' },
      id: { type: 'string', description: 'Optional id of an existing entry to update; otherwise upserts by (kind, subject, scope).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: [...KINDS] },
          created: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [textBlock(
        `${value.created ? 'Stored' : 'Updated'} memory ${value.id} (${value.kind}: ${value.subject})`,
      )],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('memory_store requires an owning agent session')
      const outcome = await storeFor(exec.agent.session).upsert({
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        subject: args.subject,
        content: args.content,
        ...(args.scope === undefined ? {} : { scope: args.scope }),
        ...(args.tags === undefined ? {} : { tags: args.tags }),
        ...(args.id === undefined ? {} : { id: args.id }),
      }, exec.agent.session.id)
      return {
        id: outcome.entry.id,
        subject: outcome.entry.subject,
        kind: outcome.entry.kind,
        created: outcome.created,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_recall',
    description: 'Search the persistent codebase memory for what past sessions learned. '
      + 'Call this before exploring an area you have worked on before; omit the query to list the most recent entries.',
    parameters: {
      query: { type: 'string', description: 'Keywords or a phrase to match against subjects, tags, scopes, and content. Omit to list the most recent entries.' },
      kind: { type: 'string', enum: [...KINDS], description: 'Optional category filter.' },
      scope: { type: 'string', description: 'Optional file path or module filter (prefix match).' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter (any match).' },
      limit: { type: 'integer', description: `Max entries (default ${DEFAULT_LIMIT_HINT}, max ${MAX_LIMIT}).` },
    },
    output: { schema: ENTRIES_OUTPUT, render: (_args, value) => [textBlock(renderRows(value, 'Codebase memory'))] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('memory_recall requires an owning agent session')
      return storeFor(exec.agent.session).search(args.query ?? '', queryOptions(args.kind, args.scope, args.tags, args.limit))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: 'Delete entries from the persistent codebase memory. Provide an id, or a subject (optionally refined by kind/scope).',
    parameters: {
      id: { type: 'string', description: 'Exact id of the entry to delete.' },
      subject: { type: 'string', description: 'Subject whose entries to delete (requires exactly one of id or subject).' },
      kind: { type: 'string', enum: [...KINDS], description: 'Refines the subject match.' },
      scope: { type: 'string', description: 'Refines the subject match.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'integer', required: true } },
      },
      render: (_args, value) => [textBlock(`Removed ${value.removed} memory entr${value.removed === 1 ? 'y' : 'ies'}.`)],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('memory_forget requires an owning agent session')
      if (args.id === undefined && args.subject === undefined) {
        throw new Error('memory_forget requires exactly one of id or subject')
      }
      const removed = await storeFor(exec.agent.session).remove({
        ...(args.id === undefined ? {} : { id: args.id }),
        ...(args.subject === undefined ? {} : { subject: args.subject }),
        ...(args.kind === undefined ? {} : { kind: args.kind }),
        ...(args.scope === undefined ? {} : { scope: args.scope }),
      })
      return { removed }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: 'List the entries in the persistent codebase memory, newest first.',
    parameters: {
      kind: { type: 'string', enum: [...KINDS], description: 'Optional category filter.' },
      limit: { type: 'integer', description: `Max entries (default ${DEFAULT_LIMIT_HINT}, max ${MAX_LIMIT}).` },
    },
    output: { schema: ENTRIES_OUTPUT, render: (_args, value) => [textBlock(renderRows(value, 'Codebase memory'))] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('memory_list requires an owning agent session')
      return storeFor(exec.agent.session).list(queryOptions(args.kind, undefined, undefined, args.limit))
    },
  }))

  ctx.commands.register({
    name: 'memory',
    description: 'Show this workspace\'s codebase memory: recent entries, or search with keywords',
    handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const store = storeFor(invocation.agent.session)
      const query = invocation.rawInput.trim()
      try {
        const outcome = query.length === 0
          ? await store.list({ limit: 8 })
          : await store.search(query, { limit: 8 })
        return {
          kind: 'success',
          text: renderRows(outcome, query.length === 0 ? 'Codebase memory' : `Codebase memory matches for ${JSON.stringify(query)}`),
        }
      } catch (error: unknown) {
        return { kind: 'error', text: `codebase memory: ${String(error)}` }
      }
    },
  })

  if (config.workspaceHint) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'codebase-memory',
        order: 120,
        text: 'This workspace keeps a persistent codebase memory. When you learn something a later session would need, save it with memory_store; before re-exploring, use memory_recall to see what past sessions already learned.',
      })
    })
  }

  if (config.injectOnStart) {
    ctx.on('agent/session-start', ({ agent }) => {
      try {
        const digest = storeFor(agent.session).digest(config.injectCount, config.injectMaxChars)
        if (digest.length === 0) return
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: digest }],
          source: { kind: 'plugin', plugin: 'codebase-memory' },
        }))
      } catch (error: unknown) {
        ctx.logger.warn(`codebase-memory: session-start injection failed: ${String(error)}`)
      }
    })
  }
}
