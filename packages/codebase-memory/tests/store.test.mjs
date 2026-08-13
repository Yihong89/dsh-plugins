/**
 * Unit tests for the codebase-memory store. Run against the built lib:
 * `pnpm run build && pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, memoryFilePath } from '../lib/store.js'

/** Fresh store in a temp dir, with a distinct file path per test. */
function freshStore(name, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-'))
  const path = join(dir, `${name}.json`)
  const store = new MemoryStore(path, { maxEntries: 100, defaultLimit: 5, maxLimit: 50, ...options })
  return { store, dir, path }
}

test('upsert creates an entry and persists it to disk', async () => {
  const { store, path } = freshStore('basic')
  const outcome = await store.upsert({
    subject: 'auth/login.ts',
    content: 'Handles JWT login; token cached in redis key user:<id>',
    kind: 'entity',
    scope: 'src/auth/login.ts',
    tags: ['auth', 'jwt'],
  })
  assert.equal(outcome.created, true)
  assert.match(outcome.entry.id, /^m_/)
  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(onDisk.version, 1)
  assert.equal(onDisk.entries.length, 1)
  assert.equal(onDisk.entries[0].subject, 'auth/login.ts')
})

test('upsert by (kind, subject, scope) updates instead of duplicating', async () => {
  const { store } = freshStore('upsert')
  const first = await store.upsert({ subject: 'X', content: 'v1', kind: 'note', scope: 'a.ts' })
  const second = await store.upsert({ subject: 'X', content: 'v2', kind: 'note', scope: 'a.ts' })
  assert.equal(second.created, false)
  assert.equal(second.entry.id, first.entry.id)
  assert.equal(second.entry.content, 'v2')
  assert.equal((await store.count()), 1)
})

test('upsert by explicit id updates that entry', async () => {
  const { store } = freshStore('byid')
  const first = await store.upsert({ subject: 'A', content: 'x', kind: 'note' })
  const second = await store.upsert({ id: first.entry.id, subject: 'A', content: 'y', kind: 'decision' })
  assert.equal(second.created, false)
  assert.equal(second.entry.kind, 'decision')
  assert.equal(second.entry.content, 'y')
})

test('search ranks subject matches above content matches', async () => {
  const { store } = freshStore('rank')
  await store.upsert({ subject: 'retryPolicy', content: 'retries with exponential backoff', kind: 'entity' })
  await store.upsert({ subject: 'unrelated', content: 'the retry policy lives in src/util', kind: 'note' })
  const result = await store.search('retry policy', {})
  assert.equal(result.total, 2)
  assert.equal(result.entries[0].subject, 'retryPolicy')
})

test('search filters by kind and tags', async () => {
  const { store } = freshStore('filter')
  await store.upsert({ subject: 'thing', content: 'cached with redis', kind: 'convention', tags: ['cache'] })
  await store.upsert({ subject: 'thing', content: 'redis cache note', kind: 'note', tags: ['cache'] })
  const kindFiltered = await store.search('redis', { kind: 'convention' })
  assert.equal(kindFiltered.total, 1)
  assert.equal(kindFiltered.entries[0].kind, 'convention')
  const tagFiltered = await store.search('redis', { tags: ['cache'] })
  assert.equal(tagFiltered.total, 2)
  const missingTag = await store.search('redis', { tags: ['nope'] })
  assert.equal(missingTag.total, 0)
})

test('empty query lists most recent entries', async () => {
  const { store } = freshStore('recent')
  await store.upsert({ subject: 'old', content: 'first' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await store.upsert({ subject: 'new', content: 'second' })
  const result = await store.search('', {})
  assert.equal(result.entries[0].subject, 'new')
})

test('limit clamps to max and honors requested limit', async () => {
  const { store } = freshStore('limit')
  for (let i = 0; i < 60; i++) await store.upsert({ subject: `s${i}`, content: `c${i}`, kind: 'note' })
  const capped = await store.search('', { limit: 999 })
  assert.equal(capped.entries.length, 50)
  assert.equal(capped.total, 60)
  const three = await store.search('', { limit: 3 })
  assert.equal(three.entries.length, 3)
})

test('remove by id and by subject', async () => {
  const { store } = freshStore('remove')
  const a = await store.upsert({ subject: 'A', content: 'x', kind: 'note' })
  const b = await store.upsert({ subject: 'A', content: 'y', kind: 'entity' })
  assert.equal(await store.remove({ id: a.entry.id }), 1)
  assert.equal(await store.remove({ subject: 'A' }), 1)
  assert.equal((await store.count()), 0)
  assert.equal((await store.remove({ subject: 'A' })), 0)
})

test('maxEntries drops the oldest on overflow', async () => {
  const { store } = freshStore('cap', { maxEntries: 3 })
  await store.upsert({ subject: 'a', content: '1', kind: 'note' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await store.upsert({ subject: 'b', content: '2', kind: 'note' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await store.upsert({ subject: 'c', content: '3', kind: 'note' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await store.upsert({ subject: 'd', content: '4', kind: 'note' })
  const result = await store.list({ limit: 50 })
  assert.equal(result.total, 3)
  assert.ok(result.entries.every(entry => entry.subject !== 'a'))
})

test('a second store instance sees the persisted file (cross-instance sharing)', async () => {
  const { path } = freshStore('shared')
  const first = new MemoryStore(path, { maxEntries: 100, defaultLimit: 5, maxLimit: 50 })
  await first.upsert({ subject: 'shared', content: 'visible to others', kind: 'note' })
  const second = new MemoryStore(path, { maxEntries: 100, defaultLimit: 5, maxLimit: 50 })
  const result = await second.search('visible', {})
  assert.equal(result.total, 1)
})

test('external file edits are picked up via mtime refresh', async () => {
  const { store, path } = freshStore('external')
  await store.upsert({ subject: 'before', content: 'x', kind: 'note' })
  const file = JSON.parse(readFileSync(path, 'utf8'))
  file.entries.push({
    id: 'm_external',
    kind: 'note',
    subject: 'after',
    content: 'written by someone else',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  writeFileSync(path, JSON.stringify(file))
  // Force the loaded mtime to be stale by waiting for a distinct mtime.
  await new Promise(resolve => setTimeout(resolve, 20))
  const result = await store.search('someone else', {})
  assert.equal(result.total, 1)
})

test('a corrupt memory file is backed up and replaced, not fatal', async () => {
  const { store, dir } = freshStore('corrupt')
  await store.upsert({ subject: 'ok', content: 'x', kind: 'note' })
  writeFileSync(store.path, '{ not json')
  const repaired = new MemoryStore(store.path, { maxEntries: 100, defaultLimit: 5, maxLimit: 50 })
  // The first operation refreshes and moves the corrupt file aside.
  await repaired.upsert({ subject: 'fresh', content: 'y', kind: 'note' })
  assert.equal((await repaired.count()), 1)
  const backups = readdirSync(dir).filter(f => f.includes('.corrupt-'))
  assert.equal(backups.length, 1)
})

test('digest renders the most recent entries with clipping', async () => {
  const { store } = freshStore('digest')
  await store.upsert({ subject: 'thing', content: 'a'.repeat(500), kind: 'note' })
  const digest = store.digest(5, 200)
  assert.ok(digest.startsWith('Codebase memory'))
  assert.ok(digest.length <= 201)
})

test('memoryFilePath resolves inside the workspace directory', () => {
  assert.equal(
    memoryFilePath('/ws', '.dsh-memory', 'memory.json'),
    join('/ws', '.dsh-memory', 'memory.json'),
  )
})
