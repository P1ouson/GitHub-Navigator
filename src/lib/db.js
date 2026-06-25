import Dexie from 'dexie'

export const db = new Dexie('GitHubNavigator')

// v6: 新增 intentCache 表 — 用于 L2 意图 embedding 匹配
//     独立于 ragChunks（知识库），专门服务搜索意图路由
//     字段：query（原始查询）、intent、rewrittenQuery、filters、embedding、ts
db.version(6).stores({
  settings: '&key, value',
  contributions: '++id, type, repo, createdAt, status, language',
  searchCache: '&cacheKey, value, ts',
  ragChunks: '&id, docId, embedding',
  intentCache: '++id, query, ts',
})

// v5: contributions 表新增字段（保留版本声明用于升级路径）
// - stars: Fork/PR 时仓库的星数（用于质量评估）
// - language: 仓库主语言（用于技能树/雷达图）
// - issueNumber: PR 关联的 Issue 编号（用于追踪）
// - status: PR 状态（open/merged/closed，提交时默认 open，可后续更新）
// - additions: PR 新增行数（提交时未知，可后续更新）
// - deletions: PR 删除行数
db.version(5).stores({
  settings: '&key, value',
  contributions: '++id, type, repo, createdAt, status, language',
  searchCache: '&cacheKey, value, ts',
  ragChunks: '&id, docId, embedding',
})

export async function getSetting(key, defaultValue = null) {
  const item = await db.settings.get(key)
  return item ? item.value : defaultValue
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value })
}

/** 记录一条贡献（Fork / PR / Issue）
 * 可选字段：stars, language, issueNumber, status, additions, deletions
 */
export async function addContribution(record) {
  await db.contributions.put({
    ...record,
    createdAt: record.createdAt || new Date().toISOString(),
  })
}

/** 更新一条贡献记录（用于后续补充 PR 合并状态、代码行数等） */
export async function updateContribution(id, patch) {
  await db.contributions.update(id, patch)
}

/** 获取所有贡献记录，按时间倒序 */
export async function getContributions() {
  return db.contributions.orderBy('createdAt').reverse().toArray()
}

/** 获取贡献统计（含质量相关指标） */
export async function getContributionStats() {
  const all = await db.contributions.toArray()
  const repos = new Set(all.map(r => r.repo))
  const prs = all.filter(r => r.type === 'pr')
  const mergedPRs = prs.filter(r => r.status === 'merged')
  const totalAdditions = prs.reduce((s, r) => s + (r.additions || 0), 0)
  const totalDeletions = prs.reduce((s, r) => s + (r.deletions || 0), 0)
  // 活跃月数（过滤空 createdAt，避免空串被计入 Set 导致多算1）
  const months = new Set(
    all.map(r => (r.createdAt || '').slice(0, 7)).filter(Boolean)
  )
  return {
    total: all.length,
    forks: all.filter(r => r.type === 'fork').length,
    prs: prs.length,
    issues: all.filter(r => r.type === 'issue').length,
    repos: repos.size,
    // 质量指标
    mergedPRs: mergedPRs.length,
    mergeRate: prs.length > 0 ? Math.round((mergedPRs.length / prs.length) * 100) : 0,
    totalAdditions,
    totalDeletions,
    totalLines: totalAdditions + totalDeletions,
    activeMonths: months.size,
  }
}
