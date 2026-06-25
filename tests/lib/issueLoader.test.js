/**
 * issueLoader 单元测试
 *
 * 覆盖：
 *   - fetchIssues Phase 1 快速入池（_enriched:false）
 *   - fetchIssues Phase 2 后台 enrich（_enriched:true）
 *   - fetchIssues 完整管线（无 onEnriched）
 *   - 代次保护（新搜索取代旧搜索）
 *   - fetchMore 翻页
 *   - 星数过滤：null stars 不被过滤
 *   - 活跃度过滤：unknown 保留
 *   - spam 仓库检测
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockFetchIssuesPage, mockBatchGetRepoInfos } = vi.hoisted(() => ({
  mockFetchIssuesPage: vi.fn(),
  mockBatchGetRepoInfos: vi.fn(),
}))

vi.mock('../../src/lib/github.js', () => ({
  fetchIssuesPage: (...args) => mockFetchIssuesPage(...args),
  batchGetRepoInfos: (...args) => mockBatchGetRepoInfos(...args),
}))

import { IssueFetcher } from '../../src/lib/issueLoader.js'

// 构造测试 issue
function makeIssue(repo, num) {
  return {
    id: `id-${repo}-${num}`,
    number: num,
    title: `issue ${num} in ${repo}`,
    repo,
    labels: [],
    url: `https://github.com/${repo}/issues/${num}`,
    state: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    comments: 0,
    body: 'a'.repeat(30), // 超过 SPAM_MIN_BODY_LENGTH
  }
}

// 构造测试 entry（repoCache entry）
function makeEntry(repo, { stars = 100, updatedAt = null, archived = false } = {}) {
  return {
    name: repo,
    fullName: repo,
    stars,
    forks: 10,
    openIssues: 5,
    language: 'JS',
    updatedAt: updatedAt || new Date().toISOString(),
    archived,
    _ts: Date.now(),
  }
}

beforeEach(() => {
  mockFetchIssuesPage.mockReset()
  mockBatchGetRepoInfos.mockReset()
})

describe('IssueFetcher.fetchIssues - Phase 1 快速入池', () => {
  it('有 onEnriched → quick 模式，Phase 1 立即入池', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('a/b', 1), makeIssue('c/d', 2)],
      totalCount: 2,
      searchQuery: 'test',
    })
    // Phase 2 的 batchGetRepoInfos 挂起，确保 Phase 1 中间状态可观察
    mockBatchGetRepoInfos.mockReturnValue(new Promise(() => {}))

    const fetcher = new IssueFetcher()
    const onEnriched = vi.fn()
    await fetcher.fetchIssues('test', { perPage: 30, onEnriched })

    // Phase 1 立即返回，池里有 2 个 item
    expect(fetcher.items).toHaveLength(2)
    expect(fetcher.items[0]._enriched).toBe(false)
    expect(fetcher.items[0]._repoHealth).toBeNull()
    // Phase 2 还在挂起，onEnriched 未调用
    expect(onEnriched).not.toHaveBeenCalled()
  })
})

describe('IssueFetcher.fetchIssues - 完整管线（无 onEnriched）', () => {
  it('无 onEnriched → 完整管线，_enriched=true', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('a/b', 1)],
      totalCount: 1,
      searchQuery: 'test',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([['a/b', makeEntry('a/b', { stars: 500 })]]),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 30 })

    expect(fetcher.items).toHaveLength(1)
    expect(fetcher.items[0]._enriched).toBe(true)
    expect(fetcher.items[0]._repoHealth).not.toBeNull()
    expect(fetcher.items[0]._repoHealth.stars).toBe(500)
    expect(mockBatchGetRepoInfos).toHaveBeenCalledWith(['a/b'])
  })

  it('活跃度降权：dead repo 的 issue 被降权保留', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('dead/repo', 1), makeIssue('alive/repo', 2)],
      totalCount: 2,
      searchQuery: 'test',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([
        ['dead/repo', makeEntry('dead/repo', { archived: true })], // archived → dead
        ['alive/repo', makeEntry('alive/repo', { updatedAt: new Date().toISOString() })],
      ]),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 30, minLiveness: 'maintained' })

    // 新行为：dead repo 不再剔除，而是标记 _livenessPenalty 降权保留（由排序自然下沉）
    expect(fetcher.items).toHaveLength(2)
    const deadIssue = fetcher.items.find(i => i.repo === 'dead/repo')
    expect(deadIssue._livenessPenalty).toBe(1.0)
    const aliveIssue = fetcher.items.find(i => i.repo === 'alive/repo')
    expect(aliveIssue._livenessPenalty).toBe(0)
    expect(fetcher.stats.filteredDead).toBe(0)
  })

  it('unknown 保留（API 失败的 repo 不被过滤）', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('fail/repo', 1)],
      totalCount: 1,
      searchQuery: 'test',
    })
    // batchGetRepoInfos 返回空 map（API 失败）
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map(),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 30, minLiveness: 'maintained' })

    expect(fetcher.items).toHaveLength(1)
    expect(fetcher.items[0]._repoHealth.liveness.level).toBe('unknown')
  })

  it('null stars 不被星数过滤', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('nullstars/repo', 1)],
      totalCount: 1,
      searchQuery: 'test',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([['nullstars/repo', makeEntry('nullstars/repo', { stars: null })]]),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 30, stars: 100 }) // minStars=100

    // stars=null 未知，不被过滤
    expect(fetcher.items).toHaveLength(1)
    expect(fetcher.items[0]._repoHealth.stars).toBeNull()
  })

  it('spam 仓库检测：同仓库 issue 过多且正文极短 → 剔除', async () => {
    const spamIssues = []
    for (let i = 1; i <= 15; i++) {
      spamIssues.push({ ...makeIssue('spam/repo', i), body: 'x' }) // 正文极短
    }
    mockFetchIssuesPage.mockResolvedValue({
      items: spamIssues,
      totalCount: 15,
      searchQuery: 'test',
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 30 })

    expect(fetcher.items).toHaveLength(0)
    expect(fetcher.stats.filteredDead).toBe(15)
  })
})

describe('IssueFetcher.fetchIssues - Phase 2 后台 enrich', () => {
  it('awaitEnrich 后 _enriched=true', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('a/b', 1)],
      totalCount: 1,
      searchQuery: 'test',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([['a/b', makeEntry('a/b', { stars: 300 })]]),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    const onEnriched = vi.fn()
    await fetcher.fetchIssues('test', { perPage: 30, onEnriched })

    // 等待 Phase 2 完成（mock 同步 resolve，Phase 2 可能在 fetchIssues 返回前就完成）
    await fetcher.awaitEnrich()

    expect(fetcher.items[0]._enriched).toBe(true)
    expect(fetcher.items[0]._repoHealth.stars).toBe(300)
    expect(onEnriched).toHaveBeenCalled()
  })
})

describe('IssueFetcher.fetchMore - 翻页', () => {
  it('fetchMore 拉取下一页', async () => {
    // 第一页：fetchSize=1，返回 1 个 item → hasMore=true
    mockFetchIssuesPage.mockResolvedValueOnce({
      items: [makeIssue('a/b', 1)],
      totalCount: 5,
      searchQuery: 'test',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([['a/b', makeEntry('a/b')]]),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 1, maxGithubPages: 5, fetchSize: 1 })
    expect(fetcher.items).toHaveLength(1)
    expect(fetcher.hasMore).toBe(true)

    // 第二页
    mockFetchIssuesPage.mockResolvedValueOnce({
      items: [makeIssue('a/b', 2)],
      totalCount: 5,
      searchQuery: 'test',
    })
    await fetcher.fetchMore(1)
    expect(fetcher.items).toHaveLength(2)
  })

  it('hasMore=false 时不拉取', async () => {
    mockFetchIssuesPage.mockResolvedValue({
      items: [makeIssue('a/b', 1)],
      totalCount: 1,
      searchQuery: 'test',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([['a/b', makeEntry('a/b')]]),
      stats: { cacheHits: 0 },
    })

    const fetcher = new IssueFetcher()
    await fetcher.fetchIssues('test', { perPage: 100, fetchSize: 100 })
    // items.length < fetchSize → hasMore=false
    expect(fetcher.hasMore).toBe(false)

    const before = fetcher.items.length
    const r = await fetcher.fetchMore(1)
    expect(r).toBe(false)
    expect(fetcher.items.length).toBe(before)
  })
})

describe('代次保护', () => {
  it('新搜索取代旧搜索，旧搜索不污染新池', async () => {
    // 第一次搜索：延迟返回
    let resolveFirst
    mockFetchIssuesPage.mockReturnValueOnce(new Promise(r => { resolveFirst = r }))

    const fetcher = new IssueFetcher()
    const p1 = fetcher.fetchIssues('old', { perPage: 30 })

    // 立即发起第二次搜索
    mockFetchIssuesPage.mockResolvedValueOnce({
      items: [makeIssue('new/repo', 1)],
      totalCount: 1,
      searchQuery: 'new',
    })
    mockBatchGetRepoInfos.mockResolvedValue({
      map: new Map([['new/repo', makeEntry('new/repo')]]),
      stats: { cacheHits: 0 },
    })
    const p2 = fetcher.fetchIssues('new', { perPage: 30 })

    // 让第一次搜索完成
    resolveFirst({
      items: [makeIssue('old/repo', 1)],
      totalCount: 1,
      searchQuery: 'old',
    })

    await Promise.all([p1, p2])

    // 池里应该是新搜索的结果
    expect(fetcher.items.every(i => i.repo === 'new/repo')).toBe(true)
    expect(fetcher.items.some(i => i.repo === 'old/repo')).toBe(false)
  })
})
