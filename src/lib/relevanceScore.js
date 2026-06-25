/**
 * 语义相关度评分
 *
 * 仓库：仓库名/组织名 > 描述 > topics > star (tiebreaker)
 * Issue：标题 > 仓库名 > label 匹配
 * 代码：文件名 > 路径 > 仓库名
 */

/**
 * 将 query 切分为小写 token，只保留长度 >= 2 的
 */
export function tokenizeSearchQuery(query) {
  return (query || '')
    .toLowerCase()
    .split(/[/\s_-]+/)
    .filter(t => t.length >= 2)
}

/**
 * 仓库语义相关度评分
 * @returns {{ score: number, matchHint: string }}
 */
export function scoreRepoRelevance(repo, query) {
  const q = query.toLowerCase()
  let score = 0
  let matchHint = ''
  const name = (repo.name || '').toLowerCase()
  const desc = (repo.desc || '').toLowerCase()
  const tokens = tokenizeSearchQuery(query)

  // 仓库名精确匹配（最高权重）
  if (name === q) { score += 60; matchHint = '仓库名完全匹配' }
  else if (name.includes(q)) { score += 40; matchHint = '仓库名包含关键词' }
  else {
    const nameMatch = tokens.filter(t => name.includes(t)).length
    if (nameMatch > 0) { score += nameMatch * 15; matchHint = `仓库名匹配 ${nameMatch}/${tokens.length} 个关键词` }
  }

  // 组织名/仓库名匹配
  const slashIdx = name.indexOf('/')
  if (slashIdx > 0) {
    const org = name.slice(0, slashIdx)
    const repoName = name.slice(slashIdx + 1)
    if (org.includes(q)) { score += 15; if (!matchHint) matchHint = '组织名匹配' }
    if (repoName.includes(q)) { score += 10; if (!matchHint) matchHint = '仓库名匹配' }
    // 多 token 匹配
    for (const token of tokens) {
      if (repoName.includes(token)) { score += 8; if (!matchHint) matchHint = '仓库名匹配' }
    }
  }

  // 描述匹配
  if (desc) {
    if (desc.includes(q)) score += 10
    else {
      const descMatch = tokens.filter(t => desc.includes(t)).length
      score += descMatch * 3
    }
  }

  // topics 匹配
  if (repo.topics?.length) {
    const topicMatch = repo.topics.filter(t => q.includes(t.toLowerCase())).length
    score += topicMatch * 5
    if (topicMatch > 0 && !matchHint) matchHint = 'Topics 匹配'
  }

  return { score: Math.min(score, 100), matchHint: matchHint || '关键词相关' }
}

/**
 * 仓库匹配说明
 */
export function getRepoMatchHint(repo, query) {
  return scoreRepoRelevance(repo, query).matchHint
}

/**
 * Issue 语义相关度评分
 */
export function scoreIssueRelevance(issue, query) {
  const q = query.toLowerCase()
  let score = 0
  const title = (issue.title || '').toLowerCase()
  const repo = (issue.repo || '').toLowerCase()
  const tokens = tokenizeSearchQuery(query)

  if (title === q) score += 50
  else if (title.includes(q)) score += 35
  else {
    const titleMatch = tokens.filter(t => title.includes(t)).length
    score += titleMatch * 10
  }

  if (repo.includes(q)) score += 15
  else {
    const repoMatch = tokens.filter(t => repo.includes(t)).length
    score += repoMatch * 5
  }

  if (issue.labels?.length) {
    const labelMatch = issue.labels.filter(l =>
      q.includes(l.name?.toLowerCase()) || l.name?.toLowerCase().includes(q)
    ).length
    score += labelMatch * 8
  }

  return Math.min(score, 100)
}

/**
 * 代码片段相关度评分
 */
export function scoreCodeRelevance(item, query) {
  const q = query.toLowerCase()
  let score = 0
  const name = (item.name || '').toLowerCase()
  const path = (item.path || '').toLowerCase()
  const repo = (item.repo || '').toLowerCase()
  const tokens = tokenizeSearchQuery(query)

  if (name.includes(q)) score += 40
  else {
    const nameMatch = tokens.filter(t => name.includes(t)).length
    score += nameMatch * 12
  }

  if (path.includes(q)) score += 15
  else {
    const pathMatch = tokens.filter(t => path.includes(t)).length
    score += pathMatch * 5
  }

  if (repo.includes(q)) score += 10
  else {
    const repoMatch = tokens.filter(t => repo.includes(t)).length
    score += repoMatch * 3
  }

  return Math.min(score, 100)
}

/**
 * 按类型评分
 */
export function scoreByType(items, query, type) {
  if (!items?.length) return items
  if (type === 'repo') {
    return items.map(item => {
      const { score, matchHint } = scoreRepoRelevance(item, query)
      return { ...item, _score: score, _matchHint: matchHint }
    })
  }
  if (type === 'code') {
    return items.map(item => ({ ...item, _score: scoreCodeRelevance(item, query) }))
  }
  return items.map(item => ({ ...item, _score: scoreIssueRelevance(item, query) }))
}

/**
 * 按相关度重排，star 仅当 tiebreaker
 * @param {Array} items
 * @param {string} query
 * @param {string} type
 * @param {number} [limit] 截断条数
 */
export function rerankByRelevance(items, query, type, limit) {
  if (!items?.length) return items
  const scored = scoreByType(items, query, type)
  const sorted = [...scored].sort((a, b) => {
    const ra = a._score || 0
    const rb = b._score || 0
    if (ra !== rb) return rb - ra
    return (b.stars || 0) - (a.stars || 0)
  })
  return limit ? sorted.slice(0, limit) : sorted
}