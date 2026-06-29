/**
 * 多源知识库 — 并行检索 4 个外部知识源
 *
 * 来源：
 * 1. DevDocs      — Git 官方文档 CDN（走代理 /api/devdocs）
 * 2. GitHub Docs  — 官方文档仓库内容搜索（github/docs）
 * 3. GitHub Blog  — 官方博客搜索（走代理 /api/ghblog）
 * 4. GitHub Skills — 官方技能课程列表
 *
 * 所有来源并行搜索，任一超时 5s 即放弃，不阻塞主流程。
 */

import { safeGithub } from './github.js'

// ==================== DevDocs ====================

const DEVDOCS_BASE = '/api/devdocs'

let devdocsIndex = null
let devdocsDb = null

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6]|tr|dt|dd|blockquote|pre|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim()
}

async function fetchDevdocsIndex() {
  if (devdocsIndex) return devdocsIndex
  try {
    const r = await fetchWithTimeout(`${DEVDOCS_BASE}/git/index.json`)
    devdocsIndex = (await r.json()).entries || []
    return devdocsIndex
  } catch (e) {
    console.warn('[externalKB] DevDocs 索引:', e.message)
    return []
  }
}

async function fetchDevdocsDb() {
  if (devdocsDb) return devdocsDb
  try {
    const r = await fetchWithTimeout(`${DEVDOCS_BASE}/git/db.json`, 10000)
    devdocsDb = await r.json()
    return devdocsDb
  } catch (e) {
    console.warn('[externalKB] DevDocs DB:', e.message)
    return {}
  }
}

async function searchDevdocs(query, topN = 3) {
  const q = query.toLowerCase()
  const keywords = q.split(/\s+/).filter(w => w.length > 1)
  if (keywords.length === 0) return []

  const entries = await fetchDevdocsIndex()
  if (!entries.length) return []

  const scored = entries.map(entry => {
    let score = 0
    const nl = entry.name.toLowerCase()
    const tl = (entry.type || '').toLowerCase()
    for (const kw of keywords) {
      if (nl === kw) score += 20
      else if (nl.includes(kw)) score += 10
      if (tl.includes(kw)) score += 5
    }
    return { ...entry, score }
  })

  const matched = scored.filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, topN)
  if (!matched.length) return []

  const db = await fetchDevdocsDb()

  return matched.map(entry => {
    const text = stripHtml(db[entry.path] || '').slice(0, 2000)
    return {
      title: `${entry.name} — Git ${entry.type || ''}`.trim(),
      text: text || `Git ${entry.name} 文档`,
      source: 'DevDocs',
      category: 'devdocs',
      score: entry.score,
    }
  }).filter(r => r.text.length > 20)
}

// ==================== GitHub Docs ====================

/**
 * 搜索 GitHub 官方文档（github/docs 仓库）
 * 使用 GitHub Code Search API
 */
async function searchGithubDocs(query, topN = 3) {
  try {
    const result = await safeGithub(async (octo) => {
      const q = `repo:github/docs ${query}`
      const res = await octo.request('GET /search/code', {
        q,
        per_page: topN,
        headers: { accept: 'application/vnd.github.v3.text-match+json' },
      })
      return res.data.items || []
    }, [])
    if (!result.length) return []

    return result.map((item, i) => ({
      title: item.path.replace(/\.md$/, '').replace(/\//g, ' → '),
      text: (item.text_matches?.[0]?.fragment || item.name || '').slice(0, 1000),
      source: 'GitHub Docs',
      category: 'github-docs',
      score: 15 - i * 3,
      url: item.html_url,
    })).filter(r => r.text.length > 20)
  } catch (e) {
    console.warn('[externalKB] GitHub Docs:', e.message)
    return []
  }
}

// ==================== GitHub Blog ====================

/**
 * 搜索 GitHub 官方博客（WordPress REST API，走代理）
 */
async function searchGithubBlog(query, topN = 3) {
  try {
    const r = await fetchWithTimeout(
      `/api/ghblog/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=${topN}&_embed=true`
    )
    const posts = await r.json()
    if (!Array.isArray(posts) || !posts.length) return []

    return posts.map((post, i) => ({
      title: post.title?.rendered?.replace(/<[^>]+>/g, '') || '(无标题)',
      text: (post.excerpt?.rendered || '').replace(/<[^>]+>/g, '').slice(0, 1200),
      source: 'GitHub Blog',
      category: 'github-blog',
      score: 12 - i * 3,
      url: post.link,
    })).filter(r => r.text.length > 20)
  } catch (e) {
    console.warn('[externalKB] GitHub Blog:', e.message)
    return []
  }
}

// ==================== GitHub Skills ====================

/** 缓存 Skills 课程列表 */
let skillsCache = null
let skillsCacheTs = 0

async function fetchSkillsCatalog() {
  if (skillsCache && Date.now() - skillsCacheTs < 3600000) return skillsCache
  try {
    // GitHub Skills 课程列表在 GitHub 仓库中
    const result = await safeGithub(async (octo) => {
      const res = await octo.request('GET /search/repositories', {
        q: 'org:skills topic:github-skills',
        per_page: 50,
        sort: 'updated',
      })
      return res.data.items || []
    }, [])
    skillsCache = result.map(r => ({
      name: r.name || '',
      description: r.description || '',
      url: r.html_url,
      topics: r.topics || [],
    }))
    skillsCacheTs = Date.now()
    return skillsCache
  } catch (e) {
    console.warn('[externalKB] Skills 目录:', e.message)
    return skillsCache || []
  }
}

async function searchGithubSkills(query, topN = 3) {
  const q = query.toLowerCase()
  const keywords = q.split(/\s+/).filter(w => w.length > 1)
  if (keywords.length === 0) return []

  const catalog = await fetchSkillsCatalog()
  if (!catalog.length) return []

  const scored = catalog.map(skill => {
    let score = 0
    const nl = skill.name.toLowerCase()
    const dl = (skill.description || '').toLowerCase()
    const topics = skill.topics.join(' ').toLowerCase()
    for (const kw of keywords) {
      if (nl.includes(kw)) score += 15
      if (dl.includes(kw)) score += 8
      if (topics.includes(kw)) score += 5
    }
    return { ...skill, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => ({
      title: s.name,
      text: s.description || s.name,
      source: 'GitHub Skills',
      category: 'github-skills',
      score: s.score,
      url: s.url,
    }))
}

// ==================== 工具函数 ====================

function fetchWithTimeout(url, timeoutMs = 5000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { signal: ctrl.signal }).then(r => { clearTimeout(t); return r }).catch(e => { clearTimeout(t); throw e })
}

// ==================== 统一入口 ====================

/**
 * 并行搜索所有知识源
 * @param {string} query
 * @returns {Promise<Array<{title, text, source, category, score, url?}>>}
 */
export async function searchAllSources(query) {
  const results = await Promise.allSettled([
    timeoutRace(searchDevdocs(query, 3), 5000, 'DevDocs'),
    timeoutRace(searchGithubDocs(query, 3), 5000, 'GitHub Docs'),
    timeoutRace(searchGithubBlog(query, 3), 5000, 'GitHub Blog'),
    timeoutRace(searchGithubSkills(query, 3), 5000, 'GitHub Skills'),
  ])

  const allHits = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allHits.push(...r.value)
    } else if (r.status === 'rejected') {
      const names = ['DevDocs', 'GitHub Docs', 'GitHub Blog', 'GitHub Skills']
      console.warn(`[externalKB] ${names[i]}:`, r.reason?.message || r.reason)
    }
  })

  return allHits.sort((a, b) => b.score - a.score)
}

async function timeoutRace(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} 超时`)), ms)),
  ])
}