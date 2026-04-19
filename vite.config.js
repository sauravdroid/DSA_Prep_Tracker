import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'https'

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

export default defineConfig({
  plugins: [react(), leetcodeProxy()],
})
