// SearXNG 转发共享模块（Vercel 下划线开头文件不作为路由，仅供其他函数 import）
// 三个公共实例各有一个入口文件调用此工厂

const INSTANCES = {
  1: 'https://searx.be',
  2: 'https://search.sapti.me',
  3: 'https://search.ononoki.org',
}

export function createSearxHandler(num) {
  const target = INSTANCES[num]
  if (!target) throw new Error(`未知 SearXNG 实例编号: ${num}`)

  return async function handler(req, res) {
    // req.url 形如 /api/searx1/search?format=json&q=...
    const url = new URL(req.url, 'http://placeholder')
    const prefix = new RegExp(`^/api/searx${num}`)
    const subPath = url.pathname.replace(prefix, '') || '/'
    const targetUrl = target + subPath + (url.search || '')

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: { 'Accept': 'application/json' },
      })

      res.status(upstream.status)
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')

      const text = await upstream.text()
      res.end(text)
    } catch (err) {
      console.error(`[api/searx${num}] 转发失败:`, err.message)
      res.status(502)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: `SearXNG 实例 ${num} 转发失败`, results: [] }))
    }
  }
}
