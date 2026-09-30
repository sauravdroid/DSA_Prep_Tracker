import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import https from 'https'
import fs from 'fs'
import path from 'path'

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

    try {
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

      if (url === '/push') {
        if (!fs.existsSync(dataFile)) return send(res, 400, { error: 'No local data file to push' })
        const local = fs.readFileSync(dataFile, 'utf8')

        const existing = await gh(token, 'GET', contentsPath)
        const sha = existing.status === 200 ? existing.body.sha : undefined

        const r = await gh(token, 'PUT', contentsPath, {
          message: `tracker sync ${new Date().toISOString()}`,
          content: Buffer.from(local, 'utf8').toString('base64'),
          ...(sha ? { sha } : {}),
        })
        if (r.status !== 200 && r.status !== 201) {
          return send(res, r.status, { error: r.body?.message || `GitHub returned ${r.status}` })
        }
        return send(res, 200, {
          committed: r.body.commit?.sha?.slice(0, 7) || null,
          bytes: Buffer.byteLength(local),
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
          if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
            return send(res, 400, { error: 'Decision must be a JSON object' })
          }
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
