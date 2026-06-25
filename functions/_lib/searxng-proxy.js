/**
 * SearXNG 代理共享逻辑
 *
 * 三个 SearXNG 实例只是上游 URL 不同，逻辑完全一致：
 *   - 透传 path + query string
 *   - 不需要 Authorization（SearXNG 是公开 API）
 *   - 透传响应
 *
 * 由 functions/api/searx{1,2,3}/[[path]].js 调用
 */

export function createSearxngProxy(upstream) {
  return async function onRequest(context) {
    const { request, params } = context
    const pathSegments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean)
    const path = pathSegments.join('/')

    const url = new URL(request.url)
    const base = upstream.replace(/\/$/, '')
    const targetUrl = new URL(path ? `${base}/${path}` : `${base}/`)
    url.searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value)
    })

    const headers = new Headers()
    headers.set('User-Agent', 'GitHub-Navigator-Cloudflare-Proxy')
    headers.set('Accept', 'application/json, text/html;q=0.9, */*;q=0.8')
    // SearXNG 部分实例会根据 Accept 决定返回格式，优先 JSON
    if (url.searchParams.get('format') === 'json') {
      headers.set('Accept', 'application/json')
    }

    const init = {
      method: request.method,
      headers,
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.clone().text()
    }

    try {
      const upstreamResp = await fetch(targetUrl.toString(), init)

      const respHeaders = new Headers()
      ;['content-type', 'cache-control', 'etag', 'last-modified'].forEach(h => {
        const v = upstreamResp.headers.get(h)
        if (v) respHeaders.set(h, v)
      })
      respHeaders.set('Access-Control-Allow-Origin', '*')

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
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

export function searxngOnRequestOptions() {
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
