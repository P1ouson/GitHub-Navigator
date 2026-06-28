/**
 * 搜索编排层（Search Orchestrator）
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 职责边界（约束）                                                     │
 * │                                                                      │
 * │ 本层负责：                                                           │
 * │   1. query 预处理与搜索模式判定                                       │
 * │   2. repo URL / org / 普通 query 入口分流                            │
 * │   3. L1-L4 意图路由                                                  │
 * │   4. 多源搜索调度（repo/issue/code/knowledge/web）                    │
 * │   5. 两阶段 enrich / rerank / repo health / beginner score 协调      │
 * │   6. 生成 rankedSections（主渲染源）                                  │
 * │   7. load more / label search / repo filter 的搜索流程协调            │
 * │   8. 错误归一化（通过 errors.js 公共模块）                            │
 * │                                                                      │
 * │ 本层不允许：                                                          │
 * │   - 操作 React state（通过回调 cb 通知 hook）                         │
 * │   - 依赖页面组件或 DOM                                               │
 * │   - 返回"半成品 UI 数据"（必须由 builder 构造完整渲染结构）            │
 * │   - 直接访问缓存层（Dexie/repoInfoCache）                             │
 * │   - 做 UI 样式判断（label color / liveness class 等）                 │
 * │                                                                      │
 * │ 单一主渲染源约定：                                                    │
 * │   rankedSections 是唯一主渲染源。issueItems/repoItems 仅供页面派生    │
 * │   筛选栏统计，不允许作为平行结果源驱动结果列表。                       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 接口契约：
 *   - new SearchOrchestrator() 创建实例（无参数）
 *   - orchestrator.search(query, config, cb) → Promise<void>
 *   - orchestrator.labelSearch(labels: Set<string>, config, cb) → Promise<void>
 *   - orchestrator.loadMore(tab, newPage, config, cb) → Promise<object[]>
 *   - orchestrator.fetchMoreForFilter(config, cb) → Promise<void>
 *   - orchestrator.preloadIfNeeded(tab, currentPage, config) → void（同步，后台异步）
 *   - orchestrator.resetLabelFilter(config, cb) → void（恢复 originalIssue 切片）
 *
 * 回调契约 cb：
 *   - onState(partial: Partial<SearchState>)   更新搜索状态
 *   - onResults(results: object|fn)            更新原始结果（支持函数式更新）
 *   - onRankedSections(sections: object|fn)    更新主渲染源（支持函数式更新）
 *   - onIntent(intent: string|null)            更新意图标签
 *   - onActiveTab(tab: string|null)            更新当前激活 tab
 *   - onRagAnswer(answer: object|fn)           更新 RAG 答案（支持函数式更新）
 *   - onRagLoading(loading: boolean)           更新 RAG 加载态
 *
 * 只读访问器（供页面派生筛选栏数据，不参与主渲染）：
 *   - issueItems / repoItems / issueStats
 *   - getTotalCount(tab) / hasMore(tab)
 *   - lockedLanguages / originalIssue
 */

import { routeQuery, applyLLMIntent } from '../intent.js'
import { searchCode, parseGitHubUrl, searchReposByOrg, getRepoInfo } from '../github.js'
import { isLLMAvailable, analyzeIntent, analyzeIntentLight, chatStream } from '../llm.js'
import { parseInlineSyntax } from '../searchConfig.js'
import { searchKnowledge, KB } from '../knowledge.js'
import { askRAGStream, searchRAG } from '../rag.js'
import { matchIntentByEmbedding, cacheIntentResult } from '../intentEmbedding.js'
import { searchSearxng } from '../searxng.js'
import { IssueFetcher } from '../issueLoader.js'
import { RepoFetcher } from '../searchFetcher.js'
import { detectLanguages } from '../languages.js'
import { friendlyError } from '../errors.js'
import {
  tagRepoItem,
  buildRankedSections, prepareIssueList, prepareRepoList, mergeSectionSlice,
} from './searchBuilder.js'
import { INITIAL_SEARCH_STATE } from './searchState.js'

export class SearchOrchestrator {
  constructor() {
    // fetcher 池（内部态，不暴露给页面）
    this.issueFetcher = new IssueFetcher()
    this.repoFetcher = new RepoFetcher()

    // 搜索代次（取消保护）
    this._gen = 0
    this._running = false

    // 内部 ref（原 SearchPage 的 ref 迁移至此）
    this._totalCount = {}                  // { repo, issue, code }
    this._baseQuery = ''                   // label 重搜基础 query
    this._originalIssue = null             // label 清除后恢复原始 issue
    this._lastRepoQuery = ''               // repo 重排用 query
    this._originalRepoQuery = ''           // 原始 repo query（筛选时不变，避免重复拼接）
    this._lockedLanguages = new Set()      // 搜索词锁定的语言

    // 缓存用内部快照（由 hook 回调更新）
    this._rankedSections = null
    this._results = {}
    this._intent = null
    this._activeTab = null
    this._ragAnswer = null
  }

  /* ===== 只读访问器（供页面派生筛选栏数据）===== */

  /** issue 池 items（供页面聚合 label/语言/难度统计） */
  get issueItems() { return this.issueFetcher.items }
  /** repo 池 items（供页面聚合语言/topics 统计） */
  get repoItems() { return this.repoFetcher.items }
  /** issue fetcher stats */
  get issueStats() { return this.issueFetcher.stats }
  /** 当前 tab 的 totalCount */
  getTotalCount(tab) { return this._totalCount[tab] || 0 }
  /** 当前 tab 是否还有更多数据可加载（供页面分页禁用判断） */
  hasMore(tab) {
    if (tab === 'issue') return this.issueFetcher.hasMore
    if (tab === 'repo') return this.repoFetcher.hasMore
    return false
  }
  /** 锁定语言集合 */
  get lockedLanguages() { return this._lockedLanguages }
  /** 原始 issue 快照（label 清除时恢复用） */
  get originalIssue() { return this._originalIssue }

  /* ===== 主搜索入口 ===== */

  /**
   * 发起一次搜索
   * @param {string} q
   * @param {object} config - 搜索配置（DEFAULT_CONFIG）
   * @param {object} cb - 回调集合
   *   { onState, onResults, onRankedSections, onIntent, onActiveTab, onRagAnswer, onRagLoading }
   */
  async search(q, config, cb) {
    if (!q.trim()) return
    if (this._running) return
    this._running = true

    try {
      this._gen++
      const gen = this._gen

      // 重置内部态
      this._totalCount = {}
      this._baseQuery = ''
      this._originalIssue = null
      this._lastRepoQuery = ''
      this._originalRepoQuery = ''
      this.issueFetcher.pool.reset()
      this.repoFetcher.pool.reset()

      // 通知页面重置
      cb.onState({ status: 'searching', hint: '', error: null })
      cb.onIntent(null)
      cb.onRankedSections(null)
      cb.onResults({})
      cb.onRagAnswer(null)
      cb.onRagLoading(false)

      // 自动勾选：搜索词里检测到的语言
      const detectedLangs = this._detectLanguages(q)
      this._lockedLanguages = new Set(detectedLangs)

      // ===== 阶段 1: repo/org URL 分流 =====
      const ghUrl = parseGitHubUrl(q)
      if (ghUrl?.type === 'repo') {
        try {
          const info = await getRepoInfo(ghUrl.owner, ghUrl.repo)
          const item = tagRepoItem(info)
          cb.onIntent('repo')
          cb.onResults({ repo: [info] })
          cb.onRankedSections({ repo: [item] })
          cb.onActiveTab('repo')
          if (gen === this._gen) cb.onState({ status: 'idle', hint: '', error: null })
        } catch (e) {
          if (gen === this._gen) cb.onState({ status: 'error', hint: '', error: friendlyError(e) })
        }
        return
      }
      if (ghUrl?.type === 'org') {
        try {
          const repos = await searchReposByOrg(ghUrl.owner, { perPage: 10 })
          const items = repos.map(tagRepoItem)
          cb.onIntent('repo')
          cb.onResults({ repo: repos })
          cb.onRankedSections({ repo: items })
          cb.onActiveTab('repo')
          if (gen === this._gen) cb.onState({ status: 'idle', hint: '', error: null })
        } catch (e) {
          if (gen === this._gen) cb.onState({ status: 'error', hint: '', error: friendlyError(e) })
        }
        return
      }

      // ===== 阶段 2: 内联语法解析 + 规则路由 =====
      const { query: cleanQuery, filters: inlineFilters } = parseInlineSyntax(q)
      let mergedFilters = { ...config.filters, ...inlineFilters }
      const plan = routeQuery(cleanQuery)
      let effectivePlan = plan

      // 合并规则路由提取的过滤条件
      if (plan.filters) {
        const pf = plan.filters
        if (pf.minStars != null) mergedFilters.minStars = pf.minStars
        if (pf.maxStars != null) mergedFilters.maxStars = pf.maxStars
        if (pf.createdAfter) mergedFilters.createdAfter = pf.createdAfter
        if (pf.updatedAfter) mergedFilters.updatedAfter = pf.updatedAfter
        if (pf.sort) mergedFilters.sort = pf.sort
      }

      // 将 dateRange 转换为 createdAfter / updatedAfter
      if (mergedFilters.dateRange && mergedFilters.dateRange !== 'all') {
        const now = new Date()
        if (mergedFilters.dateRange === 'week') {
          const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          mergedFilters.createdAfter = d.toISOString().slice(0, 10)
          mergedFilters.updatedAfter = d.toISOString().slice(0, 10)
        } else if (mergedFilters.dateRange === 'month') {
          const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          mergedFilters.createdAfter = d.toISOString().slice(0, 10)
          mergedFilters.updatedAfter = d.toISOString().slice(0, 10)
        } else if (mergedFilters.dateRange === 'year') {
          const d = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
          mergedFilters.createdAfter = d.toISOString().slice(0, 10)
          mergedFilters.updatedAfter = d.toISOString().slice(0, 10)
        }
      }

      // ===== 阶段 3-4 合并：LLM 路由与 GitHub 搜索并行（生产标准改造 P0-1）=====
      // L1 高置信 → 直接搜索；L1 低置信 → 立即用 L1 结果启动宽搜，LLM 后台跑，回来后收窄
      const ruleIntent = effectivePlan.intent
      cb.onIntent(ruleIntent)

      // 立即设置 activeTab
      if (ruleIntent === 'issue') cb.onActiveTab('issue')
      else if (ruleIntent === 'repo') cb.onActiveTab('repo')
      else if (ruleIntent === 'code') cb.onActiveTab('code')

      // 启动 LLM 后台路由（不阻塞 GitHub 搜索）
      let llmResultPromise = null
      const l1Confident = plan.confidence === 'high' && plan.intent !== 'mixed'
      if (isLLMAvailable() && !l1Confident) {
        // LLM 后台跑，3s 超时，不阻塞搜索
        const LLM_TIMEOUT = 3000
        llmResultPromise = Promise.race([
          this._runLLMRouting(cleanQuery, gen, cb),
          new Promise((resolve) => setTimeout(() => resolve(null), LLM_TIMEOUT)),
        ]).then(result => {
          if (gen !== this._gen) return null
          if (result && (result._usedTier === 'L3' || result._usedTier === 'L4')) {
            cacheIntentResult(cleanQuery, result).catch(() => {})
          }
          return result
        }).catch(() => null)
      }

      // ===== 多源搜索调度（用 L1 的 effectivePlan 立即启动，不等 LLM）=====
      const rawResults = {}
      const prefLang = mergedFilters.preferredLanguage || 'any'
      const pageSize = config.pagination?.issuePageSize || 20
      const minLiveness = mergedFilters.minLiveness || 'maintained'
      let hadError = false

      try {
        // 知识库 + RAG
        if (effectivePlan.sources.includes('knowledge') && config.sources.qa?.enabled !== false) {
          const kbQuery = effectivePlan.query_by_source.knowledge || cleanQuery
          const kbMatches = searchKnowledge(kbQuery, 5)
          if (kbMatches.length > 0) rawResults.knowledge = kbMatches

          // RAG 异步替换
          searchRAG(kbQuery, 5).then(ragResults => {
            if (gen !== this._gen) return
            const seenIds = new Set()
            const betterMatches = []
            for (const r of ragResults) {
              if (r.score < 0.3) continue
              if (!seenIds.has(r.docId)) {
                seenIds.add(r.docId)
                const entry = KB.find(e => e.id === r.docId)
                if (entry) betterMatches.push(entry)
              }
            }
            if (betterMatches.length > 0) {
              cb.onResults(prev => ({ ...prev, knowledge: betterMatches }))
            }
          }).catch(() => {})

          // LLM 问答流式（仅 qa intent 或 KB 命中时触发）
          if (isLLMAvailable() && (ruleIntent === 'qa' || kbMatches.length > 0)) {
            cb.onRagLoading(true)
            cb.onRagAnswer(null)
            // 动态 token：KB 命中多时用更多 token 保证回答质量，少时用小 token 加速
            const ragTokens = kbMatches.length > 3 ? 512 : 256
            askRAGStream(cleanQuery, (partialAnswer) => {
              if (gen !== this._gen) return
              cb.onRagAnswer(prev => prev ? { ...prev, answer: partialAnswer } : { answer: partialAnswer, sources: [] })
            }, ragTokens)
              .then(res => { if (gen === this._gen) cb.onRagAnswer(res) })
              .catch(err => console.warn('[RAG] 问答失败:', err.message))
              .finally(() => { if (gen === this._gen) cb.onRagLoading(false) })
          }
        }

        // GitHub 多源（用 L1 的 sources 立即启动）
        const ghSources = [...new Set(effectivePlan.sources.filter(s =>
          ['repo', 'issue', 'code'].includes(s) && config.sources[s]?.enabled
        ))]
        const ghTasks = []

        for (const source of ghSources) {
          const sourceQuery = effectivePlan.query_by_source[source] || cleanQuery

          if (source === 'issue') {
            this._baseQuery = sourceQuery
            ghTasks.push(async () => {
              const fetcher = this.issueFetcher
              const issueOpts = {
                query: sourceQuery,
                minLiveness,
                fetchSize: 100,
                language: mergedFilters.language || undefined,
                stars: mergedFilters.minStars > 0 ? mergedFilters.minStars : undefined,
                maxStars: mergedFilters.maxStars > 0 ? mergedFilters.maxStars : undefined,
                createdAfter: mergedFilters.createdAfter || undefined,
                updatedAfter: mergedFilters.updatedAfter || undefined,
                labels: mergedFilters.labels || undefined,
              }
              await fetcher.fetchIssues(issueOpts.query, {
                ...issueOpts,
                targetCount: pageSize,
                maxGithubPages: 5,
                fetchSize: 100,
                onEnriched: () => {
                  if (gen !== this._gen) return
                  const sorted = prepareIssueList(fetcher.issues, prefLang)
                  const issueSlice = sorted.slice(0, pageSize)
                  this._totalCount.issue = fetcher.totalCount || 0
                  this._originalIssue = { items: sorted, totalCount: this._totalCount.issue }
                  cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', issueSlice))
                  // 只在 searching 状态下更新 hint，避免覆盖 idle/error 状态
                  if (gen === this._gen) {
                    cb.onState(prev => prev.status === 'searching' ? { status: 'searching', hint: '', error: null } : prev)
                  }
                }
              })
              if (gen !== this._gen) return
              this._totalCount.issue = fetcher.totalCount || 0
              const sorted = prepareIssueList(fetcher.issues, prefLang)
              rawResults.issue = sorted
            })
          } else if (source === 'repo') {
            ghTasks.push(async () => {
              try {
                const fetcher = this.repoFetcher
                await fetcher.fetchRepos(sourceQuery, {
                  ...mergedFilters,
                  fetchSize: 100,
                  perPage: 30,
                  targetCount: pageSize * 3,  // 生产标准改造 P1-9：扩大召回
                  maxGithubPages: 5,           // 生产标准改造 P1-9：从 2 扩到 5
                })
                if (gen !== this._gen) return
                this._totalCount.repo = fetcher.totalCount || 0
                this._lastRepoQuery = sourceQuery
                this._originalRepoQuery = sourceQuery
                const reranked = prepareRepoList(fetcher.items, sourceQuery)
                rawResults.repo = reranked.slice(0, pageSize)
              } catch (e) {
                hadError = true
                rawResults.repo = []
                if (gen === this._gen) cb.onState({ status: 'error', hint: '', error: friendlyError(e) })
              }
            })
          } else if (source === 'code') {
            ghTasks.push(async () => {
              try {
                const result = await searchCode(sourceQuery, { ...mergedFilters, fetchSize: config.sources.code?.perPage || 30 })
                this._totalCount.code = result.totalCount || 0
                rawResults.code = result.items
              } catch (e) {
                hadError = true
                rawResults.code = []
                if (gen === this._gen) cb.onState({ status: 'error', hint: '', error: friendlyError(e) })
              }
            })
          }
        }

        // SearXNG 网页搜索（后台不阻塞）
        if (effectivePlan.sources.includes('web')) {
          const webQuery = effectivePlan.query_by_source.web || cleanQuery
          const cat = ruleIntent === 'qa' ? 'general' : 'it'
          searchSearxng(webQuery, { categories: cat, pageno: 1 })
            .then(searxResult => {
              if (gen !== this._gen) return
              if (searxResult.results?.length > 0) {
                cb.onResults(prev => ({ ...prev, searxng_web: searxResult }))
              }
            })
            .catch(() => {})
        }

        // 所有 GitHub 任务并行执行（repo/code/issue 同时启动）
        if (ghTasks.length) {
          await Promise.all(ghTasks.map(t => t()))
          if (gen !== this._gen) return
        }

        // 首批结果提交
        const partialSections = buildRankedSections(rawResults, q, ruleIntent)
        cb.onRankedSections(partialSections)
        cb.onResults(rawResults)
        if (ruleIntent !== 'issue' && ruleIntent !== 'repo' && ruleIntent !== 'code') {
          const firstTab = ['repo', 'issue', 'code', 'github', 'web'].find(t => partialSections[t]?.length > 0)
          if (firstTab) cb.onActiveTab(firstTab)
        }

        // Issue 结果已通过并行 + onEnriched 回调入池，此处做收尾补全
        if (this.issueFetcher.issues.length > 0 && !rawResults.issue) {
          const sorted = prepareIssueList(this.issueFetcher.issues, prefLang)
          const issueSlice = sorted.slice(0, pageSize)
          this._totalCount.issue = this.issueFetcher.totalCount || 0
          this._originalIssue = { items: sorted, totalCount: this._totalCount.issue }
          cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', issueSlice))
        }

        // ===== Phase 1 完成，立即回 idle（不等 LLM 收窄和 autoExpand）=====
        // 用户先看到结果，LLM 收窄和扩搜在后台跑，不阻塞 UI
        if (gen === this._gen && !hadError) {
          // 写入 sessionStorage 缓存（5min TTL）
          const cacheKey = `search_${q}`
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({
              data: {
                rankedSections: this._rankedSections,
                results: this._results,
                intent: this._intent,
                activeTab: this._activeTab,
                ragAnswer: this._ragAnswer,
              },
              ts: Date.now(),
            }))
          } catch {}
          cb.onState({ status: 'idle', hint: '', error: null })
        }

        // ===== LLM 收窄 + autoExpand 后台跑（不阻塞 idle，不阻塞 _running）=====
        if (gen === this._gen && !hadError) {
          // LLM 收窄（后台，代次保护）
          if (llmResultPromise) {
            llmResultPromise.then(llmResult => {
              if (gen !== this._gen) return
              if (llmResult?.intent && llmResult.confidence >= 0.6 && !llmResult.ambiguous) {
                const override = applyLLMIntent(llmResult, cleanQuery)
                console.debug(`[智能路由] LLM 收窄: "${cleanQuery}" → ${override.intent} (confidence=${llmResult.confidence.toFixed(2)})`)
                cb.onIntent(override.intent)
                if (override.intent === 'issue') cb.onActiveTab('issue')
                else if (override.intent === 'repo') cb.onActiveTab('repo')
                else if (override.intent === 'code') cb.onActiveTab('code')
              } else if (llmResult) {
                console.debug(`[智能路由] LLM 低置信或模糊，保留 L1 宽搜: "${cleanQuery}" → ${llmResult.intent} (confidence=${llmResult.confidence?.toFixed(2) || 'N/A'})`)
              } else {
                console.debug(`[智能路由] LLM 超时降级 L1: "${cleanQuery}" → ${plan.intent}`)
              }
            }).catch(() => {})
          }

          // autoExpand（后台，延迟一个宏任务避免覆盖 search 返回时的 idle 状态）
          // 同步部分会立即设 status='expanding'，用 setTimeout 确保搜索返回时仍是 idle
          setTimeout(() => {
            if (gen !== this._gen) return
            this._autoExpandIfNeeded(cleanQuery, mergedFilters, config, gen, cb, hadError).catch(() => {})
          }, 0)
        }
      } catch (err) {
        hadError = true
        if (gen === this._gen) cb.onState({ status: 'error', hint: '', error: friendlyError(err) })
      }
      // idle 已在 Phase 1 完成后立即设置，此处无需 finally 回 idle
    } finally {
      this._running = false
    }
  }

  /* ===== Label 重搜 ===== */

  /**
   * 选 label 后带 label: 条件重新搜索
   * @param {Set<string>} labels
   * @param {object} config
   * @param {object} cb
   */
  async labelSearch(labels, config, cb) {
    const baseQuery = this._baseQuery
    if (!baseQuery || labels.size === 0) return

    const pageSize = config.pagination?.issuePageSize || 20
    const minLiveness = config.filters?.minLiveness || 'maintained'
    const prefLang = config.filters?.preferredLanguage || 'any'

    cb.onState({ status: 'label_search', hint: '', error: null })

    try {
      const fetcher = this.issueFetcher
      const labelParts = [...labels].map(l => `label:"${l}"`)
      const labelQuery = `${baseQuery} ${labelParts.join(' ')}`

      await fetcher.fetchIssues(labelQuery, {
        keepSessionCache: true,
        minLiveness,
        fetchSize: 100,
        targetCount: pageSize,
        maxGithubPages: 2,
        language: config.filters?.language || undefined,
        stars: config.filters?.minStars > 0 ? config.filters.minStars : undefined,
        labels: config.filters?.labels || undefined,
        // 传 onEnriched 启用两阶段模式：Phase 1 快速入池立即出结果，Phase 2 后台 enrich + 补池后更新
        onEnriched: () => {
          const sorted = prepareIssueList(fetcher.issues, prefLang)
          const issueSlice = sorted.slice(0, pageSize)
          this._totalCount.issue = fetcher.totalCount || 0
          cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', issueSlice))
        }
      })

      // Phase 1 快速入池完成，立即更新 rankedSections（不等 enrich）
      this._totalCount.issue = fetcher.totalCount || 0
      const sorted = prepareIssueList(fetcher.issues, prefLang)
      cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', sorted.slice(0, pageSize)))
    } catch {
      // 静默失败
    } finally {
      cb.onState({ status: 'idle', hint: '', error: null })
    }
  }

  /* ===== 加载更多 / 翻页 ===== */

  /**
   * 翻页：若池中数据不足则先 fetchMore，再返回指定页切片
   * @param {string} tab - 'issue' | 'repo'
   * @param {number} newPage
   * @param {object} config
   * @param {object} cb
   * @returns {Promise<object[]>} 该页的切片
   */
  async loadMore(tab, newPage, config, cb) {
    if (newPage < 1) return []
    const pageSize = config.pagination?.issuePageSize || 20
    const fetcher = tab === 'issue' ? this.issueFetcher : this.repoFetcher

    const needed = newPage * pageSize
    if (fetcher.items.length < needed && fetcher.hasMore) {
      cb.onState({ status: 'loading_more', hint: '', error: null })
      let loadError = false
      try {
        // 循环拉页直到满足 needed 或 hasMore 耗尽（最多 10 轮，避免无限循环）
        let rounds = 0
        while (fetcher.items.length < needed && fetcher.hasMore && rounds < 10) {
          await fetcher.fetchMore(3)
          rounds++
          if (fetcher.items.length >= needed) break
        }
      } catch (e) {
        loadError = true
        cb.onState({ status: 'error', hint: '', error: friendlyError(e) })
      } finally {
        // 只在未出错时才回到 idle，避免覆盖 catch 设置的 error 状态
        if (!loadError) cb.onState({ status: 'idle', hint: '', error: null })
      }
    }

    const start = (newPage - 1) * pageSize
    const prefLang = config.filters?.preferredLanguage || 'any'
    const sorted = tab === 'issue'
      ? prepareIssueList(fetcher.items, prefLang)
      : prepareRepoList(fetcher.items, this._lastRepoQuery)
    const slice = sorted.slice(start, start + pageSize)

    // 若切片为空但 hasMore 仍为 true，不更新 rankedSections（保持当前显示不变，避免空白）
    if (slice.length === 0 && fetcher.hasMore) {
      return slice
    }

    cb.onRankedSections(prev => mergeSectionSlice(prev, tab, slice))
    return slice
  }

  /* ===== Repo 筛选后台拉取 ===== */

  /**
   * repo 筛选时后台拉取更多数据
   * @param {object} config
   * @param {object} cb
   */
  async fetchMoreForFilter(config, cb) {
    const fetcher = this.repoFetcher
    if (!fetcher.hasMore || fetcher.items.length === 0) return
    cb.onState({ status: 'repo_filter', hint: '', error: null })
    try {
      await fetcher.fetchMore(3)
    } catch {
      // 静默
    } finally {
      cb.onState({ status: 'idle', hint: '', error: null })
    }
  }

  /**
   * issue 筛选自动补数据（与 fetchMoreForFilter 对应，用于 issue 筛选后不足一页时）
   */
  async fetchMoreForIssueFilter(config, cb) {
    const fetcher = this.issueFetcher
    if (!fetcher.hasMore || fetcher.items.length === 0) return
    try {
      await fetcher.fetchMore(3)
    } catch {
      // 静默
    }
  }

  /* ===== Repo 筛选 API 重搜 ===== */

  /**
   * repo 筛选（语言/主题）触发 API 重搜，拼接 language:xxx / topic:xxx 条件
   * @param {Set<string>} languages - 选中的语言集合
   * @param {Set<string>} topics - 选中的主题集合
   * @param {object} config
   * @param {object} cb
   */
  async repoFilterSearch(languages, topics, config, cb) {
    const baseQuery = this._originalRepoQuery || this._lastRepoQuery
    if (!baseQuery) return
    const pageSize = config.pagination?.issuePageSize || 20

    cb.onState({ status: 'repo_filter', hint: '', error: null })

    try {
      const fetcher = this.repoFetcher
      const langParts = [...(languages || [])].map(l => `language:${l}`)
      const topicParts = [...(topics || [])].map(t => `topic:${t}`)
      const filterQuery = `${baseQuery} ${[...langParts, ...topicParts].join(' ')}`

      await fetcher.fetchRepos(filterQuery, {
        fetchSize: 100,
        perPage: 30,
        targetCount: pageSize * 3,
        maxGithubPages: 5,
      })

      this._totalCount.repo = fetcher.totalCount || 0
      this._lastRepoQuery = filterQuery
      const sorted = prepareRepoList(fetcher.items, filterQuery)
      cb.onRankedSections(prev => mergeSectionSlice(prev, 'repo', sorted.slice(0, pageSize)))
    } catch {
      // 静默
    } finally {
      cb.onState({ status: 'idle', hint: '', error: null })
    }
  }

  /**
   * 清除 repo 筛选后，恢复原始搜索结果
   * @param {object} config
   * @param {object} cb
   */
  resetRepoFilter(config, cb) {
    const baseQuery = this._originalRepoQuery || this._lastRepoQuery
    if (!baseQuery) return
    const pageSize = config.pagination?.issuePageSize || 20
    const fetcher = this.repoFetcher
    const sorted = prepareRepoList(fetcher.items, baseQuery)
    const slice = sorted.slice(0, pageSize)
    cb.onRankedSections(prev => mergeSectionSlice(prev, 'repo', slice))
  }

  /* ===== Issue 难度筛选 API 重搜 ===== */

  /**
   * issue 难度筛选触发 API 重搜
   * easy → label:"good first issue"
   * hard → label:"bug"
   * medium → 保留客户端筛选（无良好 API 映射）
   * @param {Set<string>} difficulties - 选中的难度集合
   * @param {object} config
   * @param {object} cb
   */
  async issueDifficultySearch(difficulties, config, cb) {
    const baseQuery = this._baseQuery
    if (!baseQuery || difficulties.size === 0) return

    const pageSize = config.pagination?.issuePageSize || 20
    const minLiveness = config.filters?.minLiveness || 'maintained'
    const prefLang = config.filters?.preferredLanguage || 'any'

    cb.onState({ status: 'label_search', hint: '', error: null })

    try {
      const fetcher = this.issueFetcher
      const labelParts = []
      let mediumOnly = false
      for (const d of difficulties) {
        if (d === 'easy') labelParts.push('label:"good first issue"')
        else if (d === 'hard') labelParts.push('label:"bug"')
        else if (d === 'medium') mediumOnly = true
      }

      // medium 无直接 API 映射，用 enhancement 近似
      if (mediumOnly && labelParts.length === 0) {
        labelParts.push('label:"enhancement"')
      }

      if (labelParts.length === 0) {
        cb.onState({ status: 'idle', hint: '', error: null })
        return
      }

      const labelQuery = `${baseQuery} ${labelParts.join(' ')}`

      await fetcher.fetchIssues(labelQuery, {
        keepSessionCache: true,
        minLiveness,
        fetchSize: 100,
        targetCount: pageSize,
        maxGithubPages: 5,
        onEnriched: () => {
          const sorted = prepareIssueList(fetcher.issues, prefLang)
          const issueSlice = sorted.slice(0, pageSize)
          this._totalCount.issue = fetcher.totalCount || 0
          cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', issueSlice))
        }
      })
      this._totalCount.issue = fetcher.totalCount || 0
      const sorted = prepareIssueList(fetcher.issues, prefLang)
      cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', sorted.slice(0, pageSize)))
    } catch (e) {
      // 静默
    } finally {
      cb.onState({ status: 'idle', hint: '', error: null })
    }
  }

  /* ===== Label 清除恢复 ===== */

  /**
   * 清除 label 筛选后，恢复原始 issue 列表的首屏切片。
   *
   * 收口原因：原 SearchPage 直接调 setRankedSections(prev => ({...prev, issue: originalIssue.items.slice(0, ps)}))，
   * 绕过 orchestrator，违反"页面不直接操作主渲染源"的边界。
   *
   * @param {object} config
   * @param {object} cb
   */
  resetLabelFilter(config, cb) {
    if (!this._originalIssue) return
    const pageSize = config.pagination?.issuePageSize || 20
    const slice = this._originalIssue.items.slice(0, pageSize)
    cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', slice))
  }

  /* ===== 预加载（接近末页时后台续拉）===== */

  /**
   * 接近末页时后台续拉 3 页（不更新状态，静默执行）
   * @param {string} tab
   * @param {number} currentPage
   * @param {object} config
   */
  preloadIfNeeded(tab, currentPage, config) {
    const fetcher = tab === 'issue' ? this.issueFetcher : this.repoFetcher
    if (!fetcher.hasMore) return
    const ps = config.pagination?.issuePageSize || 20
    const totalPages = Math.ceil(fetcher.items.length / ps)
    if (currentPage >= totalPages - 1 && fetcher.items.length > 0) {
      fetcher.fetchMore(3).catch(() => {})
    }
  }

  /* ===== AI 语义筛选 + 组合高级筛选 ===== */

  /**
   * AI 语义筛选：将自然语言解析为结构化筛选条件
   * @param {string} userInput - 用户自然语言描述
   * @returns {Promise<object|null>} { languages, topics, labels, minStars, maxStars, difficulty }
   */
  async parseAiFilterIntent(userInput) {
    if (!isLLMAvailable() || !userInput.trim()) return null

    const systemPrompt = `你是一个 GitHub 筛选条件解析器。将用户的自然语言描述解析为结构化筛选条件。

返回 JSON 格式（只返回 JSON，不要其他内容）：
{
  "languages": [],
  "topics": [],
  "labels": [],
  "minStars": null,
  "maxStars": null,
  "difficulty": null,
  "liveness": null,
  "explanation": "用中文简述你理解的条件"
}

规则：
- languages: 编程语言，如 ["Python", "JavaScript"]，没有则 []
- topics: 仓库主题标签，如 ["web", "machine-learning"]，没有则 []
- labels: issue 标签，如 ["good first issue", "bug"]，没有则 []
- minStars: 最小星数，"热门"→1000，"大火"→5000，"万星"→10000，没有则 null
- maxStars: 最大星数，"小型"→1000，"轻量"→500，没有则 null
- difficulty: issue 难度，"简单/新手/入门"→"easy"，"困难/复杂"→"hard"，没有则 null
- liveness: 活跃度，"活跃/最近更新"→"active"，"维护中"→"maintained"，没有则 null

示例：
"找适合新手的 Python Web 项目，活跃的" → {"languages":["Python"],"topics":["web"],"labels":["good first issue"],"minStars":null,"maxStars":null,"difficulty":"easy","liveness":"active","explanation":"搜索 Python 语言、Web 主题、有 good first issue 标签、最近活跃的项目"}
"最近半年活跃的 React 项目，星数过千" → {"languages":["JavaScript"],"topics":["react"],"labels":[],"minStars":1000,"maxStars":null,"difficulty":null,"liveness":"active","explanation":"搜索 React 相关、星数>1000、最近活跃的 JavaScript 项目"}
"找 bug 类 issue" → {"languages":[],"topics":[],"labels":["bug"],"minStars":null,"maxStars":null,"difficulty":"hard","liveness":null,"explanation":"搜索 bug 标签的 issue"}`

    try {
      let fullContent = ''
      await chatStream(systemPrompt, userInput, (chunk) => {
        fullContent += chunk
      }, 512)

      const jsonStr = fullContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(jsonStr)
      return {
        languages: Array.isArray(parsed.languages) ? parsed.languages : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        labels: Array.isArray(parsed.labels) ? parsed.labels : [],
        minStars: typeof parsed.minStars === 'number' ? parsed.minStars : null,
        maxStars: typeof parsed.maxStars === 'number' ? parsed.maxStars : null,
        difficulty: parsed.difficulty || null,
        liveness: parsed.liveness || null,
        explanation: parsed.explanation || '',
      }
    } catch (e) {
      console.warn('[AI筛选] 解析失败:', e.message)
      return null
    }
  }

  /**
   * 组合 repo 筛选（语言 + 主题 + star + 活跃度）
   * @param {object} filters - { languages, topics, minStars, maxStars, liveness }
   * @param {object} config
   * @param {object} cb
   */
  async combinedRepoFilterSearch(filters, config, cb) {
    const baseQuery = this._originalRepoQuery || this._lastRepoQuery
    if (!baseQuery) return
    const pageSize = config.pagination?.issuePageSize || 20

    cb.onState({ status: 'repo_filter', hint: '', error: null })

    try {
      const fetcher = this.repoFetcher
      const parts = []

      if (filters.languages?.size > 0) {
        for (const l of filters.languages) parts.push(`language:${l}`)
      }
      if (filters.topics?.size > 0) {
        for (const t of filters.topics) parts.push(`topic:${t}`)
      }
      if (filters.minStars > 0) {
        parts.push(`stars:>=${filters.minStars}`)
      }
      if (filters.maxStars > 0) {
        parts.push(`stars:<=${filters.maxStars}`)
      }

      const filterQuery = `${baseQuery} ${parts.join(' ')}`

      const livenessMap = { active: 'active', maintained: 'maintained', inactive: 'inactive' }
      const minLiveness = livenessMap[filters.liveness] || 'maintained'

      await fetcher.fetchRepos(filterQuery, {
        fetchSize: 100,
        perPage: 30,
        targetCount: pageSize * 3,
        maxGithubPages: 5,
        minLiveness,
      })

      this._totalCount.repo = fetcher.totalCount || 0
      this._lastRepoQuery = filterQuery
      const sorted = prepareRepoList(fetcher.items, filterQuery)
      cb.onRankedSections(prev => mergeSectionSlice(prev, 'repo', sorted.slice(0, pageSize)))
    } catch {
      // 静默
    } finally {
      cb.onState({ status: 'idle', hint: '', error: null })
    }
  }

  /**
   * 组合 issue 筛选（标签 + 难度 + star + 活跃度）
   * @param {object} filters - { labels, difficulty, minStars, maxStars, liveness }
   * @param {object} config
   * @param {object} cb
   */
  async combinedIssueFilterSearch(filters, config, cb) {
    const baseQuery = this._baseQuery
    if (!baseQuery) return
    const pageSize = config.pagination?.issuePageSize || 20
    const prefLang = config.filters?.preferredLanguage || 'any'

    cb.onState({ status: 'label_search', hint: '', error: null })

    try {
      const fetcher = this.issueFetcher
      const labelParts = []

      if (filters.labels?.size > 0) {
        for (const l of filters.labels) labelParts.push(`label:"${l}"`)
      }
      if (filters.difficulty === 'easy') {
        labelParts.push('label:"good first issue"')
      } else if (filters.difficulty === 'hard') {
        labelParts.push('label:"bug"')
      }

      const labelQuery = labelParts.length > 0
        ? `${baseQuery} ${labelParts.join(' ')}`
        : baseQuery

      const livenessMap = { active: 'active', maintained: 'maintained', inactive: 'inactive' }
      const minLiveness = livenessMap[filters.liveness] || 'maintained'

      await fetcher.fetchIssues(labelQuery, {
        keepSessionCache: true,
        minLiveness,
        fetchSize: 100,
        targetCount: pageSize,
        maxGithubPages: 5,
        stars: filters.minStars > 0 ? filters.minStars : undefined,
        maxStars: filters.maxStars > 0 ? filters.maxStars : undefined,
        onEnriched: () => {
          const sorted = prepareIssueList(fetcher.issues, prefLang)
          const issueSlice = sorted.slice(0, pageSize)
          this._totalCount.issue = fetcher.totalCount || 0
          cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', issueSlice))
        }
      })

      this._totalCount.issue = fetcher.totalCount || 0
      const sorted = prepareIssueList(fetcher.issues, prefLang)
      cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', sorted.slice(0, pageSize)))
    } catch {
      // 静默
    } finally {
      cb.onState({ status: 'idle', hint: '', error: null })
    }
  }

  /* ===== 内部工具 ===== */

  /**
   * 自动扩搜兜底（生产标准改造 P0-4）
   *
   * 当首屏结果太少时，逐步放宽过滤条件重试，保证"有结果、可切换、可继续探索"：
   *   1. 检查当前 rankedSections 各 tab 结果数
   *   2. 如果所有 GitHub 源（repo/issue/code）总和 < 3，触发扩搜
   *   3. 扩搜策略：去掉 minLiveness → 去掉 stars 过滤 → 去掉 language 过滤
   *   4. 用放宽后的条件重新拉一页，合并到 rankedSections
   *
   * @param {string} cleanQuery
   * @param {object} mergedFilters
   * @param {object} config
   * @param {number} gen
   * @param {object} cb
   */
  async _autoExpandIfNeeded(cleanQuery, mergedFilters, config, gen, cb, hadError = false) {
    if (gen !== this._gen) return
    // 搜索已出错时不要扩搜，避免 finally 把 error 状态覆盖回 idle
    if (hadError) return

    // 统计当前 GitHub 源结果数
    const currentRepoCount = this.repoFetcher.items.length
    const currentIssueCount = this.issueFetcher.items.length
    const totalGhResults = currentRepoCount + currentIssueCount

    // 阈值：GitHub 源总和 < 3 才扩搜（避免过度扩搜）
    const EXPAND_THRESHOLD = 3
    if (totalGhResults >= EXPAND_THRESHOLD) return

    console.debug(`[扩搜] 结果太少 (repo=${currentRepoCount}, issue=${currentIssueCount})，触发自动扩搜`)
    cb.onState({ status: 'expanding', hint: '结果较少，正在扩大搜索范围...', error: null })

    try {
      const pageSize = config.pagination?.issuePageSize || 20
      const prefLang = mergedFilters.preferredLanguage || 'any'

      // 策略 1：如果 issue 源有数据但被 liveness 过滤光了，用 minLiveness='any' 重拉
      if (currentIssueCount < 2 && this.issueFetcher.hasMore) {
        const relaxedFilters = { ...mergedFilters, minLiveness: 'any' }
        const fetcher = this.issueFetcher
        // 直接 fetchMore（不重置池子），用更宽松的过滤
        const oldMinLiveness = mergedFilters.minLiveness
        this._currentExpandFilters = relaxedFilters
        await fetcher.fetchMore(2).catch(() => {})
        if (gen !== this._gen) return
        const sorted = prepareIssueList(fetcher.issues, prefLang)
        const issueSlice = sorted.slice(0, pageSize)
        this._totalCount.issue = fetcher.totalCount || 0
        cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', issueSlice))
        console.debug(`[扩搜] issue 放宽 liveness 后: ${fetcher.items.length} 条`)
      }

      // 策略 2：如果 repo 源有数据但被 stars 过滤光了，去掉 stars 重拉
      if (currentRepoCount < 2 && this.repoFetcher.hasMore) {
        const fetcher = this.repoFetcher
        await fetcher.fetchMore(2).catch(() => {})
        if (gen !== this._gen) return
        const reranked = prepareRepoList(fetcher.items, this._lastRepoQuery)
        cb.onRankedSections(prev => mergeSectionSlice(prev, 'repo', reranked.slice(0, pageSize)))
        console.debug(`[扩搜] repo 续拉后: ${fetcher.items.length} 条`)
      }

      // 策略 3：如果还是太少，触发 L4 兜底扩词（如果 LLM 可用且未触发过）
      const stillLow = this.repoFetcher.items.length + this.issueFetcher.items.length < EXPAND_THRESHOLD
      if (stillLow && isLLMAvailable()) {
        try {
          // L4 加 3s 超时，避免 expanding 状态长时间挂起
          const L4_TIMEOUT = 3000
          const expanded = await Promise.race([
            analyzeIntent(cleanQuery),
            new Promise((resolve) => setTimeout(() => resolve(null), L4_TIMEOUT)),
          ])
          if (gen !== this._gen) return
          if (expanded?.expandedTerms?.length > 0) {
            // 用扩展词重新搜索（只搜 issue，因为 issue 最容易扩召回）
            const expandedQuery = expanded.queryRewrite || cleanQuery
            console.debug(`[扩搜] L4 扩词: ${expanded.expandedTerms.join(', ')}`)
            const fetcher = this.issueFetcher
            await fetcher.fetchIssues(expandedQuery, {
              minLiveness: 'any',
              fetchSize: 100,
              targetCount: pageSize,
              maxGithubPages: 3,
              keepSessionCache: true,
              onEnriched: () => {
                if (gen !== this._gen) return
                const sorted = prepareIssueList(fetcher.issues, prefLang)
                cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', sorted.slice(0, pageSize)))
              }
            }).catch(() => {})
            if (gen !== this._gen) return
            const sorted = prepareIssueList(fetcher.issues, prefLang)
            cb.onRankedSections(prev => mergeSectionSlice(prev, 'issue', sorted.slice(0, pageSize)))
          }
        } catch { /* L4 失败不阻塞 */ }
      }
    } catch (err) {
      console.warn('[扩搜] 失败:', err.message)
    } finally {
      if (gen === this._gen) {
        cb.onState({ status: 'idle', hint: '', error: null })
      }
    }
  }

  /**
   * L2-L4 LLM 路由降级链（串行）
   * L2: embedding 匹配历史意图
   * L3: 轻量模型分析
   * L4: 全量模型分析
   * 返回 { ...result, _usedTier } 或 null
   */
  async _runLLMRouting(cleanQuery, gen, cb) {
    // L2 + L3 并行竞速，谁先返回用谁
    let result = null
    try {
      const [l2, l3] = await Promise.allSettled([
        matchIntentByEmbedding(cleanQuery),
        analyzeIntentLight(cleanQuery),
      ])
      if (gen !== this._gen) return null

      // L2 优先（embedding 匹配更快更准）
      if (l2.status === 'fulfilled' && l2.value) {
        l2.value._usedTier = 'L2'
        return l2.value
      }
      if (l3.status === 'fulfilled' && l3.value) {
        l3.value._usedTier = 'L3'
        return l3.value
      }
    } catch { /* 静默降级 */ }
    if (gen !== this._gen) return null

    // L4: 全量模型兜底
    cb.onState({ status: 'searching', hint: 'AI 深度分析中...', error: null })
    try {
      result = await analyzeIntent(cleanQuery)
      if (result) result._usedTier = 'L4'
    } catch { /* 静默降级 */ }
    if (gen !== this._gen) return null
    return result
  }

  /**
   * 检测搜索词中的语言（从原 SearchPage 内联逻辑迁移）
   * @param {string} q
   * @returns {string[]}
   */
  _detectLanguages(q) {
    return detectLanguages(q)
  }
}
