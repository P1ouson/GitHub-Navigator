/**
 * 搜索结果构建层（Search Builder / Adapter）
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 职责边界（约束）                                                     │
 * │                                                                      │
 * │ 本层负责：                                                           │
 * │   - 把 orchestrator 返回的原始数据变成 SearchPage 可渲染的结构        │
 * │   - 给 item 打 _type / _source 标记（repo/issue/code）                │
 * │   - 构建 rankedSections（主渲染源）                                   │
 * │   - 合并 load more 结果到 section                                     │
 * │   - 过滤政治敏感内容（isRepoBlocked / isRepoNameBlocked）             │
 * │   - 排序/重排（sortIssuesForDisplay / rerankByRelevance）             │
 * │                                                                      │
 * │ 本层不允许：                                                          │
 * │   - 网络请求（不调 GitHub API / fetch）                               │
 * │   - 业务分流（不做意图判断 / 搜索源选择）                              │
 * │   - 页面事件逻辑（不依赖 React / DOM）                                │
 * │   - 直接访问缓存层                                                    │
 * │                                                                      │
 * │ 输入契约：                                                            │
 * │   - tagXxxItem(item): 原始 repo/issue/code 对象                       │
 * │   - buildRankedSections(rawResults, query, intent): 多源原始结果      │
 * │   - prepareIssueList(issues, prefLang): issue 数组                    │
 * │   - prepareRepoList(repos, query): repo 数组                          │
 * │   - mergeSectionSlice(prevSections, tab, slice): 旧 sections + 新切片 │
 * │                                                                      │
 * │ 输出契约：                                                            │
 * │   - 每个 item 保证有 _type 和 _source 字段                            │
 * │   - rankedSections: { repo?: [], issue?: [], code?: [], ... }         │
 * │   - 空数组 section 会被删除（避免 tab 误显示）                         │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { rankResults, sortIssuesForDisplay } from '../searchRanker.js'
import { rerankByRelevance } from '../relevanceScore.js'
import { isRepoBlocked, isRepoNameBlocked } from '../contentFilter.js'

/**
 * 给 repo item 打标
 * @param {object} repo
 * @returns {object}
 */
export function tagRepoItem(repo) {
  return { ...repo, _type: 'repo', _source: 'github_api' }
}

/**
 * 给 issue item 打标
 * @param {object} issue
 * @returns {object}
 */
export function tagIssueItem(issue) {
  return { ...issue, _type: 'issue', _source: 'github_api' }
}

/**
 * 给 code item 打标
 * @param {object} code
 * @returns {object}
 */
export function tagCodeItem(code) {
  return { ...code, _type: 'code', _source: 'github_api' }
}

/**
 * 从原始 rawResults 构建 rankedSections
 * @param {object} rawResults - { repo, issue, code, knowledge, searxng_web }
 * @param {string} query
 * @param {string} intent
 * @returns {object} rankedSections
 */
export function buildRankedSections(rawResults, query, intent) {
  const { sections } = rankResults(rawResults, query, intent)
  // 空数组 section 删除，避免 tab 误显示
  if (sections.issue && sections.issue.length === 0) delete sections.issue
  return sections
}

/**
 * 过滤 + 排序 issue 列表（供首屏/翻页/label 重搜共用）
 * @param {object[]} issues
 * @param {string} prefLang
 * @returns {object[]}
 */
export function prepareIssueList(issues, prefLang) {
  const filtered = issues.filter(issue => !isRepoNameBlocked(issue.repo))
  return sortIssuesForDisplay(filtered, prefLang)
}

/**
 * 过滤 + 重排 repo 列表
 * @param {object[]} repos
 * @param {string} query
 * @returns {object[]}
 */
export function prepareRepoList(repos, query) {
  const filtered = repos.filter(item => !isRepoBlocked(item))
  return rerankByRelevance(filtered, query, 'repo')
}

/**
 * 合并 load more 结果到 rankedSections 的指定 tab
 * @param {object} prevSections
 * @param {string} tab
 * @param {object[]} slice
 * @returns {object}
 */
export function mergeSectionSlice(prevSections, tab, slice) {
  if (!prevSections) return { [tab]: slice }
  return { ...prevSections, [tab]: slice }
}
