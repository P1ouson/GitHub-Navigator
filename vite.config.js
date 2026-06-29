import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { HttpsProxyAgent } from 'https-proxy-agent'
import https from 'https'
import net from 'net'

// 常见本地代理端口（按优先级排序）
const PROXY_PORTS = [
  7897,  // Clash for Windows (新版本默认)
  7890,  // Clash (旧版本/Mac)
  10809, // V2RayN (HTTP)
  1080,  // SSR / V2Ray (通用)
  2080,  // Surge (Mac)
  8080,  // 通用 HTTP 代理
  33210, // Clash Verge
  7891,  // Clash (混合端口备选)
]

// 环境变量覆盖：CLASH_PORT=7890 npm run dev
const ENV_PORT = process.env.CLASH_PORT ? Number(process.env.CLASH_PORT) : null

/**
 * 探测本地哪个代理端口可用
 * 返回 { port, agent, verified } 或 { port: null, agent: null }
 */
async function detectProxy() {
  // 1. 环境变量指定的端口优先
  if (ENV_PORT) {
    const ok = await checkPort(ENV_PORT)
    if (ok) {
      console.log(`[proxy] 使用环境变量指定的端口 ${ENV_PORT}`)
      const agent = new HttpsProxyAgent(`http://127.0.0.1:${ENV_PORT}`)
      const verified = await verifyHttpProxy(agent)
      if (verified) {
        console.log(`[proxy] 端口 ${ENV_PORT} 可访问 api.github.com`)
        return { port: ENV_PORT, agent, verified: true }
      }
      console.warn(`[proxy] 端口 ${ENV_PORT} 无法访问 api.github.com，将直连`)
    } else {
      console.warn(`[proxy] 环境变量指定的端口 ${ENV_PORT} 不可用`)
    }
  }

  // 2. 并行检测所有候选端口，然后只验证可连接的端口
  const openPorts = await checkPortsInParallel(PROXY_PORTS)
  for (const port of openPorts) {
    console.log(`[proxy] 自动检测到代理端口 ${port}`)
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${port}`)
    const verified = await verifyHttpProxy(agent)
    if (verified) {
      console.log(`[proxy] 端口 ${port} 可访问 api.github.com`)
      return { port, agent, verified: true }
    }
    console.warn(`[proxy] 端口 ${port} 无法访问 api.github.com，尝试下一个...`)
  }

  // 3. 无可用代理 — 直连
  if (openPorts.length === 0) {
    console.warn('[proxy] 未检测到可用本地代理，将直连 GitHub（国内网络可能超时）')
  } else {
    console.warn('[proxy] 检测到代理端口但均无法访问 api.github.com，将直连')
  }
  return { port: null, agent: null, verified: false }
}

/** 验证代理能否访问 api.github.com（8s 超时，避免启动卡顿） */
function verifyHttpProxy(agent) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/',
      method: 'HEAD',
      agent,
      timeout: 8000,
      headers: { 'User-Agent': 'Vite-Proxy-Check' },
    }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

/** 检测端口是否可连接（TCP 握手，300ms 超时） */
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(300)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.connect(port, '127.0.0.1')
  })
}

/** 并行检测所有候选端口，返回第一个可连接的端口列表 */
async function checkPortsInParallel(ports) {
  const results = await Promise.all(ports.map(p => checkPort(p).then(ok => ({ port: p, ok }))))
  return results.filter(r => r.ok).map(r => r.port)
}

export default defineConfig(async () => {
  const { port, agent } = await detectProxy()

  return {
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/api/gh': {
          target: 'https://api.github.com',
          changeOrigin: true,
          timeout: 15000,
          agent,
          rewrite: (path) => path.replace(/^\/api\/gh/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              try {
                if (req.headers.authorization) {
                  proxyReq.setHeader('Authorization', req.headers.authorization)
                }
              } catch { /* headers 已发送，忽略 */ }
            })
            proxy.on('error', (err, req, res) => {
              console.warn(`[proxy] 代理请求失败：`, err.message)
              try {
                if (res && !res.headersSent && !res.writableEnded) {
                  res.writeHead(502, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({
                    error: 'GitHub API 代理失败，请检查本地代理（Clash/V2Ray）是否开启',
                    detail: err.message,
                  }))
                }
              } catch { /* 静默 */ }
            })
          },
        },
        '/api/searx1': {
          target: 'https://searx.be',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/searx1/, ''),
          agent,
        },
        '/api/searx2': {
          target: 'https://search.sapti.me',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/searx2/, ''),
          agent,
        },
        '/api/searx3': {
          target: 'https://search.ononoki.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/searx3/, ''),
          agent,
        },
        '/api/devdocs': {
          target: 'https://documents.devdocs.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/devdocs/, ''),
          agent,
        },
        '/api/ghblog': {
          target: 'https://github.blog',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ghblog/, ''),
          agent,
        },
      },
    },
  }
})
