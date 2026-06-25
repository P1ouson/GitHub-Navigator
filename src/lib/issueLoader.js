/**
 * Issue 加载管线（三层缓存集成 + 自动补池）
 *
 * Layer A — 持久仓库缓存（repoCache.js，30 分钟 TTL，Dexie 持久化）
 * Layer B — 会话仓库缓存（SessionRepoCache，单次搜索会话，存储 info+health，缓存命中直接读）
 * Layer C — Issue 内存池（SearchPool，累积翻页结果，去重追加；与 RepoFetcher 共用同一池类）
 *
 * Core flow（三步解耦）:
 *   1. 取数：fetchIssuesPage + 噪音/标签过滤
 *   2. 补 repo info：batchGetRepoInfos（Layer A 缓存优先）→ 写入 sessionCache
 *   3. enrich + 降权/过滤：enrichIssues + _livenessPenalty 降权 + filterByStars（纯函数，委托 issueEnrich.js）
 *
 * 处理顺序：噪音 → 标签 → enrich → 活跃度(降权标记,不剔除) → 星数 → beginnerMode
 * 只对过滤后还有 Issue 的仓库调 batchGetRepoInfos 节省 API
 */

import { fetchIssuesPage, batchGetRepoInfos } from './github.js'
import { filterIssues as filterNoise, filterLabeledIssues, filterBeginnerIssues } from './issueFilter.js'
import { enrichIssues, filterByStars, assessLiveness } from './issueEnrich.js'
import { SearchPool } from './searchFetcher.js'

/* ===== Layer B: 会话级仓库缓存（存完整 info+health，30 分钟 TTL）===== */

/** SessionRepoCache TTL：30 分钟，与 Layer A 对齐 */
const SESSION_CACHE_TTL = 30 * 60 * 1000

class SessionRepoCache {
  constructor() {
    this.cache = new Map() // repo → { info: repoCacheEntry|null, health: livenessResult, _ts: number }
  }

  get(repo) {
    const entry = this.cache.get(repo)
    if (!entry) return undefined
    // TTL 检查：过期视为 miss，自动删除
    if (Date.now() - entry._ts > SESSION_CACHE_TTL) {
      this.cache.delete(repo)
      return undefined
    }
    return entry
  }

  set(repo, entry) {
    this.cache.set(repo, { ...entry, _ts: Date.now() })
  }

  has(repo) {
    return this.get(repo) !== undefined
  }

  reset() { this.cache.clear() }
}

/* ===== IssueFetcher 主类 ===== */

export class IssueFetcher {
  constructor() {
    this.sessionCache = new SessionRepoCache()
    this.pool = new SearchPool()
    this._currentQuery = ''
    this._currentOpts = {}
    this._loading = false
    this._lastSearchQuery = '' // 最后一次 GitHub API 的 q 参数
    this._stats = { repoChecked: 0, cachedCount: 0, filteredDead: 0 }
    this._enrichPromise = null // 后台 enrich 的 Promise
    this._enrichGen = 0        // 后台 enrich 的代次（用于取消）
    this._onEnriched = null    // enrich 完成回调
  }

  /** 当前 Issue 总数 */
  get totalCount() { return this.pool.totalCount }
  /** 是否还有更多可加载 */
  get hasMore() { return this.pool.hasMore }
  /** 当前池中 Issue（与 RepoFetcher.items 接口一致，统一分页逻辑用） */
  get items() { return this.pool.items }
  /** 当前池中 Issue（语义别名） */
  get issues() { return this.pool.items }
  /** 当前已拉取页数 */
  get fetchedPages() { return this.pool.fetchedPages }
  /** 统计摘要 */
  get stats() { return this._stats }
  /** 是否正在加载 */
  get loading() { return this._loading }
  /** 最后一次 GitHub API 的 q 参数 */
  get lastSearchQuery() { return this._lastSearchQuery }
  /** 后台 enrich 是否还在进行中 */
  get enriching() { return !!this._enrichPromise }

  /**
   * 首次搜索，自动补池直到满足 targetCount 或用尽页数
   * @param {string} query - 完整搜索查询
   * @param {object} opts - { labels, perPage, language, beginnerMode, minLiveness, targetCount, maxGithubPages, onEnriched }
   *
   * 如果 opts.onEnriched 回调存在，则启用两阶段模式：
   *   Phase 1: GitHub API → 入池 → fetchIssues 立即返回，UI 先展示
   *   Phase 2: 后台 batchGetRepoInfos → enrich → 过滤 → 回调 onEnriched，UI 更新
   */
  async fetchIssues(query, opts = {}) {
    // 取消上一次的后台 enrich
    this._enrichGen++
    this._enrichPromise = null

    // 重置三层缓存（keepSessionCache 时只重置 pool，保留 sessionCache 加速 label 重搜）
    if (!opts.keepSessionCache) {
      this.sessionCache.reset()
    }
    this.pool.reset()
    this._fetchGen = this.pool.gen
    this._currentQuery = query
    this._currentOpts = { ...opts }
    this._loading = true
    this._lastSearchQuery = ''
    this._stats = { repoChecked: 0, cachedCount: 0, filteredDead: 0 }
    this._onEnriched = opts.onEnriched || null

    const targetCount = opts.targetCount || (opts.perPage || 20)
    const maxGithubPages = opts.maxGithubPages || 2
    const perPage = opts.perPage || 30

    try {
      await this._fillPoolUntil({ targetCount, maxGithubPages, perPage, quick: !!this._onEnriched })
    } finally {
      this._loading = false
    }

    // 两阶段模式：启动后台 enrich
    if (this._onEnriched && this.pool.length > 0) {
      const enrichGen = this._enrichGen
      const pageSize = opts.targetCount || opts.perPage || 20
      this._enrichPromise = this._enrichPoolItems()
        .then(async () => {
          if (enrichGen !== this._enrichGen) return
          // Phase 2 enrich 后若池子不足 pageSize，静默补池（不触发 loading 状态）
          await this._silentRefillIfNeeded(pageSize, enrichGen)
          if (enrichGen === this._enrichGen && this._onEnriched) {
            this._onEnriched()
          }
        })
        .catch(() => {
          // enrich 失败不阻塞，UI 已展示快速结果
        })
    }

    return this.pool.length > 0
  }

  /** 等待后台 enrich 完成（用于需要完整数据的场景） */
  async awaitEnrich() {
    if (this._enrichPromise) {
      await this._enrichPromise
      this._enrichPromise = null
    }
  }

  /**
   * 加载更多（翻页）
   * 只拉新页，已缓存的仓库跳过 enrich
   * @param {number} pages - 加载几页数据（默认1）
   */
  async fetchMore(pages = 1) {
    if (!this.pool.hasMore || this._loading) return false
    this._loading = true
    try {
      const opts = this._currentOpts
      const perPage = opts.perPage || 20
      const targetCount = this.pool.length + perPage * pages
      const maxGithubPages = this.pool.fetchedPages + 2 * pages
      await this._fillPoolUntil({ targetCount, maxGithubPages, perPage })
    } finally {
      this._loading = false
    }
    return this.pool.length > 0
  }

  /**
   * 核心：持续拉页补池直到满足 targetCount 或耗尽
   * 即使这一页被过滤光了，只要还有 GitHub 结果就续拉下一页
   *
   * 代次保护：用局部变量 fetchGen 捕获当前 gen，避免被并发的新搜索覆盖 this._fetchGen。
   */
  async _fillPoolUntil({ targetCount, maxGithubPages, perPage, quick = false }) {
    const opts = this._currentOpts
    const minLiveness = opts.minLiveness || 'maintained'
    const fetchGen = this._fetchGen

    while (
      this.pool.length < targetCount &&
      this.pool.fetchedPages < maxGithubPages &&
      this.pool.hasMore
    ) {
      // 被新搜索取代 → 立即停止补池
      if (this.pool.gen !== fetchGen) return
      const added = await this._fetchOneGithubPageAndEnrich(minLiveness, { quick, fetchGen })
      if (this.pool.gen !== fetchGen) return
      if (added === 0 && this.pool.hasMore) {
        // 这一页过滤光了，还有 GitHub 页 → 继续下一页
        continue
      }
    }
  }

  /**
   * 拉取一页 GitHub，三步解耦：取数 → 补 repo info → enrich+过滤+入池
   * @param {string} minLiveness - 最低活跃度要求
   * @param {object} options - { quick: boolean, fetchGen: number }
   *   quick=true: 只做 GitHub API + 基础过滤，不 enrich，直接入池（Phase 1）
   *   quick=false: 完整管线（三步）
   * @returns {number} added 入池条数
   */
  async _fetchOneGithubPageAndEnrich(minLiveness, { quick = false, fetchGen } = {}) {
    const query = this._currentQuery
    const opts = this._currentOpts
    const nextPage = this.pool.fetchedPages + 1
    // fetchGen 缺失时回退到 this._fetchGen（兼容旧调用）
    const gen = fetchGen ?? this._fetchGen

    // === 步骤1：取数 + 基础过滤 ===
    const result = await fetchIssuesPage(query, { ...opts, fetchSize: opts.fetchSize || 100 }, nextPage)
    // 异步等待后再次检查代次 — 可能已被新搜索 reset
    if (this.pool.gen !== gen) return 0
    const rawItems = result.items || []
    this._lastSearchQuery = result.searchQuery || ''
    this.pool.totalCount = result.totalCount || (rawItems.length || 0)
    this.pool.hasMore = rawItems.length >= (opts.fetchSize || 100)

    if (!rawItems?.length) {
      this.pool.fetchedPages = nextPage
      return 0
    }

    // 噪音过滤 → 标签过滤（仅 beginnerMode）
    const noiseless = filterNoise(rawItems)
    const afterLabel = opts.beginnerMode ? filterLabeledIssues(noiseless) : noiseless
    if (!afterLabel.length) {
      this.pool.fetchedPages = nextPage
      return 0
    }

    // 按仓库分组
    const repoMap = new Map() // repoName → issues[]
    for (const issue of afterLabel) {
      const repo = issue.repo
      if (!repo) continue
      if (!repoMap.has(repo)) repoMap.set(repo, [])
      repoMap.get(repo).push(issue)
    }

    // 灌水仓库检测：同一仓库 Issue 过多且正文极短 → 标记为 spam
    const SPAM_MAX_ISSUES_PER_REPO = 10
    const SPAM_MIN_BODY_LENGTH = 20
    const spamRepos = new Set()
    for (const [repo, issues] of repoMap) {
      if (issues.length <= SPAM_MAX_ISSUES_PER_REPO) continue
      const totalBodyLen = issues.reduce((sum, iss) => sum + (iss.body || '').length, 0)
      const avgLen = totalBodyLen / issues.length
      if (avgLen < SPAM_MIN_BODY_LENGTH) {
        spamRepos.add(repo)
      }
    }
    for (const repo of spamRepos) {
      this._stats.filteredDead += repoMap.get(repo).length
      repoMap.delete(repo)
    }

    // ============ Phase 1 快速模式：不入 enrich，直接入池 ============
    if (quick) {
      let added = 0
      for (const [repo, issues] of repoMap) {
        for (const issue of issues) {
          this.pool.append({
            ...issue,
            _source: 'github_api',
            _type: 'issue',
            _enriched: false,
            _repoHealth: null,
          })
          added++
        }
      }
      this.pool.fetchedPages = nextPage
      return added
    }

    // === 步骤2：批量补 repo info（Layer A 缓存优先）===
    const needEnrich = []
    let sessionHitCount = 0
    for (const [repo] of repoMap) {
      if (this.sessionCache.has(repo)) {
        sessionHitCount++
      } else {
        needEnrich.push(repo)
      }
    }
    this._stats.cachedCount += sessionHitCount

    if (needEnrich.length) {
      this._stats.repoChecked += needEnrich.length
      const { map, stats: { cacheHits } } = await batchGetRepoInfos(needEnrich)
      // enrich 是最慢的异步步骤 — 等待后必须再次检查代次
      if (this.pool.gen !== gen) return 0
      this._stats.cachedCount += cacheHits
      // 写入 sessionCache（成功的 + 失败的都存，避免重复调 API）
      for (const [repo, entry] of map) {
        this.sessionCache.set(repo, { info: entry, health: assessLiveness(entry) })
      }
      for (const repo of needEnrich) {
        if (!map.has(repo)) {
          this.sessionCache.set(repo, { info: null, health: { level: 'unknown', days: null } })
        }
      }
    }

    // === 步骤3：enrich + 过滤 + 入池 ===
    const allIssues = []
    for (const [, issues] of repoMap) {
      allIssues.push(...issues)
    }
    const enriched = this._enrichAndFilter(allIssues)
    const added = this.pool.append(enriched)
    this.pool.fetchedPages = nextPage
    return added
  }

  /**
   * 共用 enrich + 降权/过滤逻辑（Phase 2 完整模式与后台 enrich 共用）
   * 从 sessionCache 构造 repoEntries，调纯函数 enrichIssues 附加 _repoHealth。
   *
   * Phase 2 不再按活跃度剔除 issue，而是给不活跃的 issue 打 _livenessPenalty 标记降权，
   * 由 sortIssuesForDisplay 排序时自然下沉（活跃度越低、降权越大，排名越靠后）。
   * 星数与 beginnerMode 仍按用户设定剔除（用户主动选择的硬约束，可剔除）。
   *
   * _livenessPenalty 映射（按 _repoHealth.liveness.level）：
   *   active / maintained → 0    （无降权）
   *   unknown             → 0.1  （轻微降权，API 失败不算坏）
   *   inactive            → 0.3  （降权）
   *   dead                → 1.0  （强降权，但保留）
   *
   * 不入池，由调用方决定入池方式。
   *
   * @param {Array} issues - 待 enrich 的 issues
   * @returns {Array} enrich 并标记降权后的 issues（带 _repoHealth, _livenessPenalty, _enriched:true）
   */
  _enrichAndFilter(issues) {
    const opts = this._currentOpts

    // 从 sessionCache 构造 repoEntries（只含 info 非空的）
    const repoEntries = new Map()
    for (const issue of issues) {
      const repo = issue.repo
      if (!repo || repoEntries.has(repo)) continue
      const sc = this.sessionCache.get(repo)
      if (sc?.info) repoEntries.set(repo, sc.info)
    }

    // enrich（纯函数，entry 缺失时 liveness=unknown）
    const enriched = enrichIssues(issues, repoEntries)

    // 活跃度：不再剔除，按 level 打 _livenessPenalty 降权，由排序自然下沉
    const LIVENESS_PENALTY = {
      active: 0,
      maintained: 0,
      unknown: 0.1,
      inactive: 0.3,
      dead: 1.0,
    }

    // 星数过滤（用户主动设定的硬约束，保留剔除语义；null stars 未知不过滤）
    const beforeFilter = enriched.length
    let passed = filterByStars(enriched, opts.stars || 0, opts.maxStars || 0)
    this._stats.filteredDead += beforeFilter - passed.length

    // beginnerMode 过滤（用户主动选择，保留剔除）
    if (opts.beginnerMode) {
      passed = filterBeginnerIssues(passed)
    }

    // 标记 _livenessPenalty + _enriched + _source/_type
    return passed.map(issue => {
      const level = issue._repoHealth?.liveness?.level
      return {
        ...issue,
        _livenessPenalty: LIVENESS_PENALTY[level] ?? 0.1,
        _source: 'github_api',
        _type: 'issue',
        _enriched: true,
      }
    })
  }

  /**
   * 后台 enrich：遍历池中所有未 enrich 的 item，批量获取仓库健康度，
   * 更新 _repoHealth 并剔除不满足活跃度/星数要求的 item。
   * 完成后回调 _onEnriched 通知 UI 重新渲染。
   */
  async _enrichPoolItems() {
    const opts = this._currentOpts

    // 找出所有未 enrich 的 item
    const allItems = this.pool.items
    const enriched = []
    const unenriched = []
    for (const item of allItems) {
      if (item._enriched) {
        enriched.push(item)
      } else {
        unenriched.push(item)
      }
    }
    if (!unenriched.length) return

    // 按仓库分组，找需要 enrich 的 repo（sessionCache miss 的）
    const repoMap = new Map()
    for (const item of unenriched) {
      const repo = item.repo
      if (!repo) continue
      if (!repoMap.has(repo)) repoMap.set(repo, [])
      repoMap.get(repo).push(item)
    }

    const needEnrich = []
    for (const [repo] of repoMap) {
      if (!this.sessionCache.has(repo)) {
        needEnrich.push(repo)
      }
    }

    // 批量获取仓库健康信息
    if (needEnrich.length) {
      this._stats.repoChecked += needEnrich.length
      try {
        const { map, stats: { cacheHits } } = await batchGetRepoInfos(needEnrich)
        // 检查是否已被新搜索取代
        if (this.pool.gen !== this._fetchGen) return
        this._stats.cachedCount += cacheHits
        // 写入 sessionCache
        for (const [repo, entry] of map) {
          this.sessionCache.set(repo, { info: entry, health: assessLiveness(entry) })
        }
        for (const repo of needEnrich) {
          if (!map.has(repo)) {
            this.sessionCache.set(repo, { info: null, health: { level: 'unknown', days: null } })
          }
        }
      } catch {
        // GraphQL 失败不阻塞，继续用 unknown 降级
      }
    }

    // enrich + 过滤（共用逻辑）
    const passed = this._enrichAndFilter(unenriched)

    // 重建池：已 enrich 的 item + 新 enrich 通过的 item
    // 被过滤掉的 item（dead repo / 星数不够）从池中移除
    this.pool.items = [...enriched, ...passed]
  }

  /**
   * 静默补池：Phase 2 enrich 后若池子不足 pageSize，继续拉页补池
   * 不触发 _loading 状态，不更新 UI 状态，补完后再 enrich 一轮。
   *
   * @param {number} pageSize - 目标条数
   * @param {number} enrichGen - 当前后台 enrich 代次（用于取消）
   */
  async _silentRefillIfNeeded(pageSize, enrichGen) {
    let rounds = 0
    const MAX_REFILL_ROUNDS = 5
    while (
      this.pool.length < pageSize &&
      this.pool.hasMore &&
      rounds < MAX_REFILL_ROUNDS &&
      enrichGen === this._enrichGen
    ) {
      try {
        // 静默拉一页（不设 _loading）
        const opts = this._currentOpts
        const perPage = opts.perPage || 30
        const targetCount = this.pool.length + perPage
        const maxGithubPages = this.pool.fetchedPages + 2
        // 用 _fillPoolUntil 复用拉页 + enrich 逻辑（quick=false 完整管线）
        await this._fillPoolUntil({ targetCount, maxGithubPages, perPage })
      } catch {
        // 静默失败，不阻塞 onEnriched 回调
        break
      }
      rounds++
    }
  }
}

/** 供旧 loadIssuesUntilCount 兼容的封装（可选保留） */
export async function loadIssuesUntilCount(query, targetCount, opts = {}) {
  const fetcher = new IssueFetcher()
  await fetcher.fetchIssues(query, { ...opts, targetCount, maxGithubPages: Math.ceil(targetCount / (opts.perPage || 30)) + 2 })
  return {
    items: fetcher.issues,
    hasMore: fetcher.hasMore,
    totalCount: fetcher.totalCount,
    stats: fetcher.stats,
  }
}
