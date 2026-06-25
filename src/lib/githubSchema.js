/**
 * GitHub 数据统一 schema 与 normalizer
 *
 * 本模块是 github.js 对外返回数据的唯一 contract 收口层。
 * 所有 github.js 的搜索/读取函数在返回前都应调用对应的 normalizer，
 * 保证下游页面与排序逻辑只依赖统一模型，不直接依赖各种原始 API 返回结构。
 *
 * 字段语义约定：
 *   - 主字段：下游应优先读取的字段，语义稳定
 *   - 兼容字段：为不破坏旧调用方暂时保留的别名，后续轮次逐步删除
 *
 * 兼容字段清单见文件末尾「兼容字段说明」。
 */

/* ============================================================
 * 类型定义（JSDoc）
 * ========================================================== */

/**
 * RepoSummary — 仓库摘要统一模型
 *
 * 字段语义（主键与命名已固定，禁止漂移）：
 *   - id        : 主键，统一为仓库完整坐标 owner/repo（单一稳定规则，不混用 API 数字 id）
 *   - name      : 纯仓库名，例如 react（不含 owner）
 *   - fullName  : owner/repo 完整坐标，例如 facebook/react
 *   - apiId     : GitHub 原生数字 id（附加字段，仅 API 路径有值，缓存路径为 undefined）
 *   - desc      : 仓库描述（description），允许为 null
 *   - stars     : star 数
 *   - forks     : fork 数
 *   - openIssues: open issue 数
 *   - language  : 主语言，允许为 null
 *   - url       : html_url
 *   - topics    : 主题标签数组（已截断到 5 个）
 *   - updatedAt : 最近更新时间（ISO 字符串），统一字段，允许为 null
 *   - archived  : 是否归档
 *
 * @typedef {Object} RepoSummary
 * @property {string} id
 * @property {string} name
 * @property {string} fullName
 * @property {number} [apiId]
 * @property {string|null} desc
 * @property {number|null} stars
 * @property {number|null} forks
 * @property {number|null} openIssues
 * @property {string|null} language
 * @property {string} url
 * @property {string[]} topics
 * @property {string|null} updatedAt
 * @property {boolean} archived
 */
/**
 * 缓存 entry 结构（由 normalizeRepoEntryFromREST/GraphQL 产出，存入 repoCache）
 * 仅包含主字段与 _ts 元数据（兼容字段已删除，旧缓存由 normalizer 读取层兜底）。
 *
 * @typedef {Object} RepoCacheEntry
 * @property {string} name
 * @property {string} fullName
 * @property {string|null} desc
 * @property {number|null} stars
 * @property {number|null} forks
 * @property {number|null} openIssues
 * @property {string|null} language
 * @property {string} url
 * @property {string[]} topics
 * @property {string|null} updatedAt
 * @property {boolean} archived
 * @property {number} _ts
 */

/**
 * IssueSummary — Issue 统一模型
 *
 * 字段语义：
 *   - id       : 稳定唯一标识，优先用 API 数字 id，缺失时用 number 兜底
 *   - number   : issue 编号（GitHub URL 中的编号）
 *   - title    : 标题
 *   - repo     : 所属仓库 owner/repo
 *   - labels   : 标签对象数组，统一形态 {name, color?}，color 缺失时为 undefined
 *   - url      : html_url
 *   - state    : 状态（'open'/'closed'/'unknown'），缺失时为 'unknown'，不伪造为 'open'
 *   - createdAt: 创建时间，允许为 null
 *   - comments : 评论数，缺失兜底 0
 *   - body     : 正文，缺失兜底 ''
 *
 * @typedef {Object} IssueSummary
 * @property {string|number} id
 * @property {number} number
 * @property {string} title
 * @property {string} repo
 * @property {{name:string, color?:string}[]} labels
 * @property {string} url
 * @property {'open'|'closed'|'unknown'} state
 * @property {string|null} createdAt
 * @property {number} comments
 * @property {string} body
 */

/**
 * CodeResult — 代码搜索结果统一模型
 *
 * 字段语义：
 *   - id       : 稳定可复现的唯一标识，规则固定为 `${repo}/${path}`
 *   - repo     : 所属仓库 owner/repo
 *   - path     : 文件路径
 *   - url      : html_url
 *   - name     : 文件名（兼容字段，部分下游会读）
 *   - language : 语言（兼容字段，部分下游会读）
 *
 * @typedef {Object} CodeResult
 * @property {string} id
 * @property {string} repo
 * @property {string} path
 * @property {string} url
 * @property {string} [name]
 * @property {string} [language]
 */

/**
 * SearchEnvelope — 搜索类函数统一返回信封
 *
 * @typedef {Object} SearchEnvelope
 * @property {number} totalCount
 * @property {string} [searchQuery]
 * @property {Array} items
 */

/* ============================================================
 * Normalizer 函数
 * ========================================================== */

/**
 * 将 GitHub Search API 的 repo 原始 item 归一化为 RepoSummary
 * @param {object} item - octokit search.repos 返回的原始 item
 * @returns {RepoSummary}
 */
export function normalizeRepoSummary(item) {
  const fullName = item.full_name || ''
  return {
    // 主字段
    id: fullName,                  // 主键统一为完整坐标，不混用 API 数字 id
    name: extractRepoName(fullName) || item.name || '',
    fullName,
    apiId: item.id ?? undefined,   // 附加字段：GitHub 原生数字 id，缓存路径无此字段
    desc: item.description ?? null,
    stars: item.stargazers_count ?? null,
    forks: item.forks_count ?? null,
    openIssues: item.open_issues_count ?? null,
    language: item.language ?? null,
    url: item.html_url || '',
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 5) : [],
    updatedAt: item.updated_at ?? item.pushed_at ?? null,
    archived: !!item.archived,
  }
}

/**
 * 将缓存 entry（getRepoInfoCached / batchGetRepoInfos 产出）归一化为 RepoSummary
 * 缓存 entry 字段不完整，缺失字段用 null/0 兜底，绝不伪造错误数据。
 * @param {object} entry - 缓存 entry
 * @param {string} [fallbackKey] - 当 entry 缺 name 时用 "owner/repo" 兜底
 * @returns {RepoSummary}
 */
export function normalizeRepoSummaryFromCache(entry, fallbackKey = '') {
  const fullName = entry.fullName || entry.name || fallbackKey || ''
  return {
    id: fullName,                  // 主键统一为完整坐标
    name: extractRepoName(fullName) || '',
    fullName,
    // 读取层保留旧缓存兼容：旧 entry 可能只有 description/pushedAt 无 desc/updatedAt
    desc: entry.desc ?? entry.description ?? null,
    stars: entry.stars ?? null,
    forks: entry.forks ?? null,
    openIssues: entry.openIssues ?? null,
    language: entry.language ?? null,
    url: entry.url || (fullName ? `https://github.com/${fullName}` : ''),
    topics: Array.isArray(entry.topics) ? entry.topics.slice(0, 5) : [],
    updatedAt: entry.updatedAt ?? entry.pushedAt ?? null,
    archived: !!entry.archived,
  }
}

/**
 * 将 REST repos.get 的响应归一化为缓存 entry
 * 替代 getRepoInfoCached 内联拼装，统一字段语义（占位值用 null，不用 0）。
 * 仅写主字段，兼容字段已删除（旧缓存由 normalizeRepoSummaryFromCache 读取层兜底）。
 *
 * @param {object} data - octokit rest.repos.get 返回的 data
 * @param {string} fallbackKey - "owner/repo"（data.full_name 缺失时兜底）
 * @returns {RepoCacheEntry}
 */
export function normalizeRepoEntryFromREST(data, fallbackKey = '') {
  const fullName = data.full_name || fallbackKey
  return {
    // 主字段
    name: fullName,
    fullName,
    desc: data.description ?? null,
    stars: data.stargazers_count ?? null,
    forks: data.forks_count ?? null,
    openIssues: data.open_issues_count ?? null,
    language: data.language ?? null,
    url: data.html_url || '',
    topics: Array.isArray(data.topics) ? data.topics.slice(0, 5) : [],
    updatedAt: data.updated_at ?? data.pushed_at ?? null,
    archived: !!data.archived,
    _ts: Date.now(),
  }
}

/**
 * 将 GraphQL repository 响应归一化为缓存 entry
 * 替代 batchGetRepoInfos 内联拼装，统一字段语义。
 * 仅写主字段，兼容字段已删除。
 *
 * @param {object} info - GraphQL repository 节点
 * @param {string} repo - "owner/repo"
 * @returns {RepoCacheEntry}
 */
export function normalizeRepoEntryFromGraphQL(info, repo) {
  const topics = Array.isArray(info.repositoryTopics?.nodes)
    ? info.repositoryTopics.nodes.map(n => n?.topic?.name).filter(Boolean).slice(0, 5)
    : []
  return {
    // 主字段
    name: repo,
    fullName: repo,
    desc: info.description ?? null,
    stars: info.stargazerCount ?? null,
    forks: info.forkCount ?? null,
    openIssues: info.issues?.totalCount ?? null,
    language: info.primaryLanguage?.name ?? null,
    url: info.url || '',
    topics,
    updatedAt: info.updatedAt ?? info.pushedAt ?? null,
    archived: !!info.isArchived,
    _ts: Date.now(),
  }
}

/**
 * 将 GitHub Search API 的 issue 原始 item 归一化为 IssueSummary
 * @param {object} item - octokit search.issuesAndPullRequests 返回的原始 item
 * @returns {IssueSummary}
 */
export function normalizeIssueSummary(item) {
  const repo = item.repository_url
    ? item.repository_url.replace('https://api.github.com/repos/', '')
    : (item.repo || '')
  return {
    id: item.id ?? item.number ?? '',
    number: item.number ?? 0,
    title: item.title || '',
    repo,
    labels: normalizeLabels(item.labels),
    url: item.html_url || '',
    state: item.state || 'unknown',
    createdAt: item.created_at ?? null,
    comments: item.comments ?? 0,
    body: item.body || '',
  }
}

/**
 * 将 issues.listForRepo 的原始 issue 归一化为 IssueSummary
 * @param {object} i - octokit issues.listForRepo 返回的原始 item
 * @param {string} repoFullName - 所属仓库 owner/repo
 * @returns {IssueSummary}
 */
export function normalizeIssueSummaryFromRepoIssue(i, repoFullName) {
  return {
    id: i.id ?? i.number ?? '',
    number: i.number ?? 0,
    title: i.title || '',
    repo: repoFullName || '',
    labels: normalizeLabels(i.labels),
    url: i.html_url || '',
    state: i.state || 'unknown',
    createdAt: i.created_at ?? null,
    comments: i.comments ?? 0,
    body: i.body || '',
  }
}

/**
 * 将 GitHub Search API 的 code 原始 item 归一化为 CodeResult
 * id 规则固定为 `${repo}/${path}`，保证稳定可复现、可去重。
 * @param {object} item - octokit search.code 返回的原始 item
 * @returns {CodeResult}
 */
export function normalizeCodeResult(item) {
  const repo = item.repository?.full_name || ''
  const path = item.path || ''
  return {
    id: `${repo}/${path}`,
    repo,
    path,
    url: item.html_url || '',
    name: item.name || '',
    language: item.repository?.language ?? null,
  }
}

/**
 * 构造统一搜索信封
 * @template T
 * @param {T[]} items
 * @param {{totalCount?: number, searchQuery?: string}} [meta]
 * @returns {SearchEnvelope & {items: T[]}}
 */
export function makeSearchEnvelope(items, meta = {}) {
  return {
    totalCount: meta.totalCount ?? items.length,
    searchQuery: meta.searchQuery,
    items,
  }
}

/* ============================================================
 * 内部工具
 * ========================================================== */

/**
 * 从 owner/repo 完整坐标中拆出纯仓库名
 *   'facebook/react' → 'react'
 *   'react'          → 'react'
 *   ''               → ''
 * @param {string} fullName
 * @returns {string}
 */
export function extractRepoName(fullName) {
  if (!fullName) return ''
  const idx = fullName.lastIndexOf('/')
  return idx >= 0 ? fullName.slice(idx + 1) : fullName
}

/**
 * 统一 labels 为对象数组形态
 * 输入可能是：[{name,color}] / [{name}] / ['string'] / null
 * @param {unknown} labels
 * @returns {{name:string, color?:string}[]}
 */
function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return []
  return labels.map(l => {
    if (typeof l === 'string') return { name: l }
    return { name: l?.name || '', color: l?.color }
  })
}

/* ============================================================
 * 兼容字段说明
 * ==========================================================
 *
 * 主字段语义（已固定，禁止漂移）：
 *   - RepoSummary.id   : 统一为 owner/repo 完整坐标，不混用 API 数字 id
 *   - RepoSummary.name : 纯仓库名（不含 owner）
 *   - RepoSummary.fullName : owner/repo 完整坐标
 *   - RepoSummary.apiId : GitHub 原生数字 id（附加字段，仅 API 路径有值）
 *   - IssueSummary.state : 'open' | 'closed' | 'unknown'，缺失时为 'unknown'
 *
 * 兼容字段状态：已全部删除（Step 8）
 *
 * 旧缓存兼容（仅 normalizer 读取层保留兜底，新写入只写主字段）：
 *   - normalizeRepoSummaryFromCache: entry.desc ?? entry.description
 *                                   entry.updatedAt ?? entry.pushedAt
 *   - assessLiveness (issueEnrich.js): info.updatedAt ?? info.pushedAt
 *   - isRepoBlocked (contentFilter.js): repo.fullName || repo.full_name
 *
 * 历史兼容字段（已删除，不再双写）：
 *   - full_name    : 已删除（SocialPage/AnalysisPage 改读 fullName，getAnalysisData 新增 fullName）
 *   - description  : 已删除（SocialPage 改读 desc）
 *   - pushedAt     : 已删除（issueEnrich/normalizer 读取层兜底）
 *   - owner        : 已删除（contentFilter 改用 fullName.split('/')[0]）
 *   - user         : 已删除（Step 5 删除，ContributionPage 无依赖）
 */
