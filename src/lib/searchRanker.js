/**
 * 搜索结果清洗与排序
 *
 * Layer 5: sortIssuesForDisplay — contentLang 优先语言排序 + 相关度 → 健康分 → star
 * Layer 6: rankResults — issue 入 Tab 前双保险过滤
 *   - _source === 'github_api'
 *   - labels 非空数组
 *   - isNoiseIssue 双保险
 *   - SearXNG 搜到的 issue 链接不进 Issue Tab（只在 GitHub/网页 Tab）
 */

import { scoreByType, rerankByRelevance } from './relevanceScore.js'
import { filterIssues, isNoiseIssue } from './issueFilter.js'

const TYPE_PRIORITY = {
  repo: 0,
  issue: 1,
  code: 2,
  github: 3,
  web: 4,
}

/**
 * 清洗并排序搜索结果
 */
export function rankResults(sources, query, intent) {
  const ranked = []
  const seenUrls = new Set()

  // 1. 处理 GitHub API 的结构化结果
  for (const type of ['repo', 'issue', 'code']) {
    let items = sources[type]
    if (!items?.length) continue

    if (type === 'issue') {
      // Layer 6: 噪音过滤始终生效；label 过滤仅 beginnerMode
      items = items.filter(i => !isNoiseIssue(i))
    }

    const scored = scoreByType(items, query, type)
    const reranked = rerankByRelevance(scored, query, type)

    for (const item of reranked) {
      ranked.push({
        ...item,
        _type: type,
        _source: 'github_api',
        _priority: TYPE_PRIORITY[type],
        _label: type === 'repo' ? '📦 仓库' : type === 'issue' ? '📌 Issue' : '📝 代码',
      })
    }
  }

  // 2. 处理 SearXNG 结果 — issue 链接不进 Issue Tab
  for (const key of Object.keys(sources)) {
    if (!key.startsWith('searxng_')) continue
    const data = sources[key]
    if (!data?.results?.length) continue
    const subType = key.replace('searxng_', '')

    for (const r of data.results) {
      if (!r.url || seenUrls.has(r.url)) continue
      seenUrls.add(r.url)

      const rawType = classifySearxngResult(r, subType)
      // SearXNG 搜到的 issue 链接归到 github Tab，不进 Issue Tab
      const type = rawType === 'issue' ? 'github' : rawType
      const score = scoreResult(r, query, type)

      ranked.push({
        id: r.url,
        title: r.title,
        desc: r.content,
        url: r.url,
        _type: type,
        _source: 'searxng',
        _engine: r.engine,
        _priority: TYPE_PRIORITY[type],
        _score: score,
        _label: getTypeLabel(type),
        _publishedDate: r.publishedDate,
      })
    }
  }

  // 3. 排序
  ranked.sort((a, b) => {
    if (a._priority !== b._priority) return a._priority - b._priority
    return (b._score || 0) - (a._score || 0)
  })

  // 4. 按类型分组
  const sections = {}
  for (const item of ranked) {
    const group = item._type
    if (!sections[group]) sections[group] = []
    sections[group].push(item)
  }

  return { ranked, sections }
}

function classifySearxngResult(result, subType) {
  const url = (result.url || '').toLowerCase()
  if (/github\.com\/[\w.-]+\/[\w.-]+/.test(url)) {
    if (url.includes('/issues/') || url.includes('/pull/') || url.includes('/pulls')) return 'issue'
    return 'repo'
  }
  if (url.includes('github.com')) return 'github'
  if (url.includes('gitlab.com') || url.includes('bitbucket.org') || url.includes('sourceforge.net')) return 'code'
  if (url.includes('stackoverflow.com') || url.includes('dev.to') || url.includes('medium.com')) return 'code'
  return 'web'
}

function scoreResult(result, query, type) {
  let score = 30
  const q = query.toLowerCase()
  const title = (result.title || '').toLowerCase()
  const content = (result.content || '').toLowerCase()
  const url = (result.url || '').toLowerCase()
  if (title.includes(q)) score += 30
  else {
    const tokens = q.split(/\s+/)
    const titleMatch = tokens.filter(t => title.includes(t)).length
    score += titleMatch * 8
  }
  const contentMatch = q.split(/\s+/).filter(t => content.includes(t)).length
  score += contentMatch * 4
  if (url === q) score += 50
  if (url.includes(q)) score += 20
  if (q.includes('github') && url.includes('github.com')) score += 15
  return Math.min(score, 100)
}

function getTypeLabel(type) {
  const map = { repo: '📦 仓库', issue: '📌 Issue', code: '📝 代码', github: '🐙 GitHub', web: '🌐 网页' }
  return map[type] || '🌐 网页'
}

export function getSectionTitle(type) {
  const map = { repo: '📦 仓库', issue: '📌 Issue', code: '📝 代码段', github: '🐙 GitHub 相关', web: '🌐 网页' }
  return map[type] || '🌐 网页'
}

/**
 * Layer 5: 按 contentLang 优先语言排序 issues
 * - 'en'：英文标题排前面（中文仍显示，只是靠后）
 * - 'zh'：中文标题排前面
 * - 'any'：不调整语言顺序
 * 然后按：相关度 → 仓库健康分 → star
 */
export function sortIssuesForDisplay(issues, prefLang) {
  if (!issues?.length) return issues

  const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s || '')
  const langRank = (item) => {
    if (!prefLang || prefLang === 'any') return 0
    const isCh = hasChinese(item.title)
    if (prefLang === 'en') return isCh ? 1 : 0
    if (prefLang === 'zh') return isCh ? 0 : 1
    return 0
  }

  return [...issues].sort((a, b) => {
    // 1. 语言优先级
    const la = langRank(a)
    const lb = langRank(b)
    if (la !== lb) return la - lb
    // 2. 相关度
    const ra = a._relevance || 0
    const rb = b._relevance || 0
    if (ra !== rb) return rb - ra
    // 3. 仓库健康分
    const ha = a._repoHealth?.liveness?.days ?? 9999
    const hb = b._repoHealth?.liveness?.days ?? 9999
    if (ha !== hb) return ha - hb
    // 4. star
    return (b._repoHealth?.stars || 0) - (a._repoHealth?.stars || 0)
  })
}
