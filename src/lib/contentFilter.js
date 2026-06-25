/**
 * 内容过滤器 — 筛除政治敏感 / 无关仓库
 *
 * 原则：
 *   1. 只过滤明确违反中国法律法规的内容
 *   2. 黑名单维护在独立文件中，便于后续更新
 *   3. 对 repo 和 issue（所属仓库）都做检查
 */

// ===== 精确黑名单：owner/repo =====
const BLOCKED_REPOS = new Set([
  'cirosantilli/china-dictatorship',
])

// ===== 组织/用户黑名单 =====
const BLOCKED_OWNERS = new Set([
  'cirosantilli',
])

// ===== 关键词黑名单（匹配仓库名或描述，小写）=====
const BLOCKED_KEYWORDS = [
  'dictatorship',
  'tiananmen',
  'falun',
  'tibet independence',
  'uighur',
  'xinjiang independence',
  'hong kong independence',
  'taiwan independence',
  'anti-china',
  'anti-ccp',
]

/**
 * 检查仓库是否应被过滤
 * @param {{ fullName?: string, full_name?: string, name?: string, desc?: string, description?: string }} repo
 * @returns {boolean} true = 应过滤
 */
export function isRepoBlocked(repo) {
  if (!repo) return false

  // 精确匹配 repo fullName
  const fullName = repo.fullName || repo.full_name || ''
  if (fullName && BLOCKED_REPOS.has(fullName)) return true

  // 匹配组织/用户（从 fullName 解析 owner）
  const owner = fullName.split('/')[0] || ''
  if (owner && BLOCKED_OWNERS.has(owner)) return true

  // 匹配关键词（仓库名 + 描述）
  const name = (repo.name || '').toLowerCase()
  const desc = (repo.desc ?? repo.description ?? '').toLowerCase()
  for (const kw of BLOCKED_KEYWORDS) {
    if (name.includes(kw) || desc.includes(kw)) return true
  }

  return false
}

/**
 * 检查仓库名（owner/repo 字符串）是否应被过滤
 * 用于 Issue 所属仓库的过滤
 * @param {string} fullName 如 "owner/repo"
 * @returns {boolean} true = 应过滤
 */
export function isRepoNameBlocked(fullName) {
  if (!fullName) return false

  if (BLOCKED_REPOS.has(fullName)) return true

  const [owner, repoName] = fullName.split('/')
  if (owner && BLOCKED_OWNERS.has(owner)) return true

  if (repoName) {
    const name = repoName.toLowerCase()
    for (const kw of BLOCKED_KEYWORDS) {
      if (name.includes(kw)) return true
    }
  }

  return false
}