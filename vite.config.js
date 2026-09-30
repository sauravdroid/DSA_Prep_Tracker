import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import https from 'https'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { validateDecision, outOfScopeFiles } from './src/utils/validateDecision.js'
import { unpublishedKeys } from './src/utils/trackerDiff.js'
import { publishSet } from './src/utils/publishSet.js'
import { assessmentId, assessmentPath, summarise, buildIndex, INDEX_PATH, coveredDates } from './src/utils/assessments.js'
import { sealReason, sealOutcome, outcomePath, summariseOutcome, OUTCOME_VERSION, outcomeDrift } from './src/utils/outcomes.js'

const DATA_DIR = 'data'
const DATA_FILE = 'tracker-data.json'
const MAX_BODY_BYTES = 32 * 1024 * 1024
// Only tracker keys are accepted, so a stray request can't write arbitrary files.
const KEY_RE = /^dsa_[A-Za-z0-9_]+$/

/**
 * Persists the browser's tracker keys to a JSON file on disk, so the data
 * outlives any one Chrome profile and can be read by other tools.
 */
function trackerDataStore() {
  let dir = ''
  let file = ''

  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const handler = (req, res) => {
    if (req.method === 'GET') {
      try {
        if (!fs.existsSync(file)) return send(res, 200, { data: {}, savedAt: null, path: file })
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        return send(res, 200, { data: parsed.data || {}, savedAt: parsed.savedAt || null, path: file })
      } catch (e) {
        return send(res, 500, { error: e.message, path: file })
      }
    }

    if (req.method === 'PUT') {
      let body = ''
      let tooBig = false
      req.on('data', chunk => {
        if (tooBig) return
        body += chunk
        if (body.length > MAX_BODY_BYTES) {
          tooBig = true
          send(res, 413, { error: 'Payload too large' })
          req.destroy()
        }
      })
      req.on('end', () => {
        if (tooBig) return
        try {
          const incoming = JSON.parse(body)

          // Optimistic concurrency: a client that loaded an older version of the
          // file must re-read before it can overwrite another profile's writes.
          let current = null
          if (fs.existsSync(file)) {
            try {
              current = JSON.parse(fs.readFileSync(file, 'utf8'))
            } catch {
              current = null
            }
          }
          const currentSavedAt = current ? current.savedAt || null : null
          if (!incoming.force && currentSavedAt && incoming.baseSavedAt !== currentSavedAt) {
            return send(res, 409, {
              error: 'Data file changed elsewhere',
              savedAt: currentSavedAt,
              path: file,
            })
          }

          const data = {}
          for (const [k, v] of Object.entries(incoming.data || {})) {
            if (KEY_RE.test(k) && typeof v === 'string') data[k] = v
          }
          const payload = { savedAt: new Date().toISOString(), data }

          fs.mkdirSync(dir, { recursive: true })
          if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak')
          // Write-then-rename so a crash can't leave a half-written file.
          const tmp = file + '.tmp'
          fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
          fs.renameSync(tmp, file)

          send(res, 200, { savedAt: payload.savedAt, keys: Object.keys(data).length, path: file })
        } catch (e) {
          send(res, 400, { error: e.message })
        }
      })
      return
    }

    send(res, 405, { error: 'Method not allowed' })
  }

  return {
    name: 'tracker-data-store',
    configResolved(config) {
      dir = path.join(config.root, DATA_DIR)
      file = path.join(dir, DATA_FILE)
    },
    configureServer(server) {
      server.middlewares.use('/api/data', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/data', handler)
    },
  }
}

function leetcodeProxy() {
  return {
    name: 'leetcode-proxy',
    configureServer(server) {
      server.middlewares.use('/api/leetcode', (req, res) => {
        const session = req.headers['x-leetcode-session']
        let body = ''
        req.on('data', chunk => (body += chunk))
        req.on('end', () => {
          const options = {
            hostname: 'leetcode.com',
            path: '/graphql',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Cookie: session ? `LEETCODE_SESSION=${session}; csrftoken=proxy` : '',
              'x-csrftoken': 'proxy',
              Referer: 'https://leetcode.com',
              'User-Agent': 'Mozilla/5.0',
            },
          }
          const proxyReq = https.request(options, proxyRes => {
            let data = ''
            proxyRes.on('data', chunk => (data += chunk))
            proxyRes.on('end', () => {
              res.statusCode = proxyRes.statusCode
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            })
          })
          proxyReq.on('error', e => {
            res.statusCode = 502
            res.end(JSON.stringify({ error: e.message }))
          })
          proxyReq.write(body)
          proxyReq.end()
        })
      })
    },
  }
}

/**
 * GitHub backup of the tracker data file. The token is read from the
 * environment or a gitignored local file and never reaches the browser.
 */
function githubSync() {
  let root = ''
  let dataFile = ''
  const REPO_RE = /^[\w.-]+\/[\w.-]+$/
  const REMOTE_PATH = 'tracker-data.json'
  const BRANCH = 'main'
  // Coaching advice lives on its own path so a tracker push can never carry a
  // stale decision, and a coaching pull can never touch practice facts.
  const COACHING_PATH = 'coaching/decision.json'

  const readToken = () => {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
    const tokenFile = path.join(root, '.github-token')
    if (fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf8').trim()
    return ''
  }

  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const gh = (token, method, apiPath, body) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null
      const req = https.request(
        {
          hostname: 'api.github.com',
          path: apiPath,
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'dsa-prep-tracker',
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        r => {
          let data = ''
          r.on('data', c => (data += c))
          r.on('end', () => {
            let parsed = null
            try {
              parsed = data ? JSON.parse(data) : null
            } catch {
              parsed = null
            }
            resolve({ status: r.statusCode, body: parsed })
          })
        }
      )
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })

  const readBody = req =>
    new Promise(resolve => {
      let b = ''
      req.on('data', c => (b += c))
      req.on('end', () => {
        try {
          resolve(JSON.parse(b || '{}'))
        } catch {
          resolve({})
        }
      })
    })

  const handler = async (req, res) => {
    const url = (req.url || '/').split('?')[0]
    const token = readToken()

    if (url === '/status' || url === '/') {
      return send(res, 200, {
        hasToken: !!token,
        tokenSource: process.env.GITHUB_TOKEN ? 'env' : token ? 'file' : null,
        remotePath: REMOTE_PATH,
        coachingPath: COACHING_PATH,
      })
    }

    if (url === '/token' && req.method === 'POST') {
      const body = await readBody(req)
      const value = (body.token || '').trim()
      const tokenFile = path.join(root, '.github-token')
      try {
        if (value) fs.writeFileSync(tokenFile, value, { mode: 0o600 })
        else if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile)
        return send(res, 200, { hasToken: !!value })
      } catch (e) {
        return send(res, 500, { error: e.message })
      }
    }

    if (!token) return send(res, 400, { error: 'No GitHub token configured' })

    const body = req.method === 'POST' ? await readBody(req) : {}
    const repo = (body.repo || '').trim()
    if (!REPO_RE.test(repo)) return send(res, 400, { error: 'Invalid repo, expected owner/name' })
    const contentsPath = `/repos/${repo}/contents/${REMOTE_PATH}`
    const coachingContents = `/repos/${repo}/contents/${COACHING_PATH}`

    const decodeContent = r => JSON.parse(Buffer.from(r.body.content || '', 'base64').toString('utf8'))

    try {
      // --- Coaching advice. Read-only here: the app never publishes advice,
      // and this path never writes practice facts.
      if (url === '/coaching/pull' || url === '/coaching/at') {
        const ref = (body.ref || '').trim()
        const at = url === '/coaching/at' && ref ? `${coachingContents}?ref=${encodeURIComponent(ref)}` : coachingContents
        const r = await gh(token, 'GET', at)
        if (r.status === 404) {
          return send(res, 200, { empty: true, decision: null, path: COACHING_PATH })
        }
        if (r.status !== 200) {
          return send(res, r.status, { error: r.body?.message || `GitHub returned ${r.status}` })
        }

        let decision
        try {
          decision = decodeContent(r)
        } catch (e) {
          return send(res, 422, { error: `Remote file is not valid JSON: ${e.message}` })
        }

        const { valid, errors } = validateDecision(decision)

        // Which commit produced this, and did it stay inside coaching/?
        let commit = null
        let outOfScope = []
        const log = await gh(token, 'GET', `/repos/${repo}/commits?path=${encodeURIComponent(COACHING_PATH)}&per_page=1${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`)
        if (log.status === 200 && Array.isArray(log.body) && log.body[0]) {
          const head = log.body[0]
          commit = {
            sha: head.sha,
            shortSha: head.sha.slice(0, 7),
            date: head.commit?.committer?.date || head.commit?.author?.date || null,
            message: (head.commit?.message || '').split('\n')[0],
            author: head.commit?.author?.name || null,
          }
          const detail = await gh(token, 'GET', `/repos/${repo}/commits/${head.sha}`)
          if (detail.status === 200) outOfScope = outOfScopeFiles(detail.body?.files)
        }

        return send(res, 200, {
          empty: false,
          decision,
          valid,
          errors,
          commit,
          outOfScope,
          path: COACHING_PATH,
          sha: r.body.sha,
        })
      }

      if (url === '/coaching/history') {
        const r = await gh(token, 'GET', `/repos/${repo}/commits?path=${encodeURIComponent(COACHING_PATH)}&per_page=20`)
        if (r.status === 404 || !Array.isArray(r.body)) return send(res, 200, { revisions: [] })
        if (r.status !== 200) {
          return send(res, r.status, { error: r.body?.message || `GitHub returned ${r.status}` })
        }
        return send(res, 200, {
          revisions: r.body.map(c => ({
            sha: c.sha,
            shortSha: c.sha.slice(0, 7),
            date: c.commit?.committer?.date || c.commit?.author?.date || null,
            message: (c.commit?.message || '').split('\n')[0],
            author: c.commit?.author?.name || null,
          })),
        })
      }

      // Freshness only: the comparison runs here so the browser does not fetch
      // the whole tracker file just to learn whether a push is outstanding.
      if (url === '/remote-status') {
        const local = fs.existsSync(dataFile)
          ? JSON.parse(fs.readFileSync(dataFile, 'utf8'))
          : { savedAt: null, data: {} }
        const localKeys = Object.keys(local.data || {})

        const r = await gh(token, 'GET', contentsPath)
        if (r.status === 404) {
          return send(res, 200, {
            remote: { empty: true },
            local: { savedAt: local.savedAt, keys: localKeys.length },
            behind: localKeys.length > 0,
            missingOnRemote: localKeys,
            changedSincePush: [],
          })
        }
        if (r.status !== 200) {
          return send(res, r.status, { error: r.body?.message || `GitHub returned ${r.status}` })
        }

        const remote = decodeContent(r)
        const remoteKeys = Object.keys(remote.data || {})
        const { missing, changed } = unpublishedKeys(local.data || {}, remote.data || {})

        return send(res, 200, {
          remote: { savedAt: remote.savedAt || null, keys: remoteKeys.length, sha: r.body.sha },
          local: { savedAt: local.savedAt || null, keys: localKeys.length },
          behind: missing.length > 0 || changed.length > 0,
          // Only meaningful if the remote actually carries something local does
          // not; a newer timestamp over identical facts is just a reordered save.
          ahead: Object.keys(remote.data || {}).some(k => !(k in (local.data || {}))),
          missingOnRemote: missing,
          changedSincePush: changed,
        })
      }

      if (url === '/pull') {
        const r = await gh(token, 'GET', contentsPath)
        if (r.status === 404) return send(res, 200, { empty: true, data: {}, savedAt: null })
        if (r.status !== 200) {
          return send(res, r.status, { error: r.body?.message || `GitHub returned ${r.status}` })
        }
        const decoded = Buffer.from(r.body.content || '', 'base64').toString('utf8')
        const parsed = JSON.parse(decoded)
        return send(res, 200, {
          data: parsed.data || {},
          savedAt: parsed.savedAt || null,
          sha: r.body.sha,
          keys: Object.keys(parsed.data || {}).length,
        })
      }

      // Copies each published revision of the decision to an addressable path
      // and rebuilds the index. Derived from commit history rather than written
      // as the coach publishes, so a revision missed while the app was closed
      // is picked up later instead of leaving a hole.
      if (url === '/coaching/archive') {
        const log = await gh(token, 'GET', `/repos/${repo}/commits?path=${encodeURIComponent(COACHING_PATH)}&per_page=100`)
        if (log.status !== 200 || !Array.isArray(log.body)) {
          return send(res, log.status === 200 ? 500 : log.status, { error: log.body?.message || 'Cannot read the decision history' })
        }

        const head = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${BRANCH}`)
        if (head.status !== 200) return send(res, head.status, { error: head.body?.message || `Cannot read ${BRANCH}` })
        const parentSha = head.body.object.sha

        const tree = await gh(token, 'GET', `/repos/${repo}/git/trees/${parentSha}?recursive=1`)
        const present = new Set(
          (tree.status === 200 ? tree.body.tree : []).filter(t => t.type === 'blob').map(t => t.path)
        )

        // Index entries already published are reused, so a run costs a handful
        // of requests regardless of how many assessments have accumulated. A
        // decision is fetched only when it is new, or about to be sealed.
        const priorIndex = present.has(INDEX_PATH)
          ? await gh(token, 'GET', `/repos/${repo}/contents/${INDEX_PATH}`)
          : null
        let priorByCommit = new Map()
        if (priorIndex?.status === 200) {
          try {
            const parsed = JSON.parse(Buffer.from(priorIndex.body.content || '', 'base64').toString('utf8'))
            priorByCommit = new Map((parsed.assessments || []).filter(a => a.sourceCommit).map(a => [a.sourceCommit, a]))
          } catch {
            priorByCommit = new Map()
          }
        }

        const today = new Date().toISOString().slice(0, 10)
        let practiceLog = []
        if (fs.existsSync(dataFile)) {
          try {
            practiceLog = JSON.parse(JSON.parse(fs.readFileSync(dataFile, 'utf8')).data?.dsa_practice_log || '[]')
          } catch {
            practiceLog = []
          }
        }

        const toWrite = new Map()
        const summaries = []
        let sealed = 0
        let resealed = 0
        let fetched = 0

        const readDecision = async sha => {
          const at = await gh(token, 'GET', `${coachingContents}?ref=${sha}`)
          if (at.status !== 200) return null
          fetched++
          try {
            return decodeContent(at)
          } catch {
            return null
          }
        }

        for (const [i, c] of log.body.entries()) {
          const short = c.sha.slice(0, 7)
          const isLatest = i === 0
          const prior = priorByCommit.get(short)
          const known = prior && prior.id && present.has(assessmentPath(prior.id))

          // Already archived and already sealed: nothing can change it.
          if (known && prior.outcome) {
            summaries.push(prior)
            continue
          }

          // Already archived and not yet sealable: the index alone answers that.
          if (known && !sealReason({ covers: prior.covers || [], isLatest, today })) {
            summaries.push({ ...prior, outcome: null })
            continue
          }

          const decision = await readDecision(c.sha)
          if (!decision) {
            if (prior) summaries.push(prior)
            continue
          }
          const id = assessmentId(decision.assessedAt)
          if (!id) continue

          const content = JSON.stringify(decision, null, 2)
          if (!present.has(assessmentPath(id))) toWrite.set(assessmentPath(id), content)

          let outcome = null
          if (present.has(outcomePath(id))) {
            const existing = await gh(token, 'GET', `/repos/${repo}/contents/${outcomePath(id)}`)
            let parsed = null
            if (existing.status === 200) {
              try {
                parsed = decodeContent(existing)
              } catch { /* fall through and leave it alone */ }
            }
            // An older format can be rewritten, but only while the evidence
            // behind it is unchanged. Otherwise the rewrite would quietly
            // restate the verdict against evidence the original never saw,
            // which is what sealing exists to prevent.
            if (parsed && (parsed.outcomeVersion ?? 1) < OUTCOME_VERSION && !outcomeDrift(parsed, practiceLog).drifted) {
              const reSealed = sealOutcome({
                decision,
                assessmentId: id,
                practiceLog,
                sealedAt: parsed.sealedAt,
                sealedBecause: parsed.sealedBecause,
                supersededBy: parsed.supersededBy ?? null,
              })
              toWrite.set(outcomePath(id), JSON.stringify(reSealed, null, 2))
              outcome = summariseOutcome(reSealed)
              resealed++
            } else if (parsed) {
              outcome = summariseOutcome(parsed)
            }
          } else {
            const because = sealReason({ decision, covers: coveredDates(decision), isLatest, today })
            if (because) {
              // Newest first, so whatever replaced this one is already here.
              const fresh = sealOutcome({
                decision,
                assessmentId: id,
                practiceLog,
                sealedAt: new Date().toISOString(),
                sealedBecause: because,
                supersededBy: because === 'superseded' ? summaries[0]?.id ?? null : null,
              })
              toWrite.set(outcomePath(id), JSON.stringify(fresh, null, 2))
              outcome = summariseOutcome(fresh)
              sealed++
            }
          }

          summaries.push(summarise(decision, { commit: short, bytes: Buffer.byteLength(content), outcome }))
        }

        const index = buildIndex(summaries)
        const indexContent = JSON.stringify(index, null, 2)
        const indexChanged = !priorIndex || priorIndex.status !== 200 ||
          Buffer.from(priorIndex.body.content || '', 'base64').toString('utf8') !== indexContent
        if (indexChanged) toWrite.set(INDEX_PATH, indexContent)

        if (toWrite.size === 0) {
          return send(res, 200, { committed: null, unchanged: true, archived: 0, sealed: 0, resealed: 0, fetched, count: index.count })
        }

        const newTree = await gh(token, 'POST', `/repos/${repo}/git/trees`, {
          base_tree: parentSha,
          tree: [...toWrite].map(([p, content]) => ({ path: p, mode: '100644', type: 'blob', content })),
        })
        if (newTree.status !== 201) {
          return send(res, newTree.status, { error: newTree.body?.message || 'Could not build the tree' })
        }
        const commit = await gh(token, 'POST', `/repos/${repo}/git/commits`, {
          message: `archive coaching assessments (${index.count})`,
          tree: newTree.body.sha,
          parents: [parentSha],
        })
        if (commit.status !== 201) {
          return send(res, commit.status, { error: commit.body?.message || 'Could not create the commit' })
        }
        const moved = await gh(token, 'PATCH', `/repos/${repo}/git/refs/heads/${BRANCH}`, { sha: commit.body.sha })
        if (moved.status !== 200) {
          return send(res, moved.status, { error: moved.body?.message || `Could not move ${BRANCH}` })
        }

        return send(res, 200, {
          committed: commit.body.sha.slice(0, 7),
          archived: [...toWrite.keys()].filter(p => p.startsWith('coaching/assessments/')).length,
          sealed,
          resealed,
          fetched,
          count: index.count,
          files: [...toWrite.keys()],
        })
      }

      if (url === '/push') {
        if (!fs.existsSync(dataFile)) return send(res, 400, { error: 'No local data file to push' })
        const local = fs.readFileSync(dataFile, 'utf8')
        const parsedLocal = JSON.parse(local)

        // The tracker and everything derived from it go in one commit. Written
        // separately, a failure between them leaves the manifest describing
        // shards that are not there.
        const derived = publishSet({
          data: parsedLocal.data || {},
          savedAt: parsedLocal.savedAt || null,
          repo,
          codeCommit: body.codeCommit || null,
        })

        const files = new Map([[REMOTE_PATH, local], ...derived])

        const head = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${BRANCH}`)
        if (head.status !== 200) {
          return send(res, head.status, { error: head.body?.message || `Cannot read ${BRANCH}` })
        }
        const parentSha = head.body.object.sha

        // Only write what actually differs, so an unchanged month is not
        // rewritten on every publish.
        const existing = await gh(token, 'GET', `/repos/${repo}/git/trees/${parentSha}?recursive=1`)
        const bySha = new Map(
          (existing.status === 200 ? existing.body.tree : [])
            .filter(t => t.type === 'blob')
            .map(t => [t.path, t.sha])
        )
        const blobSha = content =>
          crypto.createHash('sha1')
            .update(`blob ${Buffer.byteLength(content)}\0`)
            .update(content)
            .digest('hex')

        const changed = [...files].filter(([p, c]) => bySha.get(p) !== blobSha(c))
        if (changed.length === 0) {
          return send(res, 200, { committed: null, unchanged: true, bytes: Buffer.byteLength(local), files: [] })
        }

        const tree = await gh(token, 'POST', `/repos/${repo}/git/trees`, {
          base_tree: parentSha,
          tree: changed.map(([p, content]) => ({ path: p, mode: '100644', type: 'blob', content })),
        })
        if (tree.status !== 201) {
          return send(res, tree.status, { error: tree.body?.message || 'Could not build the tree' })
        }

        const commit = await gh(token, 'POST', `/repos/${repo}/git/commits`, {
          message: `tracker sync ${parsedLocal.savedAt || new Date().toISOString()}`,
          tree: tree.body.sha,
          parents: [parentSha],
        })
        if (commit.status !== 201) {
          return send(res, commit.status, { error: commit.body?.message || 'Could not create the commit' })
        }

        const moved = await gh(token, 'PATCH', `/repos/${repo}/git/refs/heads/${BRANCH}`, { sha: commit.body.sha })
        if (moved.status !== 200) {
          return send(res, moved.status, { error: moved.body?.message || `Could not move ${BRANCH}` })
        }

        return send(res, 200, {
          committed: commit.body.sha.slice(0, 7),
          bytes: Buffer.byteLength(local),
          files: changed.map(([p]) => p),
        })
      }
    } catch (e) {
      return send(res, 500, { error: e.message })
    }

    send(res, 404, { error: 'Unknown endpoint' })
  }

  return {
    name: 'github-sync',
    configResolved(config) {
      root = config.root
      dataFile = path.join(root, DATA_DIR, DATA_FILE)
    },
    configureServer(server) {
      server.middlewares.use('/api/github', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/github', handler)
    },
  }
}

/**
 * The coaching recommendation, kept in its own file. The app owns practice
 * facts; this file only ever holds the current advice, so importing one can
 * never touch practice history.
 */
function coachingDecisionStore() {
  let dir = ''
  let file = ''

  const send = (res, code, body) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  const handler = (req, res) => {
    if (req.method === 'GET') {
      try {
        if (!fs.existsSync(file)) return send(res, 200, { decision: null, path: file })
        return send(res, 200, { decision: JSON.parse(fs.readFileSync(file, 'utf8')), path: file })
      } catch (e) {
        return send(res, 500, { error: e.message, path: file })
      }
    }

    if (req.method === 'PUT') {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        try {
          const decision = JSON.parse(body)
          // Advice must satisfy the contract the coach was asked to author
          // against; a committed file is not automatically trustworthy.
          const { valid, errors } = validateDecision(decision)
          if (!valid) return send(res, 400, { error: 'Decision failed validation', errors })

          fs.mkdirSync(dir, { recursive: true })
          const tmp = file + '.tmp'
          fs.writeFileSync(tmp, JSON.stringify(decision, null, 2))
          fs.renameSync(tmp, file)
          return send(res, 200, { ok: true, path: file })
        } catch (e) {
          return send(res, 400, { error: e.message })
        }
      })
      return
    }

    send(res, 405, { error: 'Method not allowed' })
  }

  return {
    name: 'coaching-decision-store',
    configResolved(config) {
      dir = path.join(config.root, DATA_DIR)
      file = path.join(dir, 'coaching-decision.json')
    },
    configureServer(server) {
      server.middlewares.use('/api/coaching', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/coaching', handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), trackerDataStore(), coachingDecisionStore(), githubSync(), leetcodeProxy()],
})
