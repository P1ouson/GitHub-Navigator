/**
 * useSearchOrchestrator
 *
 * React hook 封装 SearchOrchestrator，提供 SearchPage 可直接消费的
 * 状态 + 操作接口。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 职责边界（约束）                                                     │
 * │                                                                      │
 * │ 本层负责：                                                           │
 * │   - 持有 orchestrator 实例（useRef，跨渲染稳定）                      │
 * │   - 把 orchestrator 的回调映射为 React state 更新                     │
 * │   - 暴露主渲染源 rankedSections + 派生态状态                          │
 * │   - 保证"单一渲染源"的状态收口                                        │
 * │                                                                      │
 * │ 本层不允许：                                                          │
 * │   - 业务编排（调 GitHub API / 意图路由等，留 orchestrator）            │
 * │   - UI 样式计算（留 searchUi.js）                                     │
 * │   - 筛选栏统计聚合（留 useSearchFilterStats 或页面 useMemo）           │
 * │   - 直接操作 fetcher 内部态                                           │
 * │                                                                      │
 * │ 返回值契约（SearchPage 消费的稳定接口）：                              │
 * │   主渲染源：rankedSections（唯一驱动结果列表）                         │
 * │   派生展示：results（knowledge section）/ intent / activeTab / ragAnswer│
 * │   状态：state { status, hint, error, ragLoading }                     │
 * │   操作：search / labelSearch / loadMore / fetchMoreForFilter /        │
 * │         resetLabelFilter / preloadIfNeeded                            │
 * │   派生数据（筛选栏用）：issueItems / repoItems / lockedLanguages /     │
 * │                       originalIssue / getTotalCount / hasMore          │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { useState, useRef, useCallback, useMemo } from 'react'
import { SearchOrchestrator } from './searchOrchestrator.js'
import { INITIAL_SEARCH_STATE } from './searchState.js'

export function useSearchOrchestrator() {
  // orchestrator 实例（跨渲染稳定）
  const orchestratorRef = useRef(null)
  if (!orchestratorRef.current) {
    orchestratorRef.current = new SearchOrchestrator()
  }
  const orch = orchestratorRef.current

  // ===== 主渲染源 + 派生态状态 =====
  // 注意：这些是搜索结果状态，不持久化。
  // 原因：orchestrator 实例（持有数据池）不持久化，如果只持久化渲染快照会导致
  //       切走再切回来时"intent/activeTab 有值但 repoItems/issueItems 池空"，
  //       UI 误显示"未找到匹配仓库"。切回来后由 URL ?q= 驱动重新搜索。
  const [rankedSections, setRankedSections] = useState(null)
  const [results, setResults] = useState({})
  const [intent, setIntent] = useState(null)
  const [activeTab, setActiveTab] = useState(null)
  const [ragAnswer, setRagAnswer] = useState(null)

  // 搜索状态（非持久化）
  const [state, setState] = useState(INITIAL_SEARCH_STATE)

  // 回调集合（稳定引用）
  const cb = useMemo(() => ({
    onState: (partial) => setState(prev => ({ ...prev, ...partial })),
    onResults: (results) => {
      const val = typeof results === 'function' ? results(orch._results) : results
      orch._results = val
      setResults(val)
    },
    onRankedSections: (sections) => {
      const val = typeof sections === 'function' ? sections(orch._rankedSections) : sections
      orch._rankedSections = val
      setRankedSections(val)
    },
    onIntent: (intent) => { orch._intent = intent; setIntent(intent); },
    onActiveTab: (tab) => { orch._activeTab = tab; setActiveTab(tab); },
    onRagAnswer: (answer) => {
      const val = typeof answer === 'function' ? answer(orch._ragAnswer) : answer
      orch._ragAnswer = val
      setRagAnswer(val)
    },
    onRagLoading: (loading) => setState(prev => ({ ...prev, ragLoading: loading })),
  }), [setResults, setRankedSections, setIntent, setActiveTab, setRagAnswer])

  // ===== 操作接口 =====
  const search = useCallback((q, config) => {
    return orch.search(q, config, cb)
  }, [orch, cb])

  const labelSearch = useCallback((labels, config) => {
    return orch.labelSearch(labels, config, cb)
  }, [orch, cb])

  const loadMore = useCallback((tab, newPage, config) => {
    return orch.loadMore(tab, newPage, config, cb)
  }, [orch, cb])

  const fetchMoreForFilter = useCallback((config) => {
    return orch.fetchMoreForFilter(config, cb)
  }, [orch, cb])

  const fetchMoreForIssueFilter = useCallback((config) => {
    return orch.fetchMoreForIssueFilter(config, cb)
  }, [orch, cb])

  const repoFilterSearch = useCallback((languages, topics, config) => {
    return orch.repoFilterSearch(languages, topics, config, cb)
  }, [orch, cb])

  const resetRepoFilter = useCallback((config) => {
    return orch.resetRepoFilter(config, cb)
  }, [orch, cb])

  const issueDifficultySearch = useCallback((difficulties, config) => {
    return orch.issueDifficultySearch(difficulties, config, cb)
  }, [orch, cb])

  const resetLabelFilter = useCallback((config) => {
    return orch.resetLabelFilter(config, cb)
  }, [orch, cb])

  const parseAiFilterIntent = useCallback((userInput) => {
    return orch.parseAiFilterIntent(userInput)
  }, [orch])

  const combinedRepoFilterSearch = useCallback((filters, config) => {
    return orch.combinedRepoFilterSearch(filters, config, cb)
  }, [orch, cb])

  const combinedIssueFilterSearch = useCallback((filters, config) => {
    return orch.combinedIssueFilterSearch(filters, config, cb)
  }, [orch, cb])

  const preloadIfNeeded = useCallback((tab, currentPage, config) => {
    return orch.preloadIfNeeded(tab, currentPage, config)
  }, [orch, cb])

  const restoreFromCache = useCallback((data) => {
    // 恢复渲染快照
    if (data.rankedSections) {
      orch._rankedSections = data.rankedSections
      setRankedSections(data.rankedSections)
    }
    if (data.results) {
      orch._results = data.results
      setResults(data.results)
    }
    if (data.intent != null) {
      orch._intent = data.intent
      setIntent(data.intent)
    }
    if (data.activeTab != null) {
      orch._activeTab = data.activeTab
      setActiveTab(data.activeTab)
    }
    if (data.ragAnswer != null) {
      orch._ragAnswer = data.ragAnswer
      setRagAnswer(data.ragAnswer)
    }
    // 恢复 fetcher 数据池（repoItems / issueItems 等）
    orch.restoreItems(data)
    setState(prev => ({ ...prev, status: 'idle', hint: '', error: null }))
  }, [])

  // ===== 派生数据（供页面筛选栏）=====
  const issueItems = orch.issueItems
  const repoItems = orch.repoItems
  const issueStats = orch.issueStats
  const lockedLanguages = orch.lockedLanguages

  return {
    // 主渲染源
    rankedSections,
    results,
    intent,
    activeTab,
    ragAnswer,
    // 状态
    state,
    // 操作
    search,
    labelSearch,
    resetLabelFilter,
    loadMore,
    fetchMoreForFilter,
    fetchMoreForIssueFilter,
    repoFilterSearch,
    resetRepoFilter,
    issueDifficultySearch,
    resetLabelFilter,
    parseAiFilterIntent,
    combinedRepoFilterSearch,
    combinedIssueFilterSearch,
    preloadIfNeeded,
    restoreFromCache,
    setActiveTab,
    setRankedSections,
    // 派生数据
    issueItems,
    repoItems,
    issueStats,
    lockedLanguages,
    getTotalCount: (tab) => orch.getTotalCount(tab),
    hasMore: (tab) => orch.hasMore(tab),
  }
}
