# dsh-codebase-memory

A DeepSeek Harness plugin giving the agent a **persistent, per-workspace
codebase memory** — the same function as the original `codebase-memory-mcp`:
knowledge the agent learns about your codebase (how a function works, why a
decision was made, project conventions) is stored durably and recalled in
later sessions, so each new session starts where the last one left off instead
of re-discovering the codebase.

One host-plane plugin row registers:

- **`memory_store`** — persist one piece of knowledge (entity / decision /
  convention / note). Upserts by `(kind, subject, scope)` or by explicit id.
- **`memory_recall`** — keyword search over stored knowledge (camelCase and
  snake_case aware), ranked by relevance then recency; empty query lists the
  most recent entries.
- **`memory_forget`** — delete by id or subject.
- **`memory_list`** — all entries, newest first, optional kind filter.
- **`/memory`** — human command: recent entries or keyword search.
- **optional prompt hint** — a one-line system-prompt section telling the
  model the memory exists (on by default).
- **optional session-start injection** — inject the most recent memories into
  each new session's context (off by default).

## Storage

One JSON file per workspace, written atomically (tmp + rename), readable by
every session and process sharing the workspace (mtime-based refresh):

```
<workspace>/.dsh-memory/memory.json
```

Like codebase-memory-mcp's graph artifact, the file lives **in the project**,
so it survives machine changes and can be committed or ignored however you
prefer (add `.dsh-memory/` to `.gitignore` if you don't want it in the repo).

## Install

Requirements: a DSH profile with the `tools` and `commands` services (the
`web` and `headless` profiles provide them via `dsh-base`).

```sh
# 1. make the plugin available to your profile (installs from this GitHub repo)
dsh plugin --profile web add -w 'github:Yihong89/dsh-plugins#main&path:packages/codebase-memory'

# 2. activate it in the profile's patch layer
#    add to ~/.dsh/profiles/web/cordis.patch.yml:
#
#    - insert:
#        - id: codebase-memory
#          name: 'dsh-codebase-memory'

# the loader hot-reloads config changes; no restart is needed
```

## Configuration

```yaml
- id: codebase-memory
  name: 'dsh-codebase-memory'
  config:
    dirName: .dsh-memory        # memory directory inside each workspace
    fileName: memory.json       # memory file name
    maxEntries: 2000            # hard cap; oldest entries dropped beyond it
    defaultLimit: 5             # default recall/list result limit
    workspaceHint: true         # one-line system-prompt hint about the memory
    injectOnStart: false        # inject recent memories into new sessions
    injectCount: 5              # entries included in the session-start injection
    injectMaxChars: 2000        # char cap for the injected digest
```

## Usage

The model calls the tools itself (e.g. "remember how `retryPolicy` works" →
`memory_store`, "have we seen this before?" → `memory_recall`). For humans:

```text
/memory                → 8 most recent entries + total
/memory retry policy   → keyword search
```

## Design notes

- **The store is the file.** The in-process `MemoryStore` keeps a cached view
  per workspace, refreshes on external change (mtime/size), and serializes
  mutations through a per-store queue with atomic writes, so concurrent
  sessions in one workspace do not corrupt each other (last-write-wins).
- **A corrupt memory file is never fatal** — it is moved to
  `memory.json.corrupt-<ts>` once and the store starts fresh.
- **Upsert key** is `(kind, subject, scope)` unless an explicit `id` is given,
  so re-storing the same fact updates instead of duplicating.
- **The full structural graph engine** (tree-sitter indexing, call graphs,
  Cypher queries) is out of scope for a JS plugin — if you want that exact
  engine, run the official `codebase-memory-mcp` binary through
  `@deepseek-ai/dsh-mcp-client` instead.

## Model Experience

### Tools

#### What the model sees

Four tools (`memory_store`, `memory_recall`, `memory_forget`, `memory_list`)
with fixed schemas; the optional system-prompt hint adds one fixed section
while enabled.

#### Token effect

Tool schemas add fixed per-request tokens while registered; the hint adds one
fixed section. Results are data-dependent (stored content), and the
session-start injection (opt-in) adds one context message per new session.

#### KV Cache effect

Prefix-stable while the tool set, schemas, and hint text are unchanged;
session-start injections append after the reusable prefix.

## Known limitations

- **Keyword matching, not semantic search** — recall ranks exact token
  overlap (camelCase/snake_case aware); it has no embeddings or synonyms.
- **No per-entry access control** — the memory file is written by the host
  process with normal filesystem permissions; treat it like any project file.
- **Last-write-wins across processes** — concurrent writers in different
  processes merge via reload-before-write but do not lock.
- **Injection is a digest, not full recall** — the model still calls
  `memory_recall` for the actual content.

## Development

```sh
pnpm install
pnpm run build    # tsc → lib/
pnpm test         # node --test tests/store.test.mjs (against the built lib)
```
