/**
 * DevDocs 知识库 — 从 DevDocs CDN 检索 Git 官方文档
 *
 * DevDocs 提供结构化的开发者文档，数据格式：
 * - index.json: 条目索引 {entries: [{name, path, type}]}
 * - db.json: 文档内容 {path: html_content, ...}
 *
 * 注意：db.json 约 6MB，国内网络可能较慢。
 * 所有网络请求均带 5s 超时，不阻塞主搜索流程。
 */

// 开发环境走 Vite proxy，生产环境走 Vercel rewrite
const DEVDOCS_BASE = '/api/devdocs'
const DEVDOCS_INDEX_URL = `${DEVDOCS_BASE}/git/index.json`
const DEVDOCS_DB_URL = `${DEVDOCS_BASE}/git/db.json`
const FETCH_TIMEOUT = 5000

let cachedIndex = null
let cachedDb = null

/** 带超时的 fetch */
function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal })
    .then(r => { clearTimeout(timer); return r })
    .catch(err => { clearTimeout(timer); throw err })
}

/** 去除 HTML 标签，保留纯文本 */
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr|dt|dd|blockquote|pre|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 获取 DevDocs 索引（带缓存 + 超时） */
async function fetchIndex() {
  if (cachedIndex) return cachedIndex

  try {
    const resp = await fetchWithTimeout(DEVDOCS_INDEX_URL)
    const data = await resp.json()
    cachedIndex = data.entries || []
    return cachedIndex
  } catch (err) {
    console.warn('[DevDocs] 索引获取失败:', err.message)
    return []
  }
}

/** 获取 DevDocs 文档数据库（带缓存 + 超时） */
async function fetchDb() {
  if (cachedDb) return cachedDb

  try {
    const resp = await fetchWithTimeout(DEVDOCS_DB_URL, FETCH_TIMEOUT * 2) // db 较大，给 10s
    const data = await resp.json()
    cachedDb = data
    return data
  } catch (err) {
    console.warn('[DevDocs] 文档获取失败:', err.message)
    return {}
  }
}

/**
 * 搜索 DevDocs 文档（整体 5s 超时，不阻塞主流程）
 * @param {string} query 用户查询
 * @param {number} topN 最多返回条数
 * @returns {Promise<Array<{title: string, text: string, path: string, score: number, source: string}>>}
 */
export async function searchDevDocs(query, topN = 3) {
  // 整体超时保护：5s 内没完成就返回空
  const timeout = new Promise(resolve => setTimeout(() => resolve([]), FETCH_TIMEOUT))

  const search = async () => {
    const q = query.toLowerCase()
    const keywords = q.split(/\s+/).filter(w => w.length > 1)
    if (keywords.length === 0) return []

    // 1. 获取索引并匹配
    const entries = await fetchIndex()
    if (!entries.length) return []

    const scored = entries.map(entry => {
      let score = 0
      const nameLower = entry.name.toLowerCase()
      const typeLower = (entry.type || '').toLowerCase()

      for (const kw of keywords) {
        if (nameLower === kw) score += 20          // 精确匹配名称
        else if (nameLower.includes(kw)) score += 10  // 名称包含关键词
        if (typeLower.includes(kw)) score += 5     // 类型匹配
      }

      return { ...entry, score }
    })

    const matched = scored
      .filter(e => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)

    if (matched.length === 0) return []

    // 2. 获取文档内容
    const db = await fetchDb()

    return matched.map(entry => {
      const html = db[entry.path] || ''
      const text = stripHtml(html).slice(0, 2000) // 限制长度，避免上下文过长
      return {
        title: `${entry.name} — Git ${entry.type || ''}`.trim(),
        text: text || `Git ${entry.name} 文档`,
        path: entry.path,
        score: entry.score,
        source: 'devdocs',
      }
    }).filter(r => r.text.length > 20) // 过滤掉内容太少的
  }

  return Promise.race([search(), timeout])
}

/** 清除缓存（用于测试或强制刷新） */
export function clearDevDocsCache() {
  cachedIndex = null
  cachedDb = null
}
