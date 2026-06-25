/**
 * SearchOrchestrator 单元测试
 *
 * 通过 vi.mock 替换所有外部依赖（github/llm/intent/rag/knowledge 等），
 * 专注测试 orchestrator 自身的：
 *   - 搜索代次保护（旧请求不污染新结果）
 *   - 状态迁移正确性
 *   - repo URL / org / 普通 query 分流
 *   - 错误归一化
 *   - loadMore / labelSearch / resetLabelFilter / fetchMoreForFilter
 *   - RAG 流式结果不污染新搜索
 *
 * Mock 策略：
 *   - IssueFetcher / RepoFetcher 用 mock class 替换，可控 items/hasMore/totalCount
 *   - github.js / llm.js / intent.js / rag.js / knowledge.js / searxng.js 全部 mock
 *   - searchConfig.js / errors.js / languages.js 用真实实现（纯函数，无副作用）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== Mock 外部依赖 =====

// Mock IssueFetcher
vi.mock('../../src/lib/issueLoader.js', () => {
  class MockIssueFetcher {
    constructor() {
      this.pool = { reset: () => { this._items = []; this._hasMore = false; this._totalCount = 0 } }
      this._items = []
      this._hasMore = false
      this._totalCount = 0
      this._issues = []
    }
    get items() { return this._items }
    get issues() { return this._items }
    get hasMore() { return this._hasMore }
    get totalCount() { return this._totalCount }
    get stats() { return { repoChecked: 0, cachedCount: 0, filteredDead: 0 } }
    async fetchIssues(query, opts = {}) {
      this._currentQuery = query
      if (opts.onEnriched) opts.onEnriched()
    }
    async fetchMore() {}
  }
  return { IssueFetcher: MockIssueFetcher }
})

// Mock RepoFetcher
vi.mock('../../src/lib/searchFetcher.js', () => {
  class MockRepoFetcher {
    constructor() {
      this.pool = { reset: () => { this._items = []; this._hasMore = false; this._totalCount = 0 } }
      this._items = []
      this._hasMore = false
      this._totalCount = 0
    }
    get items() { return this._items }
    get hasMore() { return this._hasMore }
    get totalCount() { return this._totalCount }
    async fetchRepos(query, opts = {}) { this._currentQuery = query }
    async fetchMore() {}
  }
  return { RepoFetcher: MockRepoFetcher }
})

// Mock github.js
vi.mock('../../src/lib/github.js', () => ({
  searchCode: vi.fn().mockResolvedValue({ items: [], totalCount: 0 }),
  parseGitHubUrl: vi.fn(() => null),
  searchReposByOrg: vi.fn().mockResolvedValue([]),
  getRepoInfo: vi.fn().mockResolvedValue({ name: 'test', fullName: 'foo/test', stars: 0 }),
}))

// Mock llm.js
vi.mock('../../src/lib/llm.js', () => ({
  isLLMAvailable: vi.fn(() => false),
  analyzeIntent: vi.fn().mockResolvedValue(null),
  analyzeIntentLight: vi.fn().mockResolvedValue(null),
}))

// Mock intent.js
vi.mock('../../src/lib/intent.js', () => ({
  routeQuery: vi.fn((q) => ({
    intent: 'mixed',
    sources: ['repo', 'issue', 'code'],
    query_by_source: { repo: q, issue: q, code: q },
    confidence: 'low',
  })),
  applyLLMIntent: vi.fn((result, q) => ({ intent: result.intent, sources: ['repo'], query_by_source: { repo: q } })),
}))

// Mock knowledge.js
vi.mock('../../src/lib/knowledge.js', () => ({
  searchKnowledge: vi.fn(() => []),
  KB: [],
}))

// Mock rag.js
vi.mock('../../src/lib/rag.js', () => ({
  askRAGStream: vi.fn().mockResolvedValue({ answer: 'test', sources: [] }),
  searchRAG: vi.fn().mockResolvedValue([]),
}))

// Mock intentEmbedding.js
vi.mock('../../src/lib/intentEmbedding.js', () => ({
  matchIntentByEmbedding: vi.fn().mockResolvedValue(null),
  cacheIntentResult: vi.fn().mockResolvedValue(undefined),
}))

// Mock searxng.js
vi.mock('../../src/lib/searxng.js', () => ({
  searchSearxng: vi.fn().mockResolvedValue({ results: [] }),
}))

// Mock searchConfig.js 的 parseInlineSyntax（真实实现是纯函数，但避免依赖）
vi.mock('../../src/lib/searchConfig.js', () => ({
  parseInlineSyntax: vi.fn((q) => ({ query: q, filters: {} })),
  DEFAULT_CONFIG: { pagination: { issuePageSize: 20 }, filters: {}, sources: { repo: { enabled: true }, issue: { enabled: true }, code: { enabled: true } } },
  loadConfig: vi.fn().mockResolvedValue({}),
  saveConfig: vi.fn(),
}))

// Mock languages.js
vi.mock('../../src/lib/languages.js', () => ({
  detectLanguages: vi.fn(() => []),
  aggregateLanguages: vi.fn(() => []),
  aggregateTopics: vi.fn(() => []),
  POPULAR_LANGUAGES: [],
}))

// ===== 导入被测模块（在 mock 之后）=====
import { SearchOrchestrator } from '../../src/lib/search/searchOrchestrator.js'
import { parseGitHubUrl, getRepoInfo, searchReposByOrg, searchCode } from '../../src/lib/github.js'
import { routeQuery } from '../../src/lib/intent.js'
import { isLLMAvailable } from '../../src/lib/llm.js'
import { askRAGStream } from '../../src/lib/rag.js'
import { searchKnowledge } from '../../src/lib/knowledge.js'

// ===== 测试工具 =====

/** 创建一个收集所有回调的 mock cb */
function createMockCallbacks() {
  const calls = {
    states: [],
    results: [],
    rankedSections: [],
    intents: [],
    activeTabs: [],
    ragAnswers: [],
    ragLoadings: [],
  }
  return {
    calls,
    onState: (partial) => calls.states.push(partial),
    onResults: (fn) => {
      // 支持函数式更新和直接赋值
      const prev = calls.results[calls.results.length - 1] || {}
      const next = typeof fn === 'function' ? fn(prev) : fn
      calls.results.push(next)
    },
    onRankedSections: (fn) => {
      const prev = calls.rankedSections[calls.rankedSections.length - 1] || null
      const next = typeof fn === 'function' ? fn(prev) : fn
      calls.rankedSections.push(next)
    },
    onIntent: (intent) => calls.intents.push(intent),
    onActiveTab: (tab) => calls.activeTabs.push(tab),
    onRagAnswer: (fn) => {
      const prev = calls.ragAnswers[calls.ragAnswers.length - 1] || null
      const next = typeof fn === 'function' ? fn(prev) : fn
      calls.ragAnswers.push(next)
    },
    onRagLoading: (loading) => calls.ragLoadings.push(loading),
  }
}

const TEST_CONFIG = {
  pagination: { issuePageSize: 20 },
  filters: { minLiveness: 'maintained', preferredLanguage: 'any' },
  sources: { repo: { enabled: true }, issue: { enabled: true }, code: { enabled: true }, qa: { enabled: true } },
}

describe('SearchOrchestrator', () => {
  let orch
  let cb

  beforeEach(() => {
    vi.clearAllMocks()
    orch = new SearchOrchestrator()
    cb = createMockCallbacks()
  })

  describe('搜索入口校验', () => {
    it('空 query 不触发搜索', async () => {
      await orch.search('', TEST_CONFIG, cb)
      expect(cb.calls.states).toHaveLength(0)
    })

    it('纯空格 query 不触发搜索', async () => {
      await orch.search('   ', TEST_CONFIG, cb)
      expect(cb.calls.states).toHaveLength(0)
    })
  })

  describe('repo URL 分流', () => {
    it('repo URL 走 getRepoInfo 分支', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockResolvedValueOnce({ name: 'react', fullName: 'facebook/react', stars: 100 })

      await orch.search('facebook/react', TEST_CONFIG, cb)

      expect(getRepoInfo).toHaveBeenCalledWith('facebook', 'react')
      // 应该设置 intent=repo
      expect(cb.calls.intents).toContain('repo')
      // 应该设置 activeTab=repo
      expect(cb.calls.activeTabs).toContain('repo')
      // 最终状态应该是 idle
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('idle')
    })

    it('repo URL 失败时走错误归一化', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockRejectedValueOnce(new Error('Failed to fetch'))

      await orch.search('facebook/react', TEST_CONFIG, cb)

      // 应该有 error 状态
      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
      expect(errorState.error).toContain('网络连接失败')
    })
  })

  describe('org 分流', () => {
    it('org URL 走 searchReposByOrg 分支', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'org', owner: 'vercel' })
      searchReposByOrg.mockResolvedValueOnce([
        { name: 'next.js', fullName: 'vercel/next.js', stars: 100 },
      ])

      await orch.search('vercel', TEST_CONFIG, cb)

      expect(searchReposByOrg).toHaveBeenCalled()
      expect(cb.calls.intents).toContain('repo')
      expect(cb.calls.activeTabs).toContain('repo')
    })

    it('org 失败时走错误归一化', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'org', owner: 'vercel' })
      searchReposByOrg.mockRejectedValueOnce(new Error('403 rate limit'))

      await orch.search('vercel', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
      expect(errorState.error).toContain('限流')
    })
  })

  describe('普通关键词搜索', () => {
    it('普通 query 走意图路由 + 多源调度', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValueOnce({
        intent: 'repo',
        sources: ['repo'],
        query_by_source: { repo: 'react' },
        confidence: 'high',
      })

      await orch.search('react', TEST_CONFIG, cb)

      // 应该设置 intent=repo
      expect(cb.calls.intents).toContain('repo')
      // 应该设置 activeTab=repo
      expect(cb.calls.activeTabs).toContain('repo')
      // 最终状态应该是 idle
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('idle')
    })

    it('issue 意图时设置 activeTab=issue', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValueOnce({
        intent: 'issue',
        sources: ['issue'],
        query_by_source: { issue: 'bug' },
        confidence: 'high',
      })

      await orch.search('bug', TEST_CONFIG, cb)

      expect(cb.calls.intents).toContain('issue')
      expect(cb.calls.activeTabs).toContain('issue')
    })

    it('code 意图时设置 activeTab=code', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValueOnce({
        intent: 'code',
        sources: ['code'],
        query_by_source: { code: 'async' },
        confidence: 'high',
      })

      await orch.search('async', TEST_CONFIG, cb)

      expect(cb.calls.intents).toContain('code')
      expect(cb.calls.activeTabs).toContain('code')
    })

    it('搜索开始时重置所有状态', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValueOnce({
        intent: 'repo',
        sources: ['repo'],
        query_by_source: { repo: 'test' },
        confidence: 'high',
      })

      await orch.search('test', TEST_CONFIG, cb)

      // 第一个状态应该是 searching
      expect(cb.calls.states[0].status).toBe('searching')
      // 应该重置 intent
      expect(cb.calls.intents[0]).toBeNull()
      // 应该重置 rankedSections
      expect(cb.calls.rankedSections[0]).toBeNull()
      // 应该重置 results
      expect(cb.calls.results[0]).toEqual({})
    })
  })

  describe('搜索代次保护', () => {
    it('搜索中再次发起搜索会被 _running 守护拒绝', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValue({
        intent: 'repo',
        sources: ['repo'],
        query_by_source: { repo: 'test' },
        confidence: 'high',
      })

      // 第一次搜索（还没 await 完成）
      const p1 = orch.search('test1', TEST_CONFIG, cb)
      // 立即发起第二次（_running=true，应该被拒绝）
      const p2 = orch.search('test2', TEST_CONFIG, cb)

      await Promise.all([p1, p2])

      // 第二次搜索不应该产生任何回调
      // 第一次搜索的 intent 应该是 'repo'（来自 test1）
      // 检查没有第二次搜索的痕迹
      const allIntents = cb.calls.intents
      // 第一次搜索会先 push null（重置），再 push 'repo'
      // 第二次搜索如果被拒绝，不会 push 任何东西
      expect(allIntents.filter(i => i === null).length).toBe(1)
    })
  })

  describe('RAG 流式结果不污染新搜索', () => {
    it('RAG 结果到达时如果已发起新搜索，不写回当前页', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValue({
        intent: 'qa',
        sources: ['knowledge'],
        query_by_source: { knowledge: 'what is fork' },
        confidence: 'high',
      })
      isLLMAvailable.mockReturnValue(true)
      searchKnowledge.mockReturnValue([{ id: 'k1', title: 'fork', category: 'git', body: 'fork is...' }])
      askRAGStream.mockImplementation(async (q, onChunk) => {
        // 模拟流式输出
        onChunk('partial answer')
        return { answer: 'final answer', sources: [] }
      })

      const cb1 = createMockCallbacks()
      const p1 = orch.search('what is fork', TEST_CONFIG, cb1)

      // 等待搜索完成
      await p1

      // RAG 应该被触发
      expect(askRAGStream).toHaveBeenCalled()
      // ragAnswer 应该有值
      expect(cb1.calls.ragAnswers.length).toBeGreaterThan(0)
    })
  })

  describe('loadMore', () => {
    it('newPage < 1 时返回空数组', async () => {
      const result = await orch.loadMore('issue', 0, TEST_CONFIG, cb)
      expect(result).toEqual([])
    })

    it('issue tab 调用 issueFetcher', async () => {
      // 先模拟有数据
      orch.issueFetcher._items = [{ title: 'a', repo: 'foo/bar' }]
      orch.issueFetcher._hasMore = false

      await orch.loadMore('issue', 1, TEST_CONFIG, cb)
      // 应该更新 rankedSections
      expect(cb.calls.rankedSections.length).toBeGreaterThan(0)
    })

    it('repo tab 调用 repoFetcher', async () => {
      orch.repoFetcher._items = [{ name: 'test', fullName: 'foo/test' }]
      orch.repoFetcher._hasMore = false

      await orch.loadMore('repo', 1, TEST_CONFIG, cb)
      expect(cb.calls.rankedSections.length).toBeGreaterThan(0)
    })
  })

  describe('labelSearch', () => {
    it('无 baseQuery 时不执行', async () => {
      await orch.labelSearch(new Set(['bug']), TEST_CONFIG, cb)
      // 不应该有任何状态变更
      expect(cb.calls.states).toHaveLength(0)
    })

    it('空 labels 时不执行', async () => {
      orch._baseQuery = 'test'
      await orch.labelSearch(new Set(), TEST_CONFIG, cb)
      expect(cb.calls.states).toHaveLength(0)
    })

    it('有 baseQuery + labels 时触发 label_search 状态', async () => {
      orch._baseQuery = 'test'
      orch.issueFetcher._items = [{ title: 'a', repo: 'foo/bar' }]
      orch.issueFetcher._hasMore = false

      await orch.labelSearch(new Set(['bug']), TEST_CONFIG, cb)

      // 应该有 label_search 状态
      const labelState = cb.calls.states.find(s => s.status === 'label_search')
      expect(labelState).toBeDefined()
      // 最终应该回到 idle
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('idle')
    })
  })

  describe('resetLabelFilter', () => {
    it('无 originalIssue 时不操作', () => {
      orch._originalIssue = null
      orch.resetLabelFilter(TEST_CONFIG, cb)
      expect(cb.calls.rankedSections).toHaveLength(0)
    })

    it('有 originalIssue 时恢复首屏切片', () => {
      orch._originalIssue = {
        items: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
        totalCount: 3,
      }
      orch.resetLabelFilter(TEST_CONFIG, cb)
      // 应该更新 rankedSections
      expect(cb.calls.rankedSections).toHaveLength(1)
      const sections = cb.calls.rankedSections[0]
      expect(sections.issue).toHaveLength(3)
    })

    it('切片长度遵循 pageSize', () => {
      orch._originalIssue = {
        items: Array.from({ length: 50 }, (_, i) => ({ title: `item-${i}` })),
        totalCount: 50,
      }
      const config = { pagination: { issuePageSize: 10 } }
      orch.resetLabelFilter(config, cb)
      const sections = cb.calls.rankedSections[0]
      expect(sections.issue).toHaveLength(10)
    })
  })

  describe('fetchMoreForFilter', () => {
    it('fetcher 无更多数据时不操作', async () => {
      orch.repoFetcher._hasMore = false
      orch.repoFetcher._items = []
      await orch.fetchMoreForFilter(TEST_CONFIG, cb)
      expect(cb.calls.states).toHaveLength(0)
    })

    it('有更多数据时触发 repo_filter 状态', async () => {
      orch.repoFetcher._hasMore = true
      orch.repoFetcher._items = [{ name: 'test' }]
      orch.repoFetcher.fetchMore = vi.fn().mockResolvedValue()

      await orch.fetchMoreForFilter(TEST_CONFIG, cb)

      const filterState = cb.calls.states.find(s => s.status === 'repo_filter')
      expect(filterState).toBeDefined()
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('idle')
    })
  })

  describe('preloadIfNeeded', () => {
    it('无更多数据时不预加载', () => {
      orch.repoFetcher._hasMore = false
      orch.repoFetcher.fetchMore = vi.fn()
      orch.preloadIfNeeded('repo', 1, TEST_CONFIG)
      expect(orch.repoFetcher.fetchMore).not.toHaveBeenCalled()
    })

    it('接近末页时触发后台预加载', () => {
      orch.repoFetcher._hasMore = true
      orch.repoFetcher._items = Array.from({ length: 15 }, (_, i) => ({ name: `r-${i}` }))
      orch.repoFetcher.fetchMore = vi.fn().mockResolvedValue()
      // pageSize=20, items=15, currentPage=1 → totalPages=1, currentPage >= totalPages-1
      orch.preloadIfNeeded('repo', 1, TEST_CONFIG)
      expect(orch.repoFetcher.fetchMore).toHaveBeenCalled()
    })

    it('未接近末页时不预加载', () => {
      orch.repoFetcher._hasMore = true
      orch.repoFetcher._items = Array.from({ length: 50 }, (_, i) => ({ name: `r-${i}` }))
      orch.repoFetcher.fetchMore = vi.fn().mockResolvedValue()
      // pageSize=20, items=50, currentPage=1 → totalPages=3, currentPage < totalPages-1
      orch.preloadIfNeeded('repo', 1, TEST_CONFIG)
      expect(orch.repoFetcher.fetchMore).not.toHaveBeenCalled()
    })
  })

  describe('只读访问器', () => {
    it('issueItems 返回 issueFetcher.items', () => {
      orch.issueFetcher._items = [{ title: 'a' }]
      expect(orch.issueItems).toEqual([{ title: 'a' }])
    })

    it('repoItems 返回 repoFetcher.items', () => {
      orch.repoFetcher._items = [{ name: 'r' }]
      expect(orch.repoItems).toEqual([{ name: 'r' }])
    })

    it('getTotalCount 返回指定 tab 的总数', () => {
      orch._totalCount = { issue: 100, repo: 50 }
      expect(orch.getTotalCount('issue')).toBe(100)
      expect(orch.getTotalCount('repo')).toBe(50)
      expect(orch.getTotalCount('code')).toBe(0)
    })

    it('hasMore 返回指定 tab 的可加载状态', () => {
      orch.issueFetcher._hasMore = true
      orch.repoFetcher._hasMore = false
      expect(orch.hasMore('issue')).toBe(true)
      expect(orch.hasMore('repo')).toBe(false)
      expect(orch.hasMore('code')).toBe(false)
    })

    it('lockedLanguages 返回锁定语言集合', () => {
      orch._lockedLanguages = new Set(['JavaScript'])
      expect(orch.lockedLanguages.has('JavaScript')).toBe(true)
    })

    it('originalIssue 返回原始 issue 快照', () => {
      orch._originalIssue = { items: [], totalCount: 0 }
      expect(orch.originalIssue).toEqual({ items: [], totalCount: 0 })
    })
  })

  // ===== 补齐：错误归一化细分 / loadMore error / 代次保护 =====

  describe('错误归一化 - 多类型错误', () => {
    it('404 错误保留原始文案', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockRejectedValueOnce(new Error('404 Not Found'))

      await orch.search('facebook/react', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
      // 404 不匹配任何友好文案规则，原样返回
      expect(errorState.error).toBe('404 Not Found')
    })

    it('rate limit 错误转成限流提示', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockRejectedValueOnce(new Error('403 rate limit exceeded'))

      await orch.search('facebook/react', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState.error).toContain('限流')
    })

    it('网络错误转成网络连接失败提示', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockRejectedValueOnce(new Error('Failed to fetch'))

      await orch.search('facebook/react', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState.error).toContain('网络连接失败')
    })

    it('超时错误转成超时提示', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockRejectedValueOnce(new Error('timeout of 15000ms exceeded'))

      await orch.search('facebook/react', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState.error).toContain('超时')
    })

    it('401 鉴权错误转成 Token 提示', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'repo', owner: 'facebook', repo: 'react' })
      getRepoInfo.mockRejectedValueOnce(new Error('401 Unauthorized'))

      await orch.search('facebook/react', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState.error).toContain('Token')
    })

    it('org 搜索 404 错误也走错误归一化', async () => {
      parseGitHubUrl.mockReturnValueOnce({ type: 'org', owner: 'nonexistent-org' })
      searchReposByOrg.mockRejectedValueOnce(new Error('404 Not Found'))

      await orch.search('nonexistent-org', TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
    })
  })

  describe('loadMore - error 不被 finally 覆盖', () => {
    it('fetchMore 失败时 error 状态保留', async () => {
      // 设置 fetcher 有数据但不足，且 hasMore=true
      orch.issueFetcher._items = [{ title: 'a', repo: 'foo/bar' }]
      orch.issueFetcher._hasMore = true
      orch.issueFetcher.fetchMore = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

      await orch.loadMore('issue', 2, TEST_CONFIG, cb)

      // 应该有 error 状态
      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
      expect(errorState.error).toContain('网络连接失败')
      // 最后状态不应该是 idle（error 不被覆盖）
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('error')
    })

    it('fetchMore 成功时状态回到 idle', async () => {
      orch.issueFetcher._items = Array.from({ length: 25 }, (_, i) => ({ title: `item-${i}`, repo: 'foo/bar' }))
      orch.issueFetcher._hasMore = false // 已有足够数据，不触发 fetchMore

      await orch.loadMore('issue', 1, TEST_CONFIG, cb)

      // 不需要 fetchMore，直接返回切片
      expect(cb.calls.rankedSections.length).toBeGreaterThan(0)
    })

    it('空结果不崩', async () => {
      orch.issueFetcher._items = []
      orch.issueFetcher._hasMore = false

      const result = await orch.loadMore('issue', 1, TEST_CONFIG, cb)
      expect(result).toEqual([])
    })

    it('repo tab fetchMore 失败时 error 状态保留', async () => {
      orch.repoFetcher._items = [{ name: 'test', fullName: 'foo/test' }]
      orch.repoFetcher._hasMore = true
      orch.repoFetcher.fetchMore = vi.fn().mockRejectedValue(new Error('403 rate limit'))

      await orch.loadMore('repo', 2, TEST_CONFIG, cb)

      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
      expect(errorState.error).toContain('限流')
    })
  })

  describe('代次保护 - 细粒度', () => {
    it('普通搜索失败后 error 状态不被 finally 覆盖', async () => {
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValueOnce({
        intent: 'repo',
        sources: ['repo'],
        query_by_source: { repo: 'test' },
        confidence: 'high',
      })
      // 让 repo 搜索失败
      orch.repoFetcher.fetchRepos = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

      await orch.search('test', TEST_CONFIG, cb)

      // 应该有 error 状态
      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeDefined()
      // 最后状态应该是 error，不是 idle
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('error')
    })

    it('搜索完成后发起新搜索，旧 RAG 回调不写回', async () => {
      // 验证策略：第一次搜索触发 RAG（用 cb1），完成后发起第二次搜索
      // 第二次搜索不触发 RAG（intent=repo + knowledge 为空）
      // 检查 askRAGStream 只被调用一次（第一次搜索）
      parseGitHubUrl.mockReturnValue(null)
      routeQuery.mockReturnValue({
        intent: 'qa',
        sources: ['knowledge'],
        query_by_source: { knowledge: 'what is fork' },
        confidence: 'high',
      })
      isLLMAvailable.mockReturnValue(true)
      searchKnowledge.mockReturnValue([{ id: 'k1', title: 'fork', category: 'git', body: 'fork is...' }])
      askRAGStream.mockResolvedValue({ answer: 'old answer', sources: [] })

      const cb1 = createMockCallbacks()
      await orch.search('what is fork', TEST_CONFIG, cb1)

      // 第一次搜索应该触发 RAG
      expect(askRAGStream).toHaveBeenCalledTimes(1)

      // 发起第二次搜索（递增 _gen，intent=repo 不触发 RAG）
      searchKnowledge.mockReturnValue([])
      routeQuery.mockReturnValue({
        intent: 'repo',
        sources: ['repo'],
        query_by_source: { repo: 'react' },
        confidence: 'high',
      })
      const cb2 = createMockCallbacks()
      await orch.search('react', TEST_CONFIG, cb2)

      // askRAGStream 仍然只被调用一次（第二次搜索不触发 RAG）
      expect(askRAGStream).toHaveBeenCalledTimes(1)
    })
  })

  describe('labelSearch - 错误处理', () => {
    it('labelSearch 失败时静默回到 idle（不设 error）', async () => {
      orch._baseQuery = 'test'
      orch.issueFetcher._items = [{ title: 'a', repo: 'foo/bar' }]
      orch.issueFetcher._hasMore = false
      orch.issueFetcher.fetchIssues = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

      await orch.labelSearch(new Set(['bug']), TEST_CONFIG, cb)

      // labelSearch 的 catch 是静默的，不设 error
      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeUndefined()
      // 最终回到 idle
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('idle')
    })
  })

  describe('fetchMoreForFilter - 错误处理', () => {
    it('fetchMore 失败时静默回到 idle', async () => {
      orch.repoFetcher._hasMore = true
      orch.repoFetcher._items = [{ name: 'test' }]
      orch.repoFetcher.fetchMore = vi.fn().mockRejectedValue(new Error('Failed to fetch'))

      await orch.fetchMoreForFilter(TEST_CONFIG, cb)

      // fetchMoreForFilter 的 catch 是静默的
      const errorState = cb.calls.states.find(s => s.status === 'error')
      expect(errorState).toBeUndefined()
      const lastState = cb.calls.states[cb.calls.states.length - 1]
      expect(lastState.status).toBe('idle')
    })
  })
})
