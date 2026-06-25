/**
 * SearXNG 代理共享逻辑
 *
 * 三个 SearXNG 实例只是上游 URL 不同，逻辑完全一致：
 *   - 透传 path + query string
 *   - 不需要 Authorization（SearXNG 是公开 API）
 *   - 透传响应
 *
 * 由 api/searx{1,2,3}/[...path].js 调用
 * 注意：config 必须在每个路由文件里单独导出，不能从共享文件导入
 */

export function createSearxngProxy(upstream) {
  return async function handler(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    const url = new URL(req.url)
    // 从 pathname 去掉 /api/searxN 前缀
    const path = url.pathname.replace(/^\/api\/searx\d+/, '')
    const base = upstream.replace(/\/$/, '')
    const targetUrl = new URL(path ? `${base}${path}` : `${base}/`)
    url.searchParams.forEach((v, k) => targetUrl.searchParams.append(k, v))

    const headers = new Headers()
    headers.set('User-Agent', 'GitHub-Navigator')
    // SearXNG 部分实例会根据 Accept 决定返回格式，优先 JSON
    headers.set('Accept', url.searchParams.get('format') === 'json' ? 'application/json' : 'text/html')

    try {
      const resp = await fetch(targetUrl.toString(), { method: req.method, headers })

      const respHeaders = new Headers()
      ;['content-type', 'cache-control', 'etag', 'last-modified'].forEach(h => {
        const v = resp.headers.get(h)
        if (v) respHeaders.set(h, v)
      })
      respHeaders.set('Access-Control-Allow-Origin', '*')

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      })
    } catch (err) {
      return new Response(JSON.stringify({
        error: 'SearXNG 代理请求失败',
        detail: err.message,
        upstream: targetUrl.toString(),
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }
  }
}
