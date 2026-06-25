/**
 * Cloudflare Pages Function — GitHub API 代理
 *
 * 路由：/api/gh/* → https://api.github.com/*
 *
 * 作用：
 *   - 解决浏览器 CORS 限制（直连 api.github.com 会被浏览器拦截）
 *   - 国内可访问（Cloudflare 边缘节点在国内有节点，不像 Vercel 被墙）
 *   - 透传用户 Token（Authorization header）以提升限流到 5000/h
 *
 * 注意：本函数只做透明转发，不缓存、不改写响应体。
 */

const UPSTREAM = 'https://api.github.com'

export async function onRequest(context) {
  const { request, params } = context
  // [[path]] 是 catch-all 参数，返回数组
  const pathSegments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean)
  const path = pathSegments.join('/')

  // 重建目标 URL：拼接 path + query string
  const url = new URL(request.url)
  const targetUrl = new URL(`${UPSTREAM}/${path}`)
  // 透传所有 query 参数
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value)
  })

  // 构建转发请求的 headers
  const headers = new Headers()
  // 必须透传 Authorization（用户 Token）
  if (request.headers.get('Authorization')) {
    headers.set('Authorization', request.headers.get('Authorization'))
  }
  // GitHub API 要求 User-Agent
  headers.set('User-Agent', 'GitHub-Navigator-Cloudflare-Proxy')
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('X-GitHub-Api-Version', '2022-11-28')
  // Content-Type（POST/PUT 请求体）
  if (request.headers.get('Content-Type')) {
    headers.set('Content-Type', request.headers.get('Content-Type'))
  }

  // 转发请求（保留 method 和 body）
  const init = {
    method: request.method,
    headers,
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.clone().text()
  }

  try {
    const upstreamResp = await fetch(targetUrl.toString(), init)

    // 透传响应，保留状态码和关键 headers
    const respHeaders = new Headers()
    // 透传速率限制相关 headers（供前端展示剩余配额）
    const passthroughHeaders = [
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'x-ratelimit-used',
      'x-ratelimit-resource',
      'link',
      'etag',
      'last-modified',
      'content-type',
      'cache-control',
    ]
    passthroughHeaders.forEach(h => {
      const v = upstreamResp.headers.get(h)
      if (v) respHeaders.set(h, v)
    })
    // CORS（与 _headers 配合，确保浏览器能读取）
    respHeaders.set('Access-Control-Allow-Origin', '*')

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    })
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'GitHub API 代理请求失败',
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

// 处理 CORS 预检请求
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, User-Agent',
      'Access-Control-Max-Age': '86400',
    },
  })
}
