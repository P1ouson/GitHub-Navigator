/**
 * Vercel Edge Function — GitHub API 代理
 * 路由：/api/gh/* → https://api.github.com/*
 *
 * 作用：
 *   - 解决浏览器 CORS 限制（直连 api.github.com 会被浏览器拦截）
 *   - 透传用户 Token（Authorization header）以提升限流到 5000/h
 *   - 透传速率限制 headers（供前端展示剩余配额）
 *
 * 用 Edge Function 代替 vercel.json rewrites：
 *   - rewrites 对外部 URL 的转发在某些 Vercel 项目配置下不生效（404）
 *   - Edge Function 是 Vercel 官方推荐的 API 代理方式，可靠性更高
 */
export const config = { runtime: 'edge' };

const UPSTREAM = 'https://api.github.com';

export default async function handler(req) {
  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, User-Agent',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const url = new URL(req.url);
  // 从 pathname 去掉 /api/gh 前缀，得到 /search/repositories 等
  const path = url.pathname.replace(/^\/api\/gh/, '');
  const targetUrl = new URL(`${UPSTREAM}${path}`)
  // 透传所有 query 参数
  url.searchParams.forEach((v, k) => targetUrl.searchParams.append(k, v))

  // 构建转发请求 headers
  const headers = new Headers()
  const auth = req.headers.get('authorization')
  if (auth) headers.set('Authorization', auth)
  headers.set('User-Agent', 'GitHub-Navigator')
  headers.set('Accept', 'application/vnd.github+json')
  headers.set('X-GitHub-Api-Version', '2022-11-28')
  const ct = req.headers.get('content-type')
  if (ct) headers.set('Content-Type', ct)

  // 非 GET/HEAD 请求透传 body
  const init = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  try {
    const resp = await fetch(targetUrl.toString(), init)

    // 透传响应，保留状态码和关键 headers
    const respHeaders = new Headers()
    ;[
      'content-type',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'x-ratelimit-used',
      'x-ratelimit-resource',
      'link',
      'etag',
      'last-modified',
      'cache-control',
    ].forEach(h => {
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
