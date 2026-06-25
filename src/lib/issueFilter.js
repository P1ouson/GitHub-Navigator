/**
 * Issue 噪音过滤器
 * 过滤刷星曝光帖、广告、垃圾 issue 等低质量内容
 */

import { BEGINNER_LABEL_KEYWORDS } from './issueLabels.js'

// 噪音标题匹配模式
const NOISE_PATTERNS = [
  /刷星/, /曝光/, /假星/, /虚假/, /fake star/i,
  /\[震惊\]/, /\[忠告\]/, /\[警告\]/, /\[曝光\]/, /\[注意\]/,
  /star.*fake/i, /fake.*star/i, /star.*scam/i,
  /骗星/, /买星/, /刷榜/, /水军/, /造假/,
  /_warn/, /星.*假/, /假.*星/,
  /广告/, /推广/, /代刷/, /刷单/,
  /bought.*star/i, /purchased.*star/i,
]

/**
 * 判断单条 issue 是否为噪音
 */
export function isNoiseIssue(issue) {
  const title = issue.title || ''
  return NOISE_PATTERNS.some(p => p.test(title))
}

/**
 * 过滤噪音 issue
 */
export function filterIssues(issues) {
  if (!Array.isArray(issues)) return []
  return issues.filter(issue => !isNoiseIssue(issue))
}

/** 后过滤：保留有 label 的 issue（无 label 不展示） */
export function filterLabeledIssues(issues) {
  if (!Array.isArray(issues)) return []
  return issues.filter(issue => issue.labels && issue.labels.length > 0)
}

/**
 * 新手模式过滤：只保留 GFI / help wanted / 相关 label 的 issue
 */
export function filterBeginnerIssues(issues) {
  if (!Array.isArray(issues)) return []
  return issues.filter(issue => {
    if (!issue.labels?.length) return false
    return issue.labels.some(l => {
      const name = (l.name || l || '').toLowerCase()
      return BEGINNER_LABEL_KEYWORDS.some(b => name.includes(b))
    })
  })
}
