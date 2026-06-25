/**
 * SearXNG 搜索引擎客户端
 *
 * 通过 Vite 代理转发请求，避免 CORS。
 * 支持多实例后备，请求失败时自动尝试下一个可用实例。
 */

// 实例列表：开发走 Vite proxy，生产走 Vercel Serverless，路径统一
const INSTANCES = ['/api/searx1', '/api/searx2', '/api/searx3']

const REQUEST_TIMEOUT = 20000 // 20s

/**
 * SearXNG 搜索（自动多实例后备）
 */
export async function searchSearxng(query, opts = {}) {
  const params = new URLSearchParams({
    format: 'json',
    q: query,
    categories: opts.categories || 'general',
    pageno: String(opts.pageno || 1),
    language: opts.language || 'all',
  })

  const qs = `?${params}`

  for (let i = 0; i < INSTANCES.length; i++) {
    const base = INSTANCES[i]
    const url = `${base}/search${qs}`
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      if (!data.results?.length && !data.infoboxes?.length) {
        throw new Error('empty')
      }
      console.debug(`[searxng] ✓ ${base.split('/')[2] || base} (${data.results?.length || 0} 条)`)
      return {
        results: data.results || [],
        infoboxes: data.infoboxes || [],
        suggestions: data.suggestions || [],
      }
    } catch (err) {
      const label = base.split('/')[2] || base
      console.warn(`[searxng] ✗ ${label}: ${err.message}`)
      // 最后一个实例也失败才抛出
      if (i === INSTANCES.length - 1) {
        console.warn('[searxng] 所有实例均不可用')
        throw err
      }
    }
  }

  return { results: [], infoboxes: [], suggestions: [] }
}

/**
 * 测试实例是否可用
 */
export async function testSearxngInstance() {
  try {
    const resp = await fetch(`${INSTANCES[0]}/search?format=json&q=test&categories=general`, {
      signal: AbortSignal.timeout(5000),
    })
    return resp.ok
  } catch (err) {
    console.warn('[searxng] 连通性检查失败:', err.message)
    return false
  }
}