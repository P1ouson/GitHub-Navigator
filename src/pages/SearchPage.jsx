/**
 * SearchPage — 搜索页面壳层
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 职责边界（约束）                                                     │
 * │                                                                      │
 * │ 本页面只负责：                                                       │
 * │   - 接收用户输入（搜索框 / 配置面板 / 热门搜索）                      │
 * │   - 管理页面级 UI 状态（筛选 / 分页 / 快照）                          │
 * │   - 调 useSearchOrchestrator hook 发起搜索                            │
 * │   - 派生筛选栏统计数据（useMemo）                                     │
 * │   - 渲染结果容器 + 组合子组件                                         │
 * │                                                                      │
 * │ 本页面不允许：                                                        │
 * │   - 直接发网络请求（必须走 orchestrator）                             │
 * │   - 做 schema normalize / _type 打标（留 builder）                    │
 * │   - 做意图路由 / 搜索源分流（留 orchestrator）                        │
 * │   - 做错误归一化（留 errors.js 公共模块）                             │
 * │   - 直接操作 fetcher 内部态                                           │
 * │   - 直接 setRankedSections 操作主渲染源（必须走 orchestrator 方法）   │
 * │   - 做 label 颜色 / liveness class 等 UI 样式计算（留 searchUi.js）    │
 * │                                                                      │
 * │ 单一主渲染源：rankedSections                                          │
 * │   issueItems / repoItems 仅供筛选栏统计，不驱动结果列表               │
 * └──────────────────────────────────────────────────────────────────────┘
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { INTENT_LABELS } from '../lib/intent.js'
import { loadConfig, saveConfig, DEFAULT_CONFIG } from '../lib/searchConfig.js'
import { usePersistState } from '../lib/pageCache.js'
import { issueDifficulty } from '../lib/beginnerScore.js'
import { aggregateLanguages, aggregateTopics, POPULAR_LANGUAGES } from '../lib/languages.js'
import { isBeginnerLabel } from '../lib/issueLabels.js'
import { useSearchOrchestrator } from '../lib/search/useSearchOrchestrator.js'
import SearchConfigPanel from '../components/SearchConfigPanel.jsx'
import { RankedSection, KnowledgeSection } from '../components/search/ResultItems.jsx'
import { FilterPanel } from '../components/search/FilterPanel.jsx'
import { getSectionTitle } from '../lib/searchRanker.js'
import { renderMarkdown } from '../lib/markdown.js'

const TAB_CONFIG = [
  { key: 'repo', icon: '📦', label: '仓库' },
  { key: 'issue', icon: '📌', label: 'Issue' },
  { key: 'code', icon: '📝', label: '代码' },
  { key: 'github', icon: '🐙', label: 'GitHub' },
  { key: 'web', icon: '🌐', label: '网页' },
]

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = usePersistState('search', 'query', searchParams.get('q') || '')
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const configRef = useRef(DEFAULT_CONFIG)

  // ===== 搜索编排 hook =====
  const search = useSearchOrchestrator()
  const {
    rankedSections, results, intent, activeTab, ragAnswer,
    state, setActiveTab,
    search: doSearch, loadMore, fetchMoreForFilter, fetchMoreForIssueFilter,
    repoFilterSearch, resetRepoFilter, issueDifficultySearch,
    labelSearch, resetLabelFilter,
    preloadIfNeeded, restoreFromCache,
    issueItems, repoItems, lockedLanguages, getTotalCount, hasMore,
  } = search

  // ===== 纯 UI 筛选状态（留页面）=====
  const [issueLabelFilter, setIssueLabelFilter] = usePersistState('search', 'issueLabelFilter', () => new Set())
  const [issueLanguageFilter, setIssueLanguageFilter] = usePersistState('search', 'issueLanguageFilter', () => new Set())
  const [repoLanguageFilter, setRepoLanguageFilter] = usePersistState('search', 'repoLanguageFilter', () => new Set())
  const [topicFilter, setTopicFilter] = usePersistState('search', 'topicFilter', () => new Set())
  const [difficultyFilter, setDifficultyFilter] = usePersistState('search', 'difficultyFilter', () => new Set())
  const [showAllLangs, setShowAllLangs] = usePersistState('search', 'showAllLangs', false)
  const [issuePage, setIssuePage] = usePersistState('search', 'issuePage', 1)
  const [repoPage, setRepoPage] = usePersistState('search', 'repoPage', 1)
  // 当前选中的搜索类型（!repo/!issue/!code/!qa），独立于输入框内容
  // 选中态只控制按钮高亮 + 提交时自动拼接，不写入输入框
  const [selectedType, setSelectedType] = useState(null)
  // repo 筛选加载锁：防止 useEffect 并发触发 fetchMoreForFilter
  const filterLoadingRef = useRef(false)
  // 搜索框引用（用于 bang 按钮点击后聚焦）
  const inputRef = useRef(null)

  // 从 URL q 中拆出 bang 前缀 → selectedType，剩余作为输入框内容
  const splitBang = (q) => {
    const m = /^(!\S+)\s+(.*)$/.exec(q || '')
    if (m) return { bang: m[1], rest: m[2] }
    return { bang: null, rest: q || '' }
  }

  useEffect(() => {
    loadConfig().then(c => { setConfig(c); configRef.current = c })
  }, [])

  function handleConfigChange(newConfig) {
    setConfig(newConfig)
    configRef.current = newConfig
    saveConfig(newConfig)
  }

  function handleApplyConfig() {
    const q = searchParams.get('q')
    if (q) {
      // 直接调用 doSearch，不依赖 setSearchParams 触发（相同 q 值会被去重）
      setIssueLanguageFilter(new Set())
      setRepoLanguageFilter(new Set())
      setTopicFilter(new Set())
      setIssueLabelFilter(new Set())
      setDifficultyFilter(new Set())
      setIssuePage(1)
      setRepoPage(1)
      doSearch(q, configRef.current)
    }
  }

  // URL 参数变化 → 触发搜索
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) {
      restoreOrSearch(q)
    }
  }, [searchParams, doSearch])

  // 无 URL 参数时，从缓存恢复最近搜索（切页回来场景）
  // 只从缓存恢复，不发新搜索——用户切回来就是要看之前的结果
  useEffect(() => {
    const q = searchParams.get('q')
    if (!q) {
      const lastQ = sessionStorage.getItem('lastSearchQuery')
      if (lastQ) {
        const cacheKey = `search_${lastQ}`
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
          try {
            const { data, ts } = JSON.parse(cached)
            if (Date.now() - ts < 5 * 60 * 1000) {
              restoreFromCache(data)
              const { bang, rest } = splitBang(lastQ)
              setSelectedType(bang)
              setQuery(rest)
              return
            }
          } catch {}
        }
        // 缓存不存在或已过期：恢复查询文本但不重新搜索，让用户看到之前搜了什么
        const { bang, rest } = splitBang(lastQ)
        setSelectedType(bang)
        setQuery(rest)
      }
    }
  }, [])  // 只在挂载时执行一次

  function restoreOrSearch(q) {
    // 缓存检查（5min TTL）
    const cacheKey = `search_${q}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached)
        if (Date.now() - ts < 5 * 60 * 1000) {
          // 检查缓存是否有效：rankedSections 非 null（搜索已完成，即使结果为空也是有效状态）、
          // knowledge 有内容、或 ragAnswer 有答案
          const hasContent =
            (data.rankedSections != null) ||
            (data.results && data.results.knowledge && data.results.knowledge.length > 0) ||
            (data.ragAnswer && data.ragAnswer.answer)
          if (hasContent) {
            restoreFromCache(data)
            const { bang, rest } = splitBang(q)
            setSelectedType(bang)
            setQuery(rest)
            return
          }
        }
      } catch {}
    }
    // 缓存不存在、过期、或为空 → 执行新搜索

    const { bang, rest } = splitBang(q)
    setSelectedType(bang)
    setQuery(rest)
    // 新搜索时重置筛选状态
    setIssueLanguageFilter(new Set())
    setRepoLanguageFilter(new Set())
    setTopicFilter(new Set())
    setIssueLabelFilter(new Set())
    setDifficultyFilter(new Set())
    setIssuePage(1)
    setRepoPage(1)
    doSearch(q, configRef.current)
  }

  // 自动预加载：接近末页时后台续拉
  useEffect(() => {
    if (!['issue', 'repo'].includes(activeTab)) return
    if (state.status !== 'idle') return
    const currentPage = activeTab === 'issue' ? issuePage : repoPage
    preloadIfNeeded(activeTab, currentPage, configRef.current)
  }, [issuePage, repoPage, activeTab, state.status, preloadIfNeeded])

  // repo 筛选自动加载（移至 filteredRepoItems 定义之后，依赖筛选后实际结果数）

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!query.trim()) return
    // 拼接选中类型：selectedType + query → 实际搜索词
    const fullQ = selectedType ? `${selectedType} ${query.trim()}` : query.trim()
    setSearchParams({ q: fullQ })
  }

  const handleSearchBtn = (q) => setSearchParams({ q })

  // 类型按钮：点击切换选中态（再点一次取消），不修改输入框内容
  // 已有正文且选中 → 立即搜索；无正文 → 聚焦输入框等待输入
  const toggleType = (bang) => {
    const next = selectedType === bang ? null : bang
    setSelectedType(next)
    if (next && query.trim()) {
      setSearchParams({ q: `${next} ${query.trim()}` })
    } else if (!next && selectedType) {
      // 取消选中时，若输入框有内容则用纯 query 重搜
      if (query.trim()) setSearchParams({ q: query.trim() })
    } else {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  // ===== 派生数据（供筛选栏）=====
  const cfg = configRef.current
  const pageSize = cfg.pagination?.issuePageSize || 20

  const labelCounts = useMemo(() => {
    const counts = new Map()
    for (const issue of issueItems) {
      if (!issue.labels) continue
      for (const l of issue.labels) {
        const key = (l.name || '').toLowerCase()
        if (!key) continue
        const existing = counts.get(key)
        if (existing) existing.count++
        else counts.set(key, { name: l.name, count: 1, color: l.color })
      }
    }
    return counts
  }, [issueItems, issueItems.length])
  const allLabels = useMemo(() => [...labelCounts.values()].sort((a, b) => b.count - a.count), [labelCounts])
  const beginnerLabels = useMemo(() => allLabels.filter(l => isBeginnerLabel(l.name)), [allLabels])
  const otherLabels = useMemo(() => allLabels.filter(l => !isBeginnerLabel(l.name)).slice(0, 15), [allLabels])
  const issueLanguages = useMemo(() => aggregateLanguages(issueItems, 'issue'), [issueItems, issueItems.length])
  const issueDifficulties = useMemo(() => {
    const diffs = [
      { key: 'easy', label: '🟢 简单', count: 0 },
      { key: 'medium', label: '🟡 中等', count: 0 },
      { key: 'hard', label: '🔴 困难', count: 0 },
      { key: 'unknown', label: '⚪ 未知', count: 0 },
    ]
    for (const issue of issueItems) {
      const d = issueDifficulty(issue)
      const item = diffs.find(x => x.key === d)
      if (item) item.count++
    }
    return diffs
  }, [issueItems, issueItems.length])

  const repoLanguages = useMemo(() => aggregateLanguages(repoItems, 'repo'), [repoItems, repoItems.length])
  const repoTopics = useMemo(() => aggregateTopics(repoItems), [repoItems, repoItems.length])

  // ===== 筛选逻辑 =====
  // repo：API 筛选后 pool 中直接就是最终结果，无需客户端过滤
  const filteredRepoItems = repoItems

  // issue：仅语言筛选保留客户端过滤（API 不支持），标签和难度已由 API 处理
  const filteredIssueItems = useMemo(() => {
    if (issueLanguageFilter.size === 0) return issueItems
    return issueItems.filter(issue => {
      if (!issue._repoHealth) return true
      const lang = issue._repoHealth.language
      if (!lang || !issueLanguageFilter.has(lang)) return false
      return true
    })
  }, [issueItems, issueItems.length, issueLanguageFilter])

  // repo 筛选自动加载：API 筛选后结果不足 pageSize 时拉更多
  useEffect(() => {
    if (activeTab !== 'repo') return
    if (filterLoadingRef.current) return
    if (state.status !== 'idle') return
    if (repoLanguageFilter.size === 0 && topicFilter.size === 0) return
    if (filteredRepoItems.length >= pageSize) return
    if (!hasMore('repo')) return

    filterLoadingRef.current = true
    fetchMoreForFilter(configRef.current).finally(() => {
      filterLoadingRef.current = false
    })
  }, [activeTab, state.status, filteredRepoItems.length, repoLanguageFilter, topicFilter, pageSize, hasMore, fetchMoreForFilter])

  // ===== 渲染派生 =====
  const currentTabItems = rankedSections && activeTab ? rankedSections[activeTab] : null
  const currentFilteredItems = activeTab === 'issue' ? filteredIssueItems
    : activeTab === 'repo' ? filteredRepoItems
    : (currentTabItems || [])
  // poolTotal 用过滤后实际可显示条数，避免"已加载100条但实际为空"的数字不准
  const poolTotal = currentFilteredItems.length
  const showPagination = state.status === 'idle' && ['issue', 'repo'].includes(activeTab) && poolTotal > 0
  const totalPages = Math.max(1, Math.ceil(poolTotal / pageSize))
  const totalCount = getTotalCount(activeTab)
  const showTotalCount = state.status === 'idle' && totalCount > 0
  const currentPage = activeTab === 'issue' ? issuePage : activeTab === 'repo' ? repoPage : 1

  // 筛选后 pool 缩小时，若 currentPage 超出 totalPages 则重置为 1
  useEffect(() => {
    if (currentPage > totalPages) {
      if (activeTab === 'issue') setIssuePage(1)
      else if (activeTab === 'repo') setRepoPage(1)
    }
  }, [currentPage, totalPages, activeTab])

  // 统一翻页
  const handlePageChange = useCallback(async (newPage) => {
    if (newPage < 1 || state.status === 'loading_more') return
    const totalP = Math.max(1, Math.ceil(poolTotal / pageSize))
    if (newPage > totalP) return
    const cfg = configRef.current
    const isIssue = activeTab === 'issue'
    if (isIssue) setIssuePage(newPage)
    else setRepoPage(newPage)
    await loadMore(activeTab, newPage, cfg)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeTab, state.status, loadMore, poolTotal, pageSize])

  // issue 语言筛选自动加载：仅语言筛选保留客户端过滤，不足时补数据
  const issueFilterLoadingRef = useRef(false)
  useEffect(() => {
    if (activeTab !== 'issue') return
    if (issueFilterLoadingRef.current) return
    if (state.status !== 'idle') return
    if (issueLanguageFilter.size === 0) return
    if (filteredIssueItems.length >= pageSize) return
    if (!hasMore('issue')) return

    issueFilterLoadingRef.current = true
    fetchMoreForIssueFilter(configRef.current).finally(() => {
      issueFilterLoadingRef.current = false
    })
  }, [activeTab, state.status, filteredIssueItems.length, issueLanguageFilter, pageSize, hasMore, fetchMoreForIssueFilter])

  // ===== loading 文案映射 =====
  const isLoading = state.status === 'searching' || state.status === 'label_search' || state.status === 'repo_filter' || state.status === 'expanding'
  const isLoadingMore = state.status === 'loading_more'
  const exhausted = !hasMore(activeTab)

  return (
    <section className="section search-page">
      <div className="section-inner">
        <form className="search-box" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="search-box-input"
            type="text"
            placeholder="搜索仓库、Issue、代码，或问一个 GitHub 问题..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button className="search-box-btn" type="submit">搜索</button>
        </form>

        {/* 搜索类型快捷按钮：点击切换选中态（高亮），不写入输入框 */}
        <div className="search-type-bar">
          <span className="search-type-label">类型：</span>
          <button className={`search-type-btn ${selectedType === '!repo' ? 'active' : ''}`} onClick={() => toggleType('!repo')}>!repo</button>
          <button className={`search-type-btn ${selectedType === '!issue' ? 'active' : ''}`} onClick={() => toggleType('!issue')}>!issue</button>
          <button className={`search-type-btn ${selectedType === '!code' ? 'active' : ''}`} onClick={() => toggleType('!code')}>!code</button>
          <button className={`search-type-btn ${selectedType === '!qa' ? 'active' : ''}`} onClick={() => toggleType('!qa')}>!qa</button>
        </div>

        <SearchConfigPanel config={config} onChange={handleConfigChange} onApply={handleApplyConfig} />

        {/* 空状态 */}
        {!isLoading && !intent && !rankedSections && (
          <div className="search-empty-layout">
            <div className="search-empty-left">
              <div className="empty-welcome">
                <div className="empty-welcome-title">在 GitHub 上找到你的第一个贡献</div>
                <div className="empty-welcome-desc">
                  搜索 Issue 找任务、搜索仓库找项目、搜索代码学实现，或直接问一个 GitHub 相关问题
                </div>
              </div>
              <div className="empty-search-tips">
                <div className="empty-hot-title">搜索技巧</div>
                <div className="search-tips-grid">
                  <div className="search-tip-item"><code>!repo react</code><span>只搜仓库</span></div>
                  <div className="search-tip-item"><code>!issue python</code><span>只搜 Issue</span></div>
                  <div className="search-tip-item"><code>!code async</code><span>只搜代码</span></div>
                  <div className="search-tip-item"><code>owner/repo</code><span>直接分析仓库</span></div>
                </div>
              </div>
            </div>
            <div className="search-empty-right">
              <div className="empty-hot-searches">
                <div className="empty-hot-title">热门搜索</div>
                <div className="empty-hot-grid">
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('good first issue')}>
                    <span className="empty-hot-icon">🟢</span><span className="empty-hot-label">Good First Issue</span><span className="empty-hot-desc">新手入门任务</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('help wanted')}>
                    <span className="empty-hot-icon">🆘</span><span className="empty-hot-label">Help Wanted</span><span className="empty-hot-desc">社区求助问题</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('Python 开源项目')}>
                    <span className="empty-hot-icon">🐍</span><span className="empty-hot-label">Python 开源项目</span><span className="empty-hot-desc">发现 Python 仓库</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('React 开源项目')}>
                    <span className="empty-hot-icon">⚛️</span><span className="empty-hot-label">React 开源项目</span><span className="empty-hot-desc">前端框架仓库</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('什么是 Fork')}>
                    <span className="empty-hot-icon">❓</span><span className="empty-hot-label">什么是 Fork</span><span className="empty-hot-desc">学习 Git 基础</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('Rust 新手 issue')}>
                    <span className="empty-hot-icon">🦀</span><span className="empty-hot-label">Rust 新手 Issue</span><span className="empty-hot-desc">Rust 入门贡献</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('JavaScript 活跃项目')}>
                    <span className="empty-hot-icon">🟨</span><span className="empty-hot-label">JavaScript 活跃项目</span><span className="empty-hot-desc">前端生态</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('Go 开源项目')}>
                    <span className="empty-hot-icon">🔵</span><span className="empty-hot-label">Go 开源项目</span><span className="empty-hot-desc">云原生项目</span>
                  </button>
                  <button className="empty-hot-card" onClick={() => handleSearchBtn('如何提 PR')}>
                    <span className="empty-hot-icon">📖</span><span className="empty-hot-label">如何提 PR</span><span className="empty-hot-desc">贡献流程指南</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="search-meta">
          <div className="search-meta-right">
            {intent && <span className="intent-tag">{INTENT_LABELS[intent]}</span>}
          </div>
        </div>

        {/* 状态区 */}
        {isLoading && <div className="search-status">搜索中...</div>}
        {isLoadingMore && <div className="search-status search-status-sub">正在加载更多...</div>}
        {state.error && <div className="search-status error">{state.error}</div>}
        {!isLoading && !isLoadingMore && !state.error && !state.ragLoading && !ragAnswer && intent && rankedSections &&
         !results.knowledge && currentFilteredItems.length === 0 &&
         !Object.values(rankedSections).some(arr => arr && arr.length > 0) && (
          <div className="search-status">无结果</div>
        )}

        {/* 零结果提示（用 currentFilteredItems 判断，非 rankedSections）*/}
        {!isLoading && !isLoadingMore && !state.error && activeTab === 'issue' && currentFilteredItems.length === 0 && (
          <div className="search-status">
            {getTotalCount('issue') > 0
              ? `GitHub 约 ${getTotalCount('issue')} 条匹配，但经健康度过滤后暂无结果。请放宽活跃度筛选（!minLiveness:any）或检查 Token。`
              : 'GitHub 无匹配结果，请换关键词搜索'}
          </div>
        )}
        {!isLoading && !isLoadingMore && !state.error && activeTab === 'repo' && currentFilteredItems.length === 0 && intent === 'repo' && (
          <div className="search-status">
            未找到匹配仓库。可试 !repo Python language:Python stars:&gt;50，或检查 Token/代理。
          </div>
        )}

        {/* 过滤摘要 */}
        {!isLoading && activeTab === 'issue' && issueItems.length > 0 && (
          <div className="search-filter-summary">
            GitHub 约 {(getTotalCount('issue') || 0).toLocaleString()} 条匹配
          </div>
        )}
        {!isLoading && activeTab === 'repo' && repoItems.length > 0 && (
          <div className="search-filter-summary">
            GitHub 约 {(getTotalCount('repo') || 0).toLocaleString()} 条匹配
          </div>
        )}

        {showTotalCount && !['issue', 'repo'].includes(activeTab) && (
          <div className="total-count-bar">
            GitHub 共搜索到约 <strong>{totalCount.toLocaleString()}</strong> 条结果
          </div>
        )}

        {/* RAG AI 问答 */}
        {(state.ragLoading || ragAnswer) && !isLoading && (
          <div className="rag-answer-section">
            <div className="rag-answer-header">
              <span className="rag-answer-icon">AI</span>
              <span className="rag-answer-title">智能问答</span>
              {state.ragLoading && <span className="rag-answer-loading">生成中...</span>}
            </div>
            {ragAnswer && (
              <>
                <div className="rag-answer-body markdown-body">
                  {renderMarkdown(ragAnswer.answer)}
                </div>
                {ragAnswer.sources?.length > 0 && (
                  <div className="rag-answer-sources">
                    <span className="rag-sources-label">参考来源：</span>
                    {ragAnswer.sources.map((s, i) => (
                      <span key={i} className="rag-source-tag">{s.title}</span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 知识库 */}
        {!isLoading && results.knowledge && (
          <KnowledgeSection items={results.knowledge} />
        )}

        {/* Tab 栏 */}
        {!isLoading && rankedSections && (
          <div className="result-tabs">
            {TAB_CONFIG.map(({ key, icon, label }) => {
              const count = rankedSections[key]?.length || 0
              if (!count && activeTab !== key) return null
              return (
                <button
                  key={key}
                  className={`result-tab${activeTab === key ? ' active' : ''}`}
                  onClick={() => { setActiveTab(key); setIssuePage(1); setRepoPage(1) }}
                >
                  {icon} {label}
                </button>
              )
            })}
          </div>
        )}

        {/* 主体布局（筛选时不隐藏，保持旧结果可见 + 顶部提示加载中）*/}
        {!isLoading && rankedSections && activeTab && ['issue', 'repo'].includes(activeTab) && (issueItems.length > 0 || repoItems.length > 0) && (
          <div className="search-layout">
            <aside className="search-sidebar">
              {activeTab === 'issue' && issueItems.length > 0 && (
                <FilterPanel
                  type="issue"
                  onClearAll={() => {
                    setIssueLabelFilter(new Set())
                    setIssueLanguageFilter(new Set(lockedLanguages))
                    setDifficultyFilter(new Set())
                    setIssuePage(1)
                    doSearch(searchParams.get('q'), configRef.current)
                  }}
                  sections={[
                    {
                      title: '难度',
                      items: issueDifficulties.filter(d => d.count > 0).map(d => ({ key: d.key, name: d.label })),
                      selected: difficultyFilter,
                      onToggle: (key) => {
                        const next = new Set(difficultyFilter)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        setDifficultyFilter(next)
                        setIssuePage(1)
                        if (next.size > 0) {
                          issueDifficultySearch(next, configRef.current)
                        } else {
                          resetLabelFilter(configRef.current)
                        }
                      },
                    },
                    {
                      title: '语言',
                      items: issueLanguages.map(l => ({ key: l.name, name: l.name })),
                      selected: issueLanguageFilter,
                      onToggle: (key) => {
                        if (lockedLanguages.has(key) && issueLanguageFilter.has(key)) return
                        const next = new Set(issueLanguageFilter)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        setIssueLanguageFilter(next)
                        setIssuePage(1)
                      },
                      popularKeys: new Set(POPULAR_LANGUAGES),
                      showAll: showAllLangs,
                      onToggleShowAll: () => setShowAllLangs(v => !v),
                      lockedKeys: lockedLanguages,
                    },
                    beginnerLabels.length > 0 ? {
                      title: '新手友好标签',
                      items: beginnerLabels.map(l => ({ key: l.name.toLowerCase(), name: l.name, color: l.color })),
                      selected: issueLabelFilter,
                      onToggle: (key) => {
                        const next = new Set(issueLabelFilter)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        setIssueLabelFilter(next)
                        setIssuePage(1)
                        if (next.size > 0) {
                          labelSearch(next, configRef.current)
                        } else {
                          resetLabelFilter(configRef.current)
                        }
                      },
                    } : null,
                    otherLabels.length > 0 ? {
                      title: '其他标签',
                      items: otherLabels.map(l => ({ key: l.name.toLowerCase(), name: l.name, color: l.color })),
                      selected: issueLabelFilter,
                      onToggle: (key) => {
                        const next = new Set(issueLabelFilter)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        setIssueLabelFilter(next)
                        setIssuePage(1)
                        if (next.size > 0) {
                          labelSearch(next, configRef.current)
                        } else {
                          resetLabelFilter(configRef.current)
                        }
                      },
                    } : null,
                  ].filter(Boolean)}
                />
              )}
              {activeTab === 'repo' && repoItems.length > 0 && (
                <FilterPanel
                  type="repo"
                  onClearAll={() => {
                    setRepoLanguageFilter(new Set(lockedLanguages))
                    setTopicFilter(new Set())
                    setRepoPage(1)
                    doSearch(searchParams.get('q'), configRef.current)
                  }}
                  sections={[
                    {
                      title: '语言',
                      items: repoLanguages.map(l => ({ key: l.name, name: l.name })),
                      selected: repoLanguageFilter,
                      onToggle: (key) => {
                        if (lockedLanguages.has(key) && repoLanguageFilter.has(key)) return
                        const next = new Set(repoLanguageFilter)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        setRepoLanguageFilter(next)
                        setRepoPage(1)
                        if (next.size > 0 || topicFilter.size > 0) {
                          repoFilterSearch(next, topicFilter, configRef.current)
                        } else {
                          doSearch(searchParams.get('q'), configRef.current)
                        }
                      },
                      popularKeys: new Set(POPULAR_LANGUAGES),
                      showAll: showAllLangs,
                      onToggleShowAll: () => setShowAllLangs(v => !v),
                      lockedKeys: lockedLanguages,
                    },
                    repoTopics.length > 0 ? {
                      title: '主题',
                      items: repoTopics.map(t => ({ key: t.name, name: t.name })),
                      selected: topicFilter,
                      onToggle: (key) => {
                        const next = new Set(topicFilter)
                        if (next.has(key)) next.delete(key)
                        else next.add(key)
                        setTopicFilter(next)
                        setRepoPage(1)
                        if (repoLanguageFilter.size > 0 || next.size > 0) {
                          repoFilterSearch(repoLanguageFilter, next, configRef.current)
                        } else {
                          doSearch(searchParams.get('q'), configRef.current)
                        }
                      },
                    } : null,
                  ].filter(Boolean)}
                />
              )}
            </aside>

            {currentFilteredItems.length > 0 && (
            <div className="search-content">
              <RankedSection
                title={getSectionTitle(activeTab)}
                items={currentFilteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize)}
              />
              {isLoadingMore && currentFilteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize).length === 0 && (
                <div className="search-loading-more">加载更多数据中...</div>
              )}
            </div>
            )}
          </div>
        )}

        {/* 非 issue/repo tab */}
        {!isLoading && rankedSections && activeTab && !['issue', 'repo'].includes(activeTab) && (
          <RankedSection
            title={getSectionTitle(activeTab)}
            items={currentFilteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize)}
          />
        )}

        {/* 分页 */}
        {showPagination && (
          <div className="search-pagination">
            <button className="pagination-btn" disabled={isLoading || isLoadingMore || currentPage <= 1} onClick={() => handlePageChange(currentPage - 1)}>
              上一页
            </button>
            <span className="pagination-info">
              第 {currentPage} / {totalPages} 页 · 已加载 {poolTotal} 条
              {isLoadingMore ? ' · 加载中...' : exhausted ? '' : ' · 翻页可继续加载'}
            </span>
            <button className="pagination-btn" disabled={isLoading || isLoadingMore || currentPage >= totalPages || (currentPage * pageSize >= poolTotal && exhausted)} onClick={() => handlePageChange(currentPage + 1)}>
              下一页
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
