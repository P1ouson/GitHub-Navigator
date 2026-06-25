// Vercel Serverless Function：转发请求到 GitHub API
// 解决生产环境（Vercel 静态托管）下国内用户直连 api.github.com 超时的问题
// 请求由 Vercel 服务器（境外）发出，速度快且稳定
//
// 路由：/api/gh/*  →  https://api.github.com/*
// 前端 Octokit 的 baseUrl 设为 /api/gh，所有请求自动走这里
//
// 透传：HTTP 方法、Authorization（用户 Token）、请求体、响应状态码、
//       Link 分页头、X-RateLimit-* 限流头

const GITHUB_API = 'https://api.github.com'

// 需要透传给 GitHub 的请求头（小写）
const FORWARD_REQ_HEADERS = [
  'authorization',
  'accept',
  'content-type',
  'if-none-match',
  'if-modified-since',
]

// 需要透传回前端的响应头
const FORWARD_RES_HEADERS = [
  'content-type',
  'link',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'etag',
  'last-modified',
  'cache-control',
]

export default async function handler(req, res) {
  // 提取 /api/gh 之后的路径 + query
  // req.url 形如 /api/gh/repos/owner/repo?per_page=10
  const url = new URL(req.url, 'http://placeholder')
  const subPath = url.pathname.replace(/^\/api\/gh/, '') || '/'
  const targetUrl = GITHUB_API + subPath + (url.search || '')

  // 组装转发请求头
  const headers = {
    'User-Agent': 'GitHub-Navigator',
    'Accept': 'application/vnd.github+json',
  }
  for (const h of FORWARD_REQ_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h]
  }

  // 读取请求体（POST/PUT/PATCH/DELETE 可能有 body）
  let body = undefined
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    })

    // 透传关键响应头
    const resHeaders = {}
    for (const h of FORWARD_RES_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) resHeaders[h] = v
    }

    res.status(upstream.status)
    for (const [k, v] of Object.entries(resHeaders)) {
      res.setHeader(k, v)
    }

    // 透传响应体（JSON 或文本）
    const text = await upstream.text()
    res.end(text)
  } catch (err) {
    console.error('[api/gh] 转发失败:', err.message)
    res.status(502)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      message: 'GitHub API 代理转发失败（Vercel Serverless）',
      documentation_url: 'https://docs.github.com/rest',
    }))
  }
}
