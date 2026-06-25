/**
 * repoService 单元测试
 *
 * 覆盖：
 *   - getRepoEntry：缓存命中/miss/API 失败
 *   - batchGetRepoEntries：部分命中/GraphQL 成功/GraphQL 失败 REST 降级
 *   - getRepoSummary：缓存命中不调 API / API 失败抛错
 *   - batchGetRepoSummaries：返回 Map<repo, RepoSummary>
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockOctokit } = vi.hoisted(() => ({
  mockOctokit: {
    rest: { repos: { get: vi.fn() } },
    graphql: vi.fn(),
  },
}))

// mock github.js（getOctokit/safeGithub）
vi.mock('../../src/lib/github.js', () => ({
  getOctokit: () => mockOctokit,
  safeGithub: async (fn, fallback) => {
    try { return await fn() } catch { return fallback }
  },
}))

// mock db.js（repoCache 持久化用）
vi.mock('../../src/lib/db.js', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
}))

import { getRepoEntry, batchGetRepoEntries, getRepoSummary, batchGetRepoSummaries } from '../../src/lib/repoService.js'

beforeEach(() => {
  mockOctokit.rest.repos.get.mockReset()
  mockOctokit.graphql.mockReset()
})

describe('getRepoEntry', () => {
  it('缓存命中 → 不调 API', async () => {
    // 先写入缓存（用 setRepoCacheEntry）
    const { setRepoCacheEntry } = await import('../../src/lib/repoCache.js')
    const entry = { fullName: 'hit/repo', stars: 100, _ts: Date.now() }
    setRepoCacheEntry('hit/repo', entry)

    const r = await getRepoEntry('hit', 'repo')
    expect(r).toEqual(entry)
    expect(mockOctokit.rest.repos.get).not.toHaveBeenCalled()
  })

  it('缓存 miss → 调 API → normalize → 写缓存', async () => {
    mockOctokit.rest.repos.get.mockResolvedValue({
      data: {
        full_name: 'api/repo',
        description: 'test',
        stargazers_count: 50,
        forks_count: 5,
        open_issues_count: 3,
        language: 'JS',
        html_url: 'https://github.com/api/repo',
        topics: ['t'],
        updated_at: '2024-01-01',
        archived: false,
        owner: { login: 'api' },
      },
    })

    const r = await getRepoEntry('api', 'repo')
    expect(mockOctokit.rest.repos.get).toHaveBeenCalledWith({ owner: 'api', repo: 'repo' })
    expect(r.fullName).toBe('api/repo')
    expect(r.stars).toBe(50)
    expect(r.stars).not.toBe(0) // 不是占位值
    expect(r._ts).toBeTypeOf('number')
    // 兼容字段已删除（Step 8）
    expect(r).not.toHaveProperty('full_name')
    expect(r).not.toHaveProperty('owner')
    expect(r).not.toHaveProperty('description')
    expect(r).not.toHaveProperty('pushedAt')
  })

  it('API 失败 → 返回 null', async () => {
    mockOctokit.rest.repos.get.mockRejectedValue(new Error('404'))
    const r = await getRepoEntry('fail', 'repo')
    expect(r).toBeNull()
  })

  it('缺 stargazers_count → stars = null（不是 0）', async () => {
    mockOctokit.rest.repos.get.mockResolvedValue({
      data: { full_name: 'missing/repo', description: null, html_url: '', archived: false },
    })
    const r = await getRepoEntry('missing', 'repo')
    expect(r.stars).toBeNull()
    expect(r.forks).toBeNull()
    expect(r.openIssues).toBeNull()
  })
})

describe('getRepoSummary', () => {
  it('缓存命中 → 返回 RepoSummary，不调 API', async () => {
    const { setRepoCacheEntry } = await import('../../src/lib/repoCache.js')
    setRepoCacheEntry('sum/repo', { fullName: 'sum/repo', stars: 200, _ts: Date.now() })

    const r = await getRepoSummary('sum', 'repo')
    expect(r.fullName).toBe('sum/repo')
    expect(r.stars).toBe(200)
    expect(mockOctokit.rest.repos.get).not.toHaveBeenCalled()
  })

  it('API 失败 → 抛错', async () => {
    mockOctokit.rest.repos.get.mockRejectedValue(new Error('not found'))
    await expect(getRepoSummary('throw', 'repo')).rejects.toThrow('仓库不存在或无法访问')
  })
})

describe('batchGetRepoEntries', () => {
  it('全部缓存命中 → 不调 API', async () => {
    const { setRepoCacheEntry } = await import('../../src/lib/repoCache.js')
    setRepoCacheEntry('batch/hit1', { fullName: 'batch/hit1', stars: 1, _ts: Date.now() })
    setRepoCacheEntry('batch/hit2', { fullName: 'batch/hit2', stars: 2, _ts: Date.now() })

    const { map, stats } = await batchGetRepoEntries(['batch/hit1', 'batch/hit2'])
    expect(map.size).toBe(2)
    expect(stats.cacheHits).toBe(2)
    expect(mockOctokit.graphql).not.toHaveBeenCalled()
  })

  it('GraphQL 成功 → 写缓存', async () => {
    mockOctokit.graphql.mockResolvedValue({
      r0: {
        stargazerCount: 100,
        forkCount: 10,
        issues: { totalCount: 5 },
        description: 'test',
        url: 'https://github.com/gql/repo',
        updatedAt: '2024-01-01',
        pushedAt: '2024-01-02',
        isArchived: false,
        primaryLanguage: { name: 'JS' },
        repositoryTopics: { nodes: [{ topic: { name: 't' } }] },
      },
    })

    const { map, stats } = await batchGetRepoEntries(['gql/repo'])
    expect(mockOctokit.graphql).toHaveBeenCalled()
    expect(map.size).toBe(1)
    const entry = map.get('gql/repo')
    expect(entry.stars).toBe(100)
    expect(entry.forks).toBe(10)
    expect(entry.openIssues).toBe(5)
    expect(entry.owner).toBeUndefined() // GraphQL 路径
    // 验证已写缓存
    const { getRepoCacheEntry } = await import('../../src/lib/repoCache.js')
    expect(getRepoCacheEntry('gql/repo')).toEqual(entry)
  })

  it('GraphQL 失败 → REST 降级', async () => {
    mockOctokit.graphql.mockRejectedValue(new Error('gql error'))
    mockOctokit.rest.repos.get.mockResolvedValue({
      data: {
        full_name: 'fallback/repo',
        description: 'rest',
        stargazers_count: 30,
        forks_count: 3,
        open_issues_count: 2,
        html_url: 'https://github.com/fallback/repo',
        archived: false,
        owner: { login: 'fallback' },
      },
    })

    const { map } = await batchGetRepoEntries(['fallback/repo'])
    expect(mockOctokit.graphql).toHaveBeenCalled()
    expect(mockOctokit.rest.repos.get).toHaveBeenCalled()
    const entry = map.get('fallback/repo')
    expect(entry.stars).toBe(30)
    // 兼容字段已删除（Step 8），REST 降级路径也不输出 owner
    expect(entry).not.toHaveProperty('owner')
    expect(entry).not.toHaveProperty('full_name')
  })

  it('GraphQL + REST 都失败 → repo 不入 map', async () => {
    mockOctokit.graphql.mockRejectedValue(new Error('gql error'))
    mockOctokit.rest.repos.get.mockRejectedValue(new Error('rest error'))

    const { map } = await batchGetRepoEntries(['allfail/repo'])
    expect(map.has('allfail/repo')).toBe(false)
  })

  it('部分缓存命中 → 只 fetch miss 的', async () => {
    const { setRepoCacheEntry } = await import('../../src/lib/repoCache.js')
    setRepoCacheEntry('partial/hit', { fullName: 'partial/hit', stars: 1, _ts: Date.now() })

    mockOctokit.graphql.mockResolvedValue({
      r0: {
        stargazerCount: 200, forkCount: 20, issues: { totalCount: 10 },
        description: 'miss', url: '', updatedAt: '2024-01-01', pushedAt: '2024-01-01',
        isArchived: false, primaryLanguage: null, repositoryTopics: { nodes: [] },
      },
    })

    const { map, stats } = await batchGetRepoEntries(['partial/hit', 'partial/miss'])
    expect(stats.cacheHits).toBe(1)
    expect(map.size).toBe(2)
    expect(map.get('partial/hit').stars).toBe(1)
    expect(map.get('partial/miss').stars).toBe(200)
  })
})

describe('batchGetRepoSummaries', () => {
  it('返回 Map<repo, RepoSummary>', async () => {
    const { setRepoCacheEntry } = await import('../../src/lib/repoCache.js')
    setRepoCacheEntry('summ/repo', { fullName: 'summ/repo', stars: 500, forks: 50, _ts: Date.now() })

    const summaries = await batchGetRepoSummaries(['summ/repo'])
    expect(summaries).toBeInstanceOf(Map)
    const s = summaries.get('summ/repo')
    expect(s.fullName).toBe('summ/repo')
    expect(s.stars).toBe(500)
    expect(s.id).toBe('summ/repo') // RepoSummary.id = fullName
  })
})
