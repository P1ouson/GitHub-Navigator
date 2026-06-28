/**
 * 通用搜索池 + 仓库 Fetcher
 *
 * SearchPool 被 RepoFetcher 和 IssueFetcher（issueLoader.js）共用，
 * 保证仓库/Issue 走完全相同的分页、累积、预加载逻辑。
 *
 * RepoFetcher 的公开接口与 IssueFetcher 完全一致：
 *   items / hasMore / totalCount / fetchedPages / stats / loading / lastSearchQuery
 *   fetchRepos(query, opts) / fetchMore()
 *
 * SearchPage 因此可以用同一套 handlePageChange / 预加载 effect / 分页 UI 处理两者。
 */

import { searchRepositories } from './github.js'

/**
 * 通用搜索池 — 累积结果、去重、分页状态
 */
export class SearchPool {
  constructor() {
    this.items = []
    this._totalCount = 0
    this._fetchedPages = 0
    this._hasMore = true
    this._gen = 0
  }

  /** 追加一批结果，按 id 去重 */
  append(newItems) {
    if (!Array.isArray(newItems)) newItems = [newItems]
    const existingIds = new Set(this.items.map(i => i.id))
    const fresh = newItems.filter(i => !existingIds.has(i.id))
    this.items.push(...fresh)
    return fresh.length
  }

  reset() {
    this.items = []
    this._totalCount = 0
    this._fetchedPages = 0
    this._hasMore = true
    this._gen++
  }

  /** 当前池的代次，每次 reset 递增。用于 fetcher 检测自己是否已被新搜索取代 */
  get gen() { return this._gen }

  get totalCount() { return this._totalCount }
  set totalCount(v) { this._totalCount = v }
  get fetchedPages() { return this._fetchedPages }
  set fetchedPages(v) { this._fetchedPages = v }
  get hasMore() { return this._hasMore }
  set hasMore(v) { this._hasMore = v }
  get length() { return this.items.length }
}

/**
 * 仓库 Fetcher — 与 IssueFetcher 接口一致
 * 管理 searchRepositories 的分页、累积、自动补池
 */
export class RepoFetcher {
  constructor() {
    this.pool = new SearchPool()
    this._currentQuery = ''
    this._currentOpts = {}
    this._loading = false
    this._lastSearchQuery = ''
    this._stats = { fetched: 0 }
  }

  get totalCount() { return this.pool.totalCount }
  get hasMore() { return this.pool.hasMore }
  get items() { return this.pool.items }
  get fetchedPages() { return this.pool.fetchedPages }
  get stats() { return this._stats }
  get loading() { return this._loading }
  get lastSearchQuery() { return this._lastSearchQuery }

  /**
   * 首次搜索，自动补池直到满足 targetCount 或用尽页数
   * @param {string} query 搜索关键词
   * @param {object} opts { fetchSize, perPage, targetCount, maxGithubPages, language, stars }
   */
  async fetchRepos(query, opts = {}) {
    this.pool.reset()
    this._fetchGen = this.pool.gen
    this._currentQuery = query
    this._currentOpts = { ...opts }
    this._loading = true
    this._lastSearchQuery = ''
    this._stats = { fetched: 0 }

    try {
      await this._fillPoolUntil({
        targetCount: opts.targetCount || (opts.perPage || 30),
        maxGithubPages: opts.maxGithubPages || 2,
      })
    } finally {
      this._loading = false
    }
    return this.pool.length > 0
  }

  /** 加载更多（翻页时自动补池）
   * @param {number} pages - 加载几页数据（默认1）
   */
  async fetchMore(pages = 1) {
    if (!this.pool.hasMore || this._loading) return false
    this._loading = true
    try {
      const opts = this._currentOpts
      const perPage = opts.perPage || 30
      const targetCount = this.pool.length + perPage * pages
      const maxGithubPages = this.pool.fetchedPages + 2 * pages
      await this._fillPoolUntil({ targetCount, maxGithubPages })
    } finally {
      this._loading = false
    }
    return this.pool.length > 0
  }

  /** 持续拉页补池直到满足 targetCount 或耗尽 */
  async _fillPoolUntil({ targetCount, maxGithubPages }) {
    while (
      this.pool.length < targetCount &&
      this.pool.fetchedPages < maxGithubPages &&
      this.pool.hasMore
    ) {
      // 被新搜索取代 → 立即停止补池
      if (this.pool.gen !== this._fetchGen) return
      const added = await this._fetchOneGithubPage()
      if (this.pool.gen !== this._fetchGen) return
      if (added === 0 && this.pool.hasMore) continue
    }
  }

  /** 拉取一页 GitHub 仓库，入池 */
  async _fetchOneGithubPage() {
    const query = this._currentQuery
    const opts = this._currentOpts
    const nextPage = this.pool.fetchedPages + 1
    const fetchSize = opts.fetchSize || 100

    const result = await searchRepositories(query, { ...opts, fetchSize }, nextPage)
    // 异步等待后再次检查代次 — 可能已被新搜索 reset
    if (this.pool.gen !== this._fetchGen) return 0
    const rawItems = result.items || []
    this._lastSearchQuery = result.searchQuery || query
    this.pool.totalCount = result.totalCount || rawItems.length || 0
    this.pool.hasMore = result.hasMore ?? (rawItems.length >= (opts.perPage || 30))

    if (!rawItems.length) {
      this.pool.fetchedPages = nextPage
      return 0
    }

    // 打标签后入池（与 IssueFetcher 的 enrich 步骤对应）
    const items = rawItems.map(item => ({
      ...item,
      _type: 'repo',
      _source: 'github_api',
    }))
    this._stats.fetched += items.length
    const added = this.pool.append(items)
    this.pool.fetchedPages = nextPage
    return added
  }
}
