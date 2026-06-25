/**
 * Issue enrich 纯流水线
 *
 * 职责边界：
 *   - 纯函数，不管理缓存，不调 API
 *   - 输入 IssueSummary[] + Map<repo, entry>，输出带 _repoHealth 的 issues
 *   - 过滤逻辑（活跃度/星数）收口到此模块
 *
 * 字段语义：
 *   - _repoHealth.stars/forks 为 number | null（null 表示未知，禁止用 0 伪装）
 *   - assessLiveness 读主字段 updatedAt，兼容旧字段 pushedAt（旧缓存）
 *   - entry 为 null（API 失败）→ liveness=unknown，stars/forks/language=null
 *   - _repoHealth 永远不为 null（总有 liveness），下游统一读 _repoHealth.liveness
 */

const LEVEL_ORDER = { active: 0, maintained: 1, inactive: 2, dead: 3 }

/**
 * 仓库活跃度评级（用于 issue 过滤）
 * level: 'active' | 'maintained' | 'inactive' | 'dead' | 'unknown'
 *
 * 读主字段 updatedAt，兼容旧字段 pushedAt（旧缓存 hydrate 进来的 entry）。
 * @param {object} info - repoCache entry 或类似结构
 * @returns {{ level: string, days: number|null }}
 */
export function assessLiveness(info) {
  if (!info || info.archived) return { level: 'dead', days: null }
  const ts = info.updatedAt ?? info.pushedAt
  if (!ts) return { level: 'unknown', days: null }
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / (24 * 60 * 60 * 1000))
  if (days <= 30) return { level: 'active', days }
  if (days <= 365) return { level: 'maintained', days }
  if (days <= 730) return { level: 'inactive', days }
  return { level: 'dead', days }
}

/**
 * 仓库是否适合展示 Issue
 *   maintained：仅剔除明确 dead / inactive，unknown 保留（API 失败不算坏）
 *   active：只保留 active / maintained
 *   any：仅排除明确 dead（archived），保留 unknown/inactive/maintained/active
 * @param {{ level: string }} health
 * @param {string} minLiveness - 'any' | 'maintained' | 'active'
 * @returns {boolean}
 */
export function isRepoEligibleForIssues(health, minLiveness = 'maintained') {
  if (!health) return false
  const { level } = health
  if (minLiveness === 'any') return level !== 'dead'
  if (level === 'unknown') return minLiveness === 'maintained' || minLiveness === 'any'
  const minOrder = LEVEL_ORDER[minLiveness] ?? 1
  return (LEVEL_ORDER[level] ?? 4) <= minOrder
}

/**
 * 纯函数：enrich 一批 issue，附加 _repoHealth
 * 不管理缓存，不调 API。
 *
 * @param {Array} issues - IssueSummary[]
 * @param {Map<string, object>} repoEntries - repo → repoCache entry（可能不含某些 repo）
 * @returns {Array} 带 _repoHealth 的 issues（_repoHealth 永不为 null）
 */
export function enrichIssues(issues, repoEntries) {
  return issues.map(issue => {
    const entry = issue.repo ? repoEntries.get(issue.repo) : null
    const health = entry ? assessLiveness(entry) : { level: 'unknown', days: null }
    return {
      ...issue,
      _repoHealth: {
        stars: entry?.stars ?? null,
        forks: entry?.forks ?? null,
        language: entry?.language ?? null,
        liveness: health,
      },
    }
  })
}

/**
 * 纯函数：按活跃度过滤 issues
 * 读 issue._repoHealth.liveness，不满足 minLiveness 的剔除。
 *
 * @param {Array} issues - 已 enrich 的 issues（带 _repoHealth）
 * @param {string} minLiveness
 * @returns {Array} 通过的 issues
 */
export function filterByLiveness(issues, minLiveness) {
  return issues.filter(issue => isRepoEligibleForIssues(issue._repoHealth?.liveness, minLiveness))
}

/**
 * 纯函数：按星数过滤 issues
 *   - null stars 不被过滤（未知，保留）
 *   - minStars > 0 且 stars != null 且 stars < minStars → 过滤
 *   - maxStars > 0 且 stars != null 且 stars > maxStars → 过滤
 *
 * @param {Array} issues - 已 enrich 的 issues
 * @param {number} minStars - 0 表示不限制
 * @param {number} maxStars - 0 表示不限制
 * @returns {Array} 通过的 issues
 */
export function filterByStars(issues, minStars, maxStars) {
  return issues.filter(issue => {
    const stars = issue._repoHealth?.stars
    // null stars 未知，不过滤
    if (stars == null) return true
    if (minStars > 0 && stars < minStars) return false
    if (maxStars > 0 && stars > maxStars) return false
    return true
  })
}
