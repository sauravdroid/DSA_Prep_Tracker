#!/usr/bin/env node
/**
 * Migrates the dated coaching plans in the data repository into the first
 * worklist version. Two steps, so the result is reviewed before it is pushed:
 *
 *   node scripts/migrate-worklist.mjs
 *       Reads everything at the current head of the data repo, writes the
 *       version, manifest and a report to data/migration/<id>/, and pushes
 *       nothing.
 *
 *   node scripts/migrate-worklist.mjs --push <id>
 *       Publishes exactly those generated files in one commit, provided the
 *       legacy coaching files have not changed since they were read.
 *
 * Options: --repo owner/name (default sauravdroid/dsa-leetcode-storage),
 *          --today YYYY-MM-DD (default: local date).
 *
 * The token comes from GITHUB_TOKEN or the gitignored .github-token, the same
 * as the app. Legacy files are only ever read.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateToWorklist } from '../src/utils/worklistMigration.js'
import { validateWorklist, validateWorklistManifest, WORKLIST_MANIFEST } from '../src/utils/validateWorklist.js'
import { worklistPath } from '../src/utils/worklist.js'
import { todayStr } from '../src/utils/dateUtils.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRANCH = 'main'

const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}
const repo = opt('repo') || 'sauravdroid/dsa-leetcode-storage'
const pushId = opt('push')
const today = opt('today') || todayStr()

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  const file = path.join(root, '.github-token')
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  throw new Error('No GitHub token: set GITHUB_TOKEN or save one in Settings.')
}

async function gh(method, apiPath, body) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsa-prep-tracker-migration',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

async function must(method, apiPath, body, expect = [200]) {
  const r = await gh(method, apiPath, body)
  if (!expect.includes(r.status)) throw new Error(`${method} ${apiPath} → ${r.status} ${r.body?.message || ''}`)
  return r.body
}

const head = async () => (await must('GET', `/repos/${repo}/git/ref/heads/${BRANCH}`)).object.sha
const tree = async sha => (await must('GET', `/repos/${repo}/git/trees/${sha}?recursive=1`)).tree.filter(t => t.type === 'blob')

async function readJson(file, sha) {
  const r = await must('GET', `/repos/${repo}/contents/${file}?ref=${sha}`)
  if (r.content) return JSON.parse(Buffer.from(r.content, 'base64').toString('utf8'))
  // The contents API omits bodies over 1 MB; the blob API does not.
  const blob = await must('GET', `/repos/${repo}/git/blobs/${r.sha}`)
  return JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'))
}

const parse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

async function generate() {
  const sha = await head()
  const files = await tree(sha)
  const paths = new Set(files.map(f => f.path))
  if (paths.has(WORKLIST_MANIFEST)) {
    throw new Error(`${WORKLIST_MANIFEST} already exists at ${sha.slice(0, 7)}: the migration has already been published.`)
  }

  const dayPaths = files.map(f => f.path).filter(p => /^coaching\/days\/\d{4}-\d{2}-\d{2}\.json$/.test(p)).sort()
  console.log(`Reading ${repo}@${sha.slice(0, 7)}: ${dayPaths.length} day files, tracker, manifest…`)

  const days = []
  for (const p of dayPaths) days.push(await readJson(p, sha))
  const tracker = await readJson('tracker-data.json', sha)
  const dataManifest = paths.has('manifest.json') ? await readJson('manifest.json', sha) : null

  const { version, report } = migrateToWorklist({
    days,
    practiceLog: parse(tracker.data?.dsa_practice_log, []),
    problems: parse(tracker.data?.dsa_problems, {}),
    today,
    sourceCommit: sha,
    trackerFingerprint: dataManifest?.describes?.trackerFingerprint || null,
    generatedAt: new Date().toISOString(),
    extraSources: ['tracker-data.json', ...(dataManifest ? ['manifest.json'] : [])],
  })

  const manifest = {
    manifestVersion: 1,
    latest: version.id,
    versions: [{
      id: version.id,
      path: worklistPath(version.id),
      writtenAt: version.writtenAt,
      replaces: null,
      summary: 'Migrated from the dated plans.',
      migrated: true,
    }],
  }

  const errors = [...validateWorklist(version).errors, ...validateWorklistManifest(manifest).errors]
  if (errors.length) throw new Error(`Generated files do not validate:\n- ${errors.join('\n- ')}`)
  if (report.unaccounted.length) {
    throw new Error(`Completeness check failed; unaccounted mentions:\n${JSON.stringify(report.unaccounted, null, 2)}`)
  }

  const out = path.join(root, 'data', 'migration', version.id)
  const write = (rel, value) => {
    const p = path.join(out, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`)
  }
  write(worklistPath(version.id), version)
  write(WORKLIST_MANIFEST, manifest)
  write('report.json', { repo, sourceCommit: sha, today, ...report })

  const count = list => list.reduce((n, g) => n + g.items.length, 0)
  console.log(`\nGenerated ${version.id} in ${path.relative(root, out)}`)
  console.log(`  New:      ${count(version.new)} items in ${version.new.length} patterns`)
  console.log(`  Revision: ${count(version.revision)} items in ${version.revision.length} patterns`)
  console.log(`  Excluded: ${report.excluded} ${JSON.stringify(report.byReason)}`)
  console.log(`  Mentions: ${report.mentions} across ${report.days} days, all accounted for`)
  console.log(`\nReview the files, then publish with:\n  node scripts/migrate-worklist.mjs --push ${version.id}`)
}

async function push(id) {
  const out = path.join(root, 'data', 'migration', id)
  const read = rel => fs.readFileSync(path.join(out, rel), 'utf8')
  const report = JSON.parse(read('report.json'))
  const version = JSON.parse(read(worklistPath(id)))
  const manifest = JSON.parse(read(WORKLIST_MANIFEST))
  if (report.repo !== repo) throw new Error(`Generated for ${report.repo}, not ${repo}.`)

  const errors = [...validateWorklist(version).errors, ...validateWorklistManifest(manifest).errors]
  if (errors.length) throw new Error(`Files no longer validate:\n- ${errors.join('\n- ')}`)

  // The snapshot must still describe the legacy files as they are now.
  const now = await head()
  if (now !== report.sourceCommit) {
    const legacy = list => new Map(list.filter(f => f.path.startsWith('coaching/')).map(f => [f.path, f.sha]))
    const before = legacy(await tree(report.sourceCommit))
    const after = legacy(await tree(now))
    const moved = [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p))
    if (moved.length) {
      throw new Error(`coaching/ changed since the snapshot (${moved.slice(0, 5).join(', ')}). Generate again.`)
    }
  }

  const commit = await must('POST', `/repos/${repo}/git/commits`, {
    message: `coaching: migrate dated plans to worklist ${id}\n\nGenerated from ${report.sourceCommit.slice(0, 7)} by scripts/migrate-worklist.mjs. Legacy coaching files are unchanged.`,
    tree: (await must('POST', `/repos/${repo}/git/trees`, {
      base_tree: now,
      tree: [
        { path: worklistPath(id), mode: '100644', type: 'blob', content: read(worklistPath(id)) },
        { path: WORKLIST_MANIFEST, mode: '100644', type: 'blob', content: read(WORKLIST_MANIFEST) },
      ],
    }, [201])).sha,
    parents: [now],
  }, [201])

  // Not forced: if main moved in the meantime this fails rather than overwrite.
  await must('PATCH', `/repos/${repo}/git/refs/heads/${BRANCH}`, { sha: commit.sha })
  console.log(`Published ${id} to ${repo} as ${commit.sha.slice(0, 7)}.`)
}

;(pushId ? push(pushId) : generate()).catch(e => {
  console.error(e.message)
  process.exit(1)
})
