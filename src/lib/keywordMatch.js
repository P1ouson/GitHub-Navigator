/**
 * 技能 / 领域关键词匹配公共模块
 *
 * 收口 GrowthPage 和 ProfilePage 里重复的"短关键词用单词边界、长关键词用包含匹配"逻辑：
 *   - GrowthPage.buildSkillStats：遍历 SKILL_TREE 关键词匹配贡献记录
 *   - ProfilePage.matchDomain：遍历 TECH_DOMAINS 关键词匹配贡献记录
 *
 * 两处实现本质相同（都是"短词边界匹配 + 长词包含匹配"），只是数据源不同。
 * 本模块抽出匹配能力，页面只负责传数据源和待匹配文本。
 *
 * 注意：本模块只提供匹配纯函数，不涉及 SKILL_TREE / TECH_DOMAINS 数据定义
 *       （那些是页面特有的业务数据，留在各自页面）。
 */

/**
 * 转义正则特殊字符
 * @param {string} s
 * @returns {string}
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 单个关键词匹配文本
 *   - 短关键词（≤3 字符）用单词边界匹配，避免误匹配（go→google, ts→tests）
 *   - 长关键词用包含匹配
 * @param {string} text - 待匹配文本（应已 toLowerCase）
 * @param {string} keyword - 关键词
 * @returns {boolean}
 */
export function matchKeyword(text, keyword) {
  const lowerText = (text || '').toLowerCase()
  const kw = (keyword || '').toLowerCase()
  if (!kw) return false
  if (kw.length <= 3) {
    return new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i').test(lowerText)
  }
  return lowerText.includes(kw)
}

/**
 * 判断文本是否命中任一关键词
 * @param {string} text - 待匹配文本
 * @param {string[]} keywords - 关键词数组
 * @returns {boolean}
 */
export function matchAnyKeyword(text, keywords) {
  if (!Array.isArray(keywords) || !keywords.length) return false
  return keywords.some(k => matchKeyword(text, k))
}
