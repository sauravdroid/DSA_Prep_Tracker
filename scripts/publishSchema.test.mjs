import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { publishSet, monthlyShards } from '../src/utils/publishSet.js'

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const manifestSchema = ajv.compile(JSON.parse(fs.readFileSync('schemas/manifest.schema.json', 'utf8')))
const shardSchema = ajv.compile(JSON.parse(fs.readFileSync('schemas/evidence-shard.schema.json', 'utf8')))

const data = {
  dsa_problems: JSON.stringify({
    'two-sum': { slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', tags: ['Array'], dateSolved: '2026-08-04' },
  }),
  dsa_revisions: JSON.stringify([{ slug: 'two-sum', date: '2026-09-12' }]),
  dsa_failures: JSON.stringify([{ slug: 'two-sum', date: '2026-09-12' }]),
  dsa_practice_log: JSON.stringify([
    { id: 'a', slug: 'two-sum', date: '2026-09-12', at: '2026-09-12T10:00:00Z', mode: 'cold', result: 'green', help: 'none', sessionRepeat: false, timeMinutes: 12, notes: {}, freeNote: '' },
  ]),
}

test('the generated manifest matches its published schema', () => {
  const files = publishSet({ data, savedAt: 'T', repo: 'o/r', codeCommit: 'c' })
  const manifest = JSON.parse(files.get('manifest.json'))
  assert.ok(manifestSchema(manifest), JSON.stringify(manifestSchema.errors))
})

test('every generated shard matches its published schema', () => {
  for (const s of monthlyShards(data)) {
    assert.ok(shardSchema(s.content), `${s.month}: ${JSON.stringify(shardSchema.errors)}`)
  }
})

test('the real tracker produces a valid publish set', () => {
  const env = JSON.parse(fs.readFileSync('data/tracker-data.json', 'utf8'))
  const files = publishSet({
    data: env.data, savedAt: env.savedAt, repo: 'sauravdroid/dsa-leetcode-storage', codeCommit: 'c',
  })
  const manifest = JSON.parse(files.get('manifest.json'))
  assert.ok(manifestSchema(manifest), JSON.stringify(manifestSchema.errors))
  for (const [path, content] of files) {
    if (path === 'manifest.json') continue
    assert.ok(shardSchema(JSON.parse(content)), `${path}: ${JSON.stringify(shardSchema.errors)}`)
  }
  // Every shard the manifest advertises is one the publish actually writes.
  for (const s of manifest.evidence.shards) assert.ok(files.has(s.file), `manifest names a missing file: ${s.file}`)
})
