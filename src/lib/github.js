import { Octokit } from 'octokit'
import {
  parseRepoCoordinates,
  parseGitHubInput,
  extractOwnerRepo,
} from './githubUrl.js'
import {
  normalizeRepoSummary,
  normalizeIssueSummary,
  normalizeIssueSummaryFromRepoIssue,
  normalizeCodeResult,
  makeSearchEnvelope,
  extractRepoName,
} from './githubSchema.js'

let octokitInstance = null
let currentConfig = { token: '', proxy: '', timeout: 20000 }

/**
 * 获取 baseUrl
 * 统一走 /api/gh：开发环境 Vite proxy → 本地 Clash，生产环境 Vercel edge rewrite → api.github.com
 * 用户可在设置中覆盖为自定义代理（如 ghproxy.com 等 CORS 代理）
 */
function resolveBaseUrl(proxy) {
  if (proxy) return proxy.replace(/\/$/, '')
  return '/api/gh'
}

/**
 * 初始化 GitHub 客户端
 * @param {object} opts - { token, proxy, timeout }
 */
export function initGitHub(opts = {}) {
  currentConfig = { ...currentConfig, ...opts }
  const baseUrl = resolveBaseUrl(currentConfig.proxy)

  octokitInstance = new Octokit({
    auth: currentConfig.token || undefined,
    baseUrl,
    request: { timeout: currentConfig.timeout },
  })
  // Token 更新后重置 401 警告标记
  resetTokenWarning()
  return octokitInstance
}

/** 从本地存储恢复配置并初始化 */
export async function initGitHubFromStorage(getSettingFn) {
  const [token, proxy, timeout] = await Promise.all([
    getSettingFn('github_token', ''),
    getSettingFn('github_proxy', ''),
    getSettingFn('github_timeout', 20000),
  ])
  initGitHub({ token, proxy, timeout })
}

/** 获取 Octokit 实例（未初始化时用默认配置） */
export function getOctokit() {
  if (!octokitInstance) initGitHub()
  return octokitInstance
}

/** 获取当前配置（供设置面板回显） */
export function getGitHubConfig() {
  return { ...currentConfig }
}

/** 测试连接（带超时，返回延迟 ms 或错误信息） */
export async function testConnection() {
  const start = Date.now()
  try {
    const octokit = getOctokit()
    await octokit.rest.rateLimit.get()
    return Date.now() - start
  } catch (e) {
    if (e?.status === 401) {
      throw new Error('Token 无效，请重新生成 GitHub Token')
    }
    if (e?.message?.includes('Bad credentials')) {
      throw new Error('Token 无效，请重新生成 GitHub Token')
    }
    throw new Error(e.message || '连接失败')
  }
}

/** 解析 owner/repo 或完整 URL，支持 /pulls /issues 后缀自动归并 */
export function parseRepoUrl(url) {
  return parseRepoCoordinates(url)
}

/** 解析 GitHub URL（仓库/组织/用户） */
export function parseGitHubUrl(input) {
  return parseGitHubInput(input)
}

/** 解析 owner/repo 坐标 */
export function parseGithubRepoCoordinates(url) {
  return extractOwnerRepo(url)
}

/** safeGithub：带超时的 GitHub API 调用包装（与 Octokit timeout 对齐为 20s） */
const SAFE_TIMEOUT = 20000
let _badTokenWarned = false
export async function safeGithub(fn, fallback = null) {
  try {
    return await Promise.race([
      typeof fn === 'function' ? fn() : fn,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SAFE_TIMEOUT)),
    ])
  } catch (e) {
    // 401 表示 Token 无效，只警告一次，避免刷屏
    if (e?.status === 401 && !_badTokenWarned) {
      _badTokenWarned = true
      console.warn('[GitHub] Token 无效（401 Bad credentials），请在设置中更新 Token')
    }
    return fallback
  }
}

/** 重置 Token 警告标记（Token 更新后调用） */
export function resetTokenWarning() {
  _badTokenWarned = false
}

/** 搜索指定组织/用户的仓库 */
export async function searchReposByOrg(owner, options = {}) {
  const octokit = getOctokit()
  const q = [`org:${owner}`]
  if (options.language) q.push(`language:${options.language}`)
  if (options.stars) q.push(`stars:>=${options.stars}`)
  const { data } = await octokit.rest.search.repos({
    q: q.join(' '),
    sort: 'stars',
    order: 'desc',
    per_page: options.perPage || 10,
  })
  return data.items.map(normalizeRepoSummary)
}

/* ===== 聚合搜索 ===== */

/** 拉取一页 GitHub Issue，返回构造后的 searchQuery 供 UI 展示 */
export async function fetchIssuesPage(query, options = {}, page = 1) {
  const octokit = getOctokit()
  const fetchSize = Math.min(options.fetchSize || 100, 100)
  const labels = options.labels
    ? (Array.isArray(options.labels) ? options.labels : [options.labels])
    : []
  const q = [
    query,
    'is:issue',
    'is:open',
    ...labels.map(l => `label:"${l}"`),
    options.language ? `language:${options.language}` : '',
  ].filter(Boolean).join(' ')

  // 不传 sort/order → GitHub best-match（按相关度排序，而非按时间）
  const params = {
    q,
    per_page: fetchSize,
    page,
  }
  if (options.sort) {
    params.sort = options.sort
    params.order = options.order || 'desc'
  }
  const { data } = await octokit.rest.search.issuesAndPullRequests(params)
  return makeSearchEnvelope(
    data.items.map(normalizeIssueSummary),
    { totalCount: data.total_count, searchQuery: q }
  )
}

/** 搜索 Issue（向后兼容，调用 fetchIssuesPage） */
export async function searchIssues(query, options = {}) {
  return fetchIssuesPage(query, options, options.page || 1)
}

/**
 * 搜索新手友好 Issue（限定中型仓库 50~5000 星，避免推荐超大仓库）
 * @param {string} language - 编程语言（空字符串则不限制）
 * @param {number} limit - 返回数量上限
 */
export async function searchBeginnerIssues(language, limit = 3) {
  const octokit = getOctokit()
  const q = [
    'label:"good first issue"',
    'state:open',
    language ? `language:${language}` : '',
    'stars:50..5000',  // 中型仓库：过滤超大仓库和无人问津的小仓库
  ].filter(Boolean).join(' ')
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q, sort: 'created', order: 'desc', per_page: limit * 2
  })
  return data.items
    .filter(i => i.pull_request === undefined)  // 只要 issue 不要 PR
    .slice(0, limit)
    .map(normalizeIssueSummary)
}

/**
 * 搜索仓库（best-match 排序，返回原始 API 结果）
 * 返回 { totalCount, searchQuery, items }，与 fetchIssuesPage 格式统一。
 * rerank 由调用方（rankResults / RepoFetcher）负责，避免双重排序。
 */
export async function searchRepositories(query, options = {}, page = 1) {
  const octokit = getOctokit()
  const fetchSize = Math.min(options.fetchSize || 100, 100)
  // 构建 stars 过滤条件：支持 minStars / maxStars / 区间
  let starsFilter = ''
  if (options.minStars != null && options.maxStars != null) {
    starsFilter = `stars:${options.minStars}..${options.maxStars}`
  } else if (options.maxStars != null) {
    starsFilter = `stars:<=${options.maxStars}`
  } else if (options.minStars != null && options.minStars > 0) {
    starsFilter = `stars:>=${options.minStars}`
  }
  // 创建时间 / 更新时间过滤
  const createdFilter = options.createdAfter ? `created:>=${options.createdAfter}` : ''
  const updatedFilter = options.updatedAfter ? `pushed:>=${options.updatedAfter}` : ''
  const q = [
    query,
    options.language ? `language:${options.language}` : '',
    starsFilter,
    createdFilter,
    updatedFilter,
  ].filter(Boolean).join(' ')

  const sortOpt = options.sort === 'stars' ? { sort: 'stars', order: 'desc' }
    : options.sort === 'updated' ? { sort: 'updated', order: 'desc' }
    : {}
  const { data } = await octokit.rest.search.repos({
    q,
    per_page: fetchSize,
    page,
    ...sortOpt,
  })
  return makeSearchEnvelope(
    data.items.map(normalizeRepoSummary),
    { totalCount: data.total_count, searchQuery: q }
  )
}

/**
 * 搜索代码（best-match 排序，返回原始 API 结果）
 * 返回 { totalCount, searchQuery, items }，与 searchRepositories 格式统一。
 */
export async function searchCode(query, options = {}, page = 1) {
  const octokit = getOctokit()
  const fetchSize = Math.min(options.fetchSize || 30, 100)
  const q = [query, options.language ? `language:${options.language}` : ''].filter(Boolean).join(' ')
  const { data } = await octokit.rest.search.code({
    q,
    per_page: fetchSize,
    page,
    // 不传 sort/order → GitHub best-match
  })
  return makeSearchEnvelope(
    data.items.map(normalizeCodeResult),
    { totalCount: data.total_count, searchQuery: q }
  )
}

/* ===== Layer A: 持久仓库缓存 + repo 数据 service =====
 *
 * 缓存层与 repo 数据 service 已拆分到独立模块：
 *   - repoCache.js     : Layer A 缓存存取 / TTL / Dexie 持久化 / hydrate
 *   - repoService.js   : 统一 repo 数据 service（缓存优先 → API → normalize）
 *
 * 此处 re-export 保持对外 API 兼容，旧调用方无需改动。
 */
export {
  getRepoInfoCached,
  batchGetRepoInfos,
  getRepoInfo,
} from './repoService.js'
export { hydrateRepoCache as hydrateRepoCacheFromStorage } from './repoCache.js'

/* ===== 仓库分析 ===== */

/** 分析数据独立缓存（5 分钟 TTL，不混用 repoInfoCache） */
const ANALYSIS_CACHE_TTL = 5 * 60 * 1000
const analysisCache = new Map()

function getAnalysisCached(owner, repo) {
  const entry = analysisCache.get(`${owner}/${repo}`)
  if (!entry) return null
  if (Date.now() - entry.time > ANALYSIS_CACHE_TTL) { analysisCache.delete(`${owner}/${repo}`); return null }
  return entry.value
}

function setAnalysisCached(owner, repo, value) {
  analysisCache.set(`${owner}/${repo}`, { value, time: Date.now() })
}

/**
 * 一次性获取分析所需的全部数据（合并请求，减少 API 调用）
 */
export async function getAnalysisData(owner, repo) {
  const cached = getAnalysisCached(owner, repo)
  if (cached) return cached

  const octokit = getOctokit()

  // 并发：所有 API 调用均通过 safeGithub 保护
  const [
    infoR, lastCommitR, gfiR, hwR, prR, openPrR,
    contributorsR, releasesR, contributingR, readmeR, langR, communityR, commitsR,
    branchR, recentIssuesR,
  ] = await Promise.allSettled([
    // repos.get 是必须的 — 不套 safeGithub，让真实错误（404 / timeout）能传到 allSettled.reason
    Promise.race([
      octokit.rest.repos.get({ owner, repo }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
    ]),
    safeGithub(octokit.rest.repos.listCommits({ owner, repo, per_page: 1 })),
    // good first issue: 用 REST API 替代 Search API（更快，不占 Search 配额）
    safeGithub(octokit.rest.issues.listForRepo({ owner, repo, labels: 'good first issue', state: 'open', per_page: 100 })),
    // help wanted: 同上
    safeGithub(octokit.rest.issues.listForRepo({ owner, repo, labels: 'help wanted', state: 'open', per_page: 100 })),
    safeGithub(octokit.rest.pulls.list({ owner, repo, state: 'closed', sort: 'updated', direction: 'desc', per_page: 30 })),
    safeGithub(octokit.rest.pulls.list({ owner, repo, state: 'open', per_page: 1 })),
    safeGithub(octokit.rest.repos.listContributors({ owner, repo, per_page: 1 })),
    safeGithub(octokit.rest.repos.listReleases({ owner, repo, per_page: 1 })),
    safeGithub(octokit.rest.repos.getContent({ owner, repo, path: 'CONTRIBUTING.md' })),
    safeGithub(octokit.rest.repos.getContent({ owner, repo, path: 'README.md' })),
    safeGithub(octokit.rest.repos.listLanguages({ owner, repo })),
    safeGithub(octokit.rest.repos.getCommunityProfileMetrics({ owner, repo })),
    safeGithub(getCommitActivity(owner, repo, 30)),
    safeGithub(octokit.rest.repos.listBranches({ owner, repo, per_page: 1 })),
    safeGithub(octokit.rest.issues.listForRepo({ owner, repo, state: 'closed', sort: 'updated', direction: 'desc', per_page: 30 })),
  ])

  // repos.get 是必须的 — 失败则无法继续分析
  const data = infoR.status === 'fulfilled' ? infoR.value?.data : null
  if (!data) {
    const reason = infoR.status === 'rejected' ? infoR.reason : null
    if (reason?.status === 404) {
      throw new Error('仓库不存在（404），请确认地址正确')
    }
    if (reason?.message?.includes('timeout') || infoR.value === null) {
      throw new Error('获取仓库信息超时，请检查代理/网络后重试')
    }
    throw new Error('仓库不存在或无法访问，请确认地址正确，或稍后重试')
  }

  const lastCommit = lastCommitR.status === 'fulfilled' && lastCommitR.value?.data?.[0]?.commit?.author?.date || null
  const lastCommitAt = lastCommit
  const daysSinceLastCommit = lastCommit
    ? Math.floor((Date.now() - new Date(lastCommit).getTime()) / (24 * 60 * 60 * 1000))
    : null

  const pushedAt = data.pushed_at
  const lastPushAt = pushedAt
  const daysSincePush = pushedAt
    ? Math.floor((Date.now() - new Date(pushedAt).getTime()) / (24 * 60 * 60 * 1000))
    : null

  const updatedAt = data.updated_at
  const lastUpdatedAt = updatedAt
  const daysSinceUpdated = updatedAt
    ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / (24 * 60 * 60 * 1000))
    : null

  // 社区活动时间：recentIssuesR + recentPrR 中 max(updated_at)
  let lastCommunityAt = null
  const communityCandidates = []
  if (recentIssuesR.status === 'fulfilled' && recentIssuesR.value?.data?.length) {
    recentIssuesR.value.data.forEach(i => {
      if (i.updated_at) communityCandidates.push(i.updated_at)
    })
  }
  if (prR.status === 'fulfilled' && prR.value?.data?.length) {
    prR.value.data.forEach(pr => {
      if (pr.updated_at) communityCandidates.push(pr.updated_at)
    })
  }
  if (communityCandidates.length) {
    lastCommunityAt = communityCandidates.reduce((max, cur) =>
      new Date(cur) > new Date(max) ? cur : max
    )
  }
  const daysSinceCommunity = lastCommunityAt
    ? Math.floor((Date.now() - new Date(lastCommunityAt).getTime()) / (24 * 60 * 60 * 1000))
    : null

  const createdAt = data.created_at
  const repoAgeDays = createdAt
    ? Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000))
    : null

  // PR 平均处理时间（仅 merged PR）
  let prDays = null
  let mergedPRCount = 0
  let closedPRCount = 0
  if (prR.status === 'fulfilled' && prR.value?.data) {
    closedPRCount = prR.value.data.length
    const merged = prR.value.data.filter(pr => pr.merged_at)
    mergedPRCount = merged.length
    if (merged.length) {
      prDays = Math.round(merged.reduce((sum, pr) => {
        return sum + (new Date(pr.merged_at) - new Date(pr.created_at)) / (24 * 60 * 60 * 1000)
      }, 0) / merged.length * 10) / 10
    }
  }

  // PR merge rate
  const prMergeRate = closedPRCount > 0 ? Math.round((mergedPRCount / closedPRCount) * 100) : null

  // 开放 PR 数（从 link header 提取）
  let openPRCount = 0
  if (openPrR.status === 'fulfilled' && openPrR.value?.data) {
    const link = openPrR.value.headers?.link || ''
    const lastMatch = link.match(/page=(\d+)>; rel="last"/)
    openPRCount = lastMatch ? parseInt(lastMatch[1]) : openPrR.value.data.length
  }

  // 真实 open issue 数（不含 PR）：repos.get 返回 open_issues_count 含 PR，减去 openPRCount
  let trueOpenIssueCount = Math.max(0, data.open_issues_count - openPRCount)

  // contributors 数（从 link header 提取）
  let contributorCount = 0
  if (contributorsR.status === 'fulfilled' && contributorsR.value?.data) {
    const link = contributorsR.value.headers?.link || ''
    const lastMatch = link.match(/page=(\d+)>; rel="last"/)
    contributorCount = lastMatch ? parseInt(lastMatch[1]) : (Array.isArray(contributorsR.value.data) ? contributorsR.value.data.length : 0)
  }

  const hasReleases = releasesR.status === 'fulfilled' && releasesR.value?.data?.length > 0
  const latestRelease = hasReleases ? (releasesR.value.data[0]?.tag_name || null) : null
  const latestReleaseDate = hasReleases ? (releasesR.value.data[0]?.published_at || null) : null

  let branchCount = 0
  if (branchR.status === 'fulfilled' && branchR.value?.data) {
    const link = branchR.value.headers?.link || ''
    const lastMatch = link.match(/page=(\d+)>; rel="last"/)
    branchCount = lastMatch ? parseInt(lastMatch[1]) : branchR.value.data.length
  }

  let issueCloseDays = null
  if (recentIssuesR.status === 'fulfilled' && recentIssuesR.value?.data?.length) {
    const closedIssues = recentIssuesR.value.data.filter(i => !i.pull_request && i.closed_at)
    if (closedIssues.length) {
      const days = closedIssues.map(i =>
        (new Date(i.closed_at) - new Date(i.created_at)) / (24 * 60 * 60 * 1000)
      ).sort((a, b) => a - b)
      const mid = Math.floor(days.length / 2)
      issueCloseDays = Math.round((days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2) * 10) / 10
    }
  }

  let prProcessDays = null
  if (prR.status === 'fulfilled' && prR.value?.data?.length) {
    const merged = prR.value.data.filter(pr => pr.merged_at)
    if (merged.length) {
      const days = merged.map(pr =>
        (new Date(pr.merged_at) - new Date(pr.created_at)) / (24 * 60 * 60 * 1000)
      ).sort((a, b) => a - b)
      const mid = Math.floor(days.length / 2)
      prProcessDays = Math.round((days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2) * 10) / 10
    }
  }

  let languages = {}
  if (langR.status === 'fulfilled' && langR.value?.data) {
    languages = langR.value.data
  }

  let community = null
  if (communityR.status === 'fulfilled' && communityR.value?.data) {
    community = {
      healthPercentage: communityR.value.data.health_percentage,
      hasCodeOfConduct: !!communityR.value.data.code_of_conduct_file,
      hasLicense: !!communityR.value.data.license,
      hasContributing: !!communityR.value.data.contributing_file,
      hasReadme: !!communityR.value.data.readme_file,
      hasIssueTemplate: !!communityR.value.data.issue_template_file,
      hasPullRequestTemplate: !!communityR.value.data.pull_request_template_file,
    }
  }

  const commits30d = commitsR.status === 'fulfilled' ? commitsR.value : 0

  const result = {
    info: {
      name: data.name || extractRepoName(data.full_name),
      fullName: data.full_name,
      desc: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      watchers: data.subscribers_count,
      networkCount: data.network_count,
      openIssues: data.open_issues_count,
      trueOpenIssues: trueOpenIssueCount,
      language: data.language,
      license: data.license?.name || '无',
      licenseKey: data.license?.key || null,
      homepage: data.homepage,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      pushedAt: data.pushed_at,
      archived: data.archived,
      disabled: data.disabled,
      isFork: data.fork,
      isTemplate: data.template,
      allowForking: data.allow_forking,
      hasIssues: data.has_issues,
      hasWiki: data.has_wiki,
      hasPages: data.has_pages,
      hasProjects: data.has_projects,
      hasDiscussions: data.has_discussions,
      size: data.size,
      url: data.html_url,
      defaultBranch: data.default_branch,
      topics: data.topics?.slice(0, 10) || [],
      parent: data.parent ? { name: data.parent.full_name, url: data.parent.html_url } : null,
    },
    daysSinceLastCommit,
    daysSincePush,
    daysSinceUpdated,
    daysSinceCommunity,
    lastCommitAt,
    lastPushAt,
    lastUpdatedAt,
    lastCommunityAt,
    repoAgeDays,
    gfiCount: gfiR.status === 'fulfilled' ? (Array.isArray(gfiR.value?.data) ? gfiR.value.data.length : 0) : 0,
    helpWantedCount: hwR.status === 'fulfilled' ? (Array.isArray(hwR.value?.data) ? hwR.value.data.length : 0) : 0,
    hasContributing: contributingR.status === 'fulfilled',
    hasReadme: readmeR.status === 'fulfilled',
    prDays: prProcessDays !== null ? prProcessDays : prDays,
    prMergeRate,
    openPRCount,
    contributorCount,
    branchCount,
    hasReleases,
    latestRelease,
    latestReleaseDate,
    totalReleaseCount: hasReleases ? 1 : 0,
    issueCloseDays,
    languages,
    community,
    commits30d,
  }

  setAnalysisCached(owner, repo, result)
  return result
}

/** 获取最近 N 天的 commit 数（活跃度指标） */
async function getCommitActivity(owner, repo, days = 30) {
  const octokit = getOctokit()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  try {
    const { data } = await octokit.rest.repos.listCommits({
      owner, repo, since, per_page: 100,
    })
    return data.length
  } catch (err) {
    console.warn('[github] countCommitsSince 失败:', err.message)
    return 0
  }
}

/* ===== 贡献助手 ===== */

/** Fork 仓库（60s 超时） */
export async function forkRepo(owner, repo) {
  const octokit = getOctokit()
  const { data } = await octokit.rest.repos.createFork({
    owner, repo,
    request: { timeout: 60000 },
  })
  const login = data.owner?.login || owner
  return {
    name: data.full_name,
    url: data.html_url,
    cloneUrl: `https://github.com/${data.full_name}.git`,
    sshUrl: `git@github.com:${data.full_name}.git`,
    defaultBranch: data.default_branch,
    forkOwner: login,
    upstream: { owner, repo },
  }
}

/** 获取上游仓库的 Open Issues */
export async function getUpstreamIssues(owner, repo, opts = {}) {
  const octokit = getOctokit()
  const { data } = await octokit.rest.issues.listForRepo({
    owner, repo,
    state: 'open',
    labels: opts.labels || undefined,
    per_page: opts.perPage || 20,
    sort: opts.sort || 'created',
    direction: opts.direction || 'desc',
  })
  return data.filter(i => !i.pull_request).map(i => normalizeIssueSummaryFromRepoIssue(i, `${owner}/${repo}`))
}

/** 获取单个 Issue 详情 */
export async function getIssueDetail(owner, repo, issueNumber) {
  const octokit = getOctokit()
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber })
  return normalizeIssueSummaryFromRepoIssue(data, `${owner}/${repo}`)
}

/** 获取当前用户信息 */
export async function getCurrentUser() {
  const octokit = getOctokit()
  const { data } = await octokit.rest.users.getAuthenticated()
  return { login: data.login, avatar: data.avatar_url }
}

/* ===== 成长中心 ===== */

/**
 * 推荐适合新手的仓库（按语言筛选）
 * 策略：stars 50~5000 的中型项目（太大竞争激烈，太小可能已废弃），
 * 按更新时间排序（最近活跃的优先），最近半年内有更新。
 */
export async function recommendBeginnerRepos(language = '') {
  const octokit = getOctokit()
  // 动态计算半年前的日期，避免硬编码过期
  const halfYearAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const q = [
    'good-first-issues:>0',
    language ? `language:${language}` : '',
    'stars:50..5000',       // 中型项目：50~5000 星，过滤超大仓库和无人问津的小仓库
    `pushed:>=${halfYearAgo}`, // 最近半年内有更新（避免废弃项目）
  ].filter(Boolean).join(' ')

  const { data } = await octokit.rest.search.repos({
    q,
    sort: 'updated',        // 按更新时间排序（最近活跃的优先）
    order: 'desc',
    per_page: 6,
  })
  return data.items.map(normalizeRepoSummary)
}

/** 获取全局统计（新手友好 Issue 数、仓库数） */
// 独立缓存（不混用 repoInfoCache，避免非 repo 数据污染仓库缓存）
const GLOBAL_STATS_CACHE = new Map()
const GLOBAL_STATS_TTL = 60 * 60 * 1000
export async function getGlobalStats() {
  const cached = GLOBAL_STATS_CACHE.get('stats')
  if (cached && Date.now() - cached._ts < GLOBAL_STATS_TTL) {
    return cached.data
  }

  const octokit = getOctokit()
  const [gfiRepos, gfiIssues, hwIssues] = await Promise.allSettled([
    octokit.rest.search.repos({ q: 'good-first-issues:>0', per_page: 1 }),
    octokit.rest.search.issuesAndPullRequests({ q: 'is:issue is:open label:"good first issue"', per_page: 1 }),
    octokit.rest.search.issuesAndPullRequests({ q: 'is:issue is:open label:"help wanted"', per_page: 1 }),
  ])
  const data = {
    beginnerRepos: gfiRepos.status === 'fulfilled' ? gfiRepos.value.data.total_count : null,
    goodFirstIssues: gfiIssues.status === 'fulfilled' ? gfiIssues.value.data.total_count : null,
    helpWantedIssues: hwIssues.status === 'fulfilled' ? hwIssues.value.data.total_count : null,
  }
  GLOBAL_STATS_CACHE.set('stats', { data, _ts: Date.now() })
  return data
}

/* ===== README 翻译 ===== */

/** 获取仓库 README 原始内容（自动检测 README 文件名） */
export async function fetchReadmeContent(owner, repo) {
  const octokit = getOctokit()
  try {
    const { data } = await octokit.rest.repos.getReadme({ owner, repo })
    // content 是 base64 编码
    const content = atob(data.content.replace(/\n/g, ''))
    return { content, name: data.name, size: data.size }
  } catch (err) {
    if (err.status === 404) {
      throw new Error('该仓库没有 README 文件')
    }
    throw err
  }
}