/**
 * 搜索结果 UI helper
 *
 * 纯展示型辅助函数：label 颜色、CSS class 映射、liveness 文案。
 * 从 SearchPage 内联函数迁出，供 RankedItem / HoverCard 等子组件共用。
 */

/**
 * GitHub 标签颜色 → 白/黑文字（基于亮度）
 * @param {string} hex - 6 位 hex（不含 #）
 * @returns {string} '#ffffff' 或 '#1a1a1a'
 */
export function labelTextColor(hex) {
  if (!hex || hex.length < 6) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1a1a1a' : '#ffffff'
}

/**
 * label 名称 → CSS class
 * @param {string} name
 * @returns {string}
 */
export function getLabelClass(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('good first issue')) return 'issue-label-gfi'
  if (n.includes('help wanted')) return 'issue-label-help'
  if (n.includes('bug')) return 'issue-label-bug'
  if (n.includes('doc')) return 'issue-label-doc'
  return ''
}

/**
 * liveness level → CSS class
 * @param {string} level
 * @returns {string}
 */
export function livenessClass(level) {
  if (level === 'active') return 'liveness-good'
  if (level === 'maintained') return 'liveness-good'
  if (level === 'unknown') return 'liveness-warn'
  return 'liveness-bad'
}

/**
 * liveness level → 中文文案
 * @param {string} level
 * @returns {string}
 */
export function livenessText(level) {
  const map = { active: '活跃', maintained: '维护中', inactive: '低活跃', dead: '疑似废弃', unknown: '未知' }
  return map[level] || level
}
