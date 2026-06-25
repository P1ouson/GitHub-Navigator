/**
 * Issue 标签公共常量与辅助函数
 *
 * 收口项目里多处重复的"新手友好 label 关键词"列表：
 *   - beginnerScore.js 的 BEGINNER_LABEL_NAMES（11 项，含 starter）
 *   - issueFilter.js 的 BEGINNER_LABELS（11 项，含 documentation）
 *
 * 合并策略：取并集（12 项），保证两处调用方的匹配召回率都不下降。
 *   SearchPage 内部的 BEGINNER_LABEL_KEYWORDS 本轮不改（避免扩散到页面层），
 *   后续 Step 3 拆 SearchPage 时再替换。
 *
 * 注意：本模块只收口"标签关键词常量 + 通用判断函数"，
 *       不涉及 label 颜色解析、CSS class 映射等 UI 相关逻辑。
 */

/**
 * 新手友好 label 关键词（并集）
 * 用于 issue 评分、issue 过滤、新手模式筛选等场景
 */
export const BEGINNER_LABEL_KEYWORDS = [
  'good first issue', 'help wanted', 'beginner', 'beginner-friendly',
  'up for grabs', 'easy', 'easy pick', 'first-timers-only',
  'first contribution', 'low hanging fruit', 'starter', 'documentation',
]

/**
 * 文档类 label 关键词（用于 issue 评分的文档类加分判断）
 */
export const DOC_LABEL_KEYWORDS = ['doc', 'documentation', 'docs', 'readme']

/**
 * 判断单个 label name 是否为新手友好 label
 * @param {string} name - label 名称（任意大小写）
 * @returns {boolean}
 */
export function isBeginnerLabel(name) {
  const n = (name || '').toLowerCase()
  return BEGINNER_LABEL_KEYWORDS.some(k => n.includes(k))
}

/**
 * 判断 issue 的 labels 中是否包含新手友好 label
 * @param {{name:string}|string[]} labels - label 对象数组或字符串数组
 * @returns {boolean}
 */
export function hasBeginnerLabel(labels) {
  if (!Array.isArray(labels)) return false
  return labels.some(l => {
    const name = typeof l === 'string' ? l : (l?.name || '')
    return isBeginnerLabel(name)
  })
}
