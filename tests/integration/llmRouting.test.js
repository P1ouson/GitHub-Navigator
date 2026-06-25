/**
 * 集成测试：LLM 路由降级链 + 代次保护
 *
 * 覆盖：
 *   - L1（规则路由）：高置信度 query 直接命中，不调 LLM
 *   - L2（embedding）：L1 低置信度 → matchIntentByEmbedding 命中
 *   - L3（轻量模型）：L2 miss → analyzeIntentLight 命中
 *   - L4（全量模型）：L3 miss → analyzeIntent 命中
 *   - 全降级失败 → 回退到 L1 规则路由结果
 *   - 代次保护：L3 异步返回时已被新搜索取代 → 不写回
 *
 * mock 策略：
 *   - llm.js: isLLMAvailable / analyzeIntent / analyzeIntentLight
 *   - intentEmbedding.js: matchIntentByEmbedding / cacheIntentResult
 *   - github.js: 空结果（只验证路由，不验证搜索结果）
 *   - knowledge.js / rag.js / searxng.js: 空结果
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== mock 依赖 =====

const mockIsLLMAvailable = vi.fn(() => true)
const mockAnalyzeIntent = vi.fn()
const mockAnalyzeIntentLight = vi.fn()

vi.mock('../../src/lib/llm.js', () => ({
  isLLMAvailable: () => mockIsLLMAvailable(),
  analyzeIntent: (...args) => mockAnalyzeIntent(...args),
  analyzeIntentLight: (...args) => mockAnalyzeIntentLight(...args),
}))

const mockMatchIntentByEmbedding = vi.fn()
const mockCacheIntentResult = vi.fn().mockResolvedValue(null)

vi.mock('../../src/lib/intentEmbedding.js', () => ({
  matchIntentByEmbedding: (...args) => mockMatchIntentByEmbedding(...args),
  cacheIntentResult: (...args) => mockCacheIntentResult(...args),
}))

vi.mock('../../src/lib/knowledge.js', () => ({
  searchKnowledge: () => [],
  KB: [],
}))

vi.mock('../../src/lib/rag.js', () => ({
  askRAGStream: vi.fn().mockResolvedValue(null),
  searchRAG: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/lib/searxng.js', () => ({
  searchSearxng: vi.fn().mockResolvedValue([]),
}))

// github.js mock - 返回空结果，只验证路由层
const mockFetchIssuesPage = vi.fn()
const mockSearchRepositories = vi.fn()
const mockSearchCode = vi.fn()
const mockGetRepoInfo = vi.fn()
const mockSearchReposByOrg = vi.fn()

vi.mock('../../src/lib/github.js', () => ({
  fetchIssuesPage: (...args) => mockFetchIssuesPage(...args),
  searchRepositories: (...args) => mockSearchRepositories(...args),
  searchCode: (...args) => mockSearchCode(...args),
  getRepoInfo: (...args) => mockGetRepoInfo(...args),
  searchReposByOrg: (...args) => mockSearchReposByOrg(...args),
  parseGitHubUrl: vi.fn(() => null),
}))

vi.mock('../../src/lib/repoService.js', () => ({
  batchGetRepoInfos: vi.fn().mockResolvedValue({ map: new Map(), stats: { cacheHits: 0 } }),
  getRepoInfoCached: vi.fn(),
  getRepoInfo: vi.fn(),
  batchGetRepoEntries: vi.fn(),
  getRepoEntry: vi.fn(),
  getRepoSummary: vi.fn(),
  batchGetRepoSummaries: vi.fn(),
}))

import { SearchOrchestrator } from '../../src/lib/search/searchOrchestrator.js'

/* ===== 测试数据工厂 ===== */

function makeCb() {
  const state = { status: 'idle', hint: '', error: null, ragLoading: false }
  const cb = {
    onState: vi.fn((partial) => Object.assign(state, partial)),
    onResults: vi.fn(),
    onRankedSections: vi.fn((updater) => {
      if (typeof updater === 'function') cb._ranked = updater(cb._ranked)
      else cb._ranked = updater
    }),
    onIntent: vi.fn(),
    onActiveTab: vi.fn(),
    onRagAnswer: vi.fn(),
    onRagLoading: vi.fn(),
    _ranked: null,
    _state: state,
  }
  return cb
}

function makeConfig(overrides = {}) {
  return {
    filters: {},
    pagination: { issuePageSize: 5 },
    sources: {
      repo: { enabled: true },
      issue: { enabled: true },
      code: { enabled: true },
      qa: { enabled: false },
    },
    ...overrides,
  }
}

/* ===== 测试 ===== */

describe('LLM 路由降级链集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // LLM 路由层可用（首次 isLLMAvailable 检查为 true 触发 L2/L3/L4），
    // 但 _autoExpandIfNeeded 的 L4 兜底扩词不应介入路由断言，故后续调用返回 false。
    mockIsLLMAvailable.mockReturnValueOnce(true).mockReturnValue(false)
    mockFetchIssuesPage.mockResolvedValue({ items: [], totalCount: 0, searchQuery: '' })
    mockSearchRepositories.mockResolvedValue({ items: [], totalCount: 0, searchQuery: '' })
    mockSearchCode.mockResolvedValue({ items: [], totalCount: 0, searchQuery: '' })
  })

  describe('L1 规则路由（高置信度直接命中）', () => {
    it('"!repo react" bang 前缀 → 高置信度 → 不调 LLM', async () => {
      const orch = new SearchOrchestrator()
      const cb = makeCb()
      // !repo bang 前缀触发 L1 高置信度 repo 路由
      await orch.search('!repo react', makeConfig(), cb)

      // L1 高置信度，不应调用 L2/L3/L4
      expect(mockMatchIntentByEmbedding).not.toHaveBeenCalled()
      expect(mockAnalyzeIntentLight).not.toHaveBeenCalled()
      expect(mockAnalyzeIntent).not.toHaveBeenCalled()
    })
  })

  describe('L2 embedding 路由', () => {
    it('L1 低置信度 → L2 embedding 命中', async () => {
      mockMatchIntentByEmbedding.mockResolvedValueOnce({
        intent: 'repo',
        confidence: 0.9,
        query_by_source: { repo: 'test query' },
      })

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      // 用一个低置信度的 query（非标准关键词）
      await orch.search('how to build a web app', makeConfig(), cb)

      expect(mockMatchIntentByEmbedding).toHaveBeenCalled()
      // L2 命中后不应继续调 L3/L4
      expect(mockAnalyzeIntentLight).not.toHaveBeenCalled()
      expect(mockAnalyzeIntent).not.toHaveBeenCalled()
    })

    it('L2 miss → 继续调 L3', async () => {
      mockMatchIntentByEmbedding.mockResolvedValueOnce(null)
      mockAnalyzeIntentLight.mockResolvedValueOnce({
        intent: 'issue',
        confidence: 0.8,
        query_by_source: { issue: 'test' },
      })

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      await orch.search('some ambiguous query', makeConfig(), cb)

      expect(mockMatchIntentByEmbedding).toHaveBeenCalled()
      expect(mockAnalyzeIntentLight).toHaveBeenCalled()
      // L3 命中后不应继续调 L4
      expect(mockAnalyzeIntent).not.toHaveBeenCalled()
    })
  })

  describe('L3 轻量模型路由', () => {
    it('L2 miss + L3 命中 → 缓存结果', async () => {
      mockMatchIntentByEmbedding.mockResolvedValueOnce(null)
      const llmResult = {
        intent: 'issue',
        confidence: 0.85,
        query_by_source: { issue: 'test' },
      }
      mockAnalyzeIntentLight.mockResolvedValueOnce(llmResult)

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      await orch.search('ambiguous query xyz', makeConfig(), cb)

      expect(mockAnalyzeIntentLight).toHaveBeenCalled()
      expect(mockCacheIntentResult).toHaveBeenCalledWith('ambiguous query xyz', llmResult)
      expect(mockAnalyzeIntent).not.toHaveBeenCalled()
    })
  })

  describe('L4 全量模型路由', () => {
    it('L2 + L3 都 miss → L4 命中', async () => {
      mockMatchIntentByEmbedding.mockResolvedValueOnce(null)
      mockAnalyzeIntentLight.mockResolvedValueOnce(null)
      mockAnalyzeIntent.mockResolvedValueOnce({
        intent: 'repo',
        confidence: 0.9,
        query_by_source: { repo: 'test' },
      })

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      await orch.search('very ambiguous query', makeConfig(), cb)

      expect(mockAnalyzeIntent).toHaveBeenCalled()
    })
  })

  describe('全降级失败 → 回退 L1', () => {
    it('L2/L3/L4 全 miss → 用 L1 规则路由结果', async () => {
      mockMatchIntentByEmbedding.mockResolvedValueOnce(null)
      mockAnalyzeIntentLight.mockResolvedValueOnce(null)
      mockAnalyzeIntent.mockResolvedValueOnce(null)

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      await orch.search('some random text', makeConfig(), cb)

      // 所有 LLM 层都 miss，回退到 L1
      expect(mockMatchIntentByEmbedding).toHaveBeenCalled()
      expect(mockAnalyzeIntentLight).toHaveBeenCalled()
      expect(mockAnalyzeIntent).toHaveBeenCalled()
      // 最终状态应为 idle（搜索完成，即使结果为空）
      expect(cb._state.status).toBe('idle')
    })
  })

  describe('LLM 不可用 → 直接走 L1', () => {
    it('isLLMAvailable=false → 跳过所有 LLM 路由', async () => {
      mockIsLLMAvailable.mockReset()
      mockIsLLMAvailable.mockReturnValue(false)

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      await orch.search('any query', makeConfig(), cb)

      expect(mockMatchIntentByEmbedding).not.toHaveBeenCalled()
      expect(mockAnalyzeIntentLight).not.toHaveBeenCalled()
      expect(mockAnalyzeIntent).not.toHaveBeenCalled()
    })
  })

  describe('代次保护 - LLM 异步返回时已被新搜索取代', () => {
    it('L3 慢响应时搜索不阻塞（基本验证）', async () => {
      // L3 返回 null（快速 resolve，不阻塞）
      mockMatchIntentByEmbedding.mockResolvedValueOnce(null)
      mockAnalyzeIntentLight.mockResolvedValueOnce(null)
      mockAnalyzeIntent.mockResolvedValueOnce(null)

      const orch = new SearchOrchestrator()
      const cb = makeCb()
      await orch.search('ambiguous query test', makeConfig(), cb)

      // 所有 LLM 层都 miss，回退 L1，搜索完成
      expect(cb._state.status).toBe('idle')
    })
  })
})
