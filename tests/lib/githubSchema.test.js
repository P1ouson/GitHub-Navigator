/**
 * githubSchema 单元测试
 *
 * 覆盖：
 *   - normalizeRepoSummary 占位值 null（不再 ?? 0）
 *   - normalizeRepoSummaryFromCache 占位值 null
 *   - normalizeRepoEntryFromREST（新增）
 *   - normalizeRepoEntryFromGraphQL（新增）
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeRepoSummary,
  normalizeRepoSummaryFromCache,
  normalizeRepoEntryFromREST,
  normalizeRepoEntryFromGraphQL,
  normalizeIssueSummaryFromRepoIssue,
} from '../../src/lib/githubSchema.js'

describe('normalizeRepoSummary - 占位值 null', () => {
  const baseItem = {
    full_name: 'facebook/react',
    id: 10270250,
    description: 'React library',
    html_url: 'https://github.com/facebook/react',
    language: 'JavaScript',
    topics: ['react', 'ui'],
    updated_at: '2024-01-01T00:00:00Z',
    archived: false,
  }

  it('缺 stargazers_count → stars = null（不是 0）', () => {
    const r = normalizeRepoSummary(baseItem)
    expect(r.stars).toBeNull()
  })

  it('缺 forks_count → forks = null（不是 0）', () => {
    const r = normalizeRepoSummary(baseItem)
    expect(r.forks).toBeNull()
  })

  it('缺 open_issues_count → openIssues = null（不是 0）', () => {
    const r = normalizeRepoSummary(baseItem)
    expect(r.openIssues).toBeNull()
  })

  it('有 stargazers_count → stars = number', () => {
    const r = normalizeRepoSummary({ ...baseItem, stargazers_count: 200000 })
    expect(r.stars).toBe(200000)
  })

  it('主字段正确 + 不再输出兼容字段', () => {
    const r = normalizeRepoSummary({ ...baseItem, stargazers_count: 100, forks_count: 10, open_issues_count: 5, pushed_at: '2024-02-01T00:00:00Z' })
    expect(r.fullName).toBe('facebook/react')
    expect(r.desc).toBe('React library')
    expect(r.updatedAt).toBe('2024-01-01T00:00:00Z')
    // 兼容字段已删除（Step 8）
    expect(r).not.toHaveProperty('full_name')
    expect(r).not.toHaveProperty('description')
    expect(r).not.toHaveProperty('pushedAt')
    expect(r).not.toHaveProperty('owner')
  })
})

describe('normalizeRepoSummaryFromCache - 占位值 null', () => {
  it('缺 stars/forks/openIssues → null（不是 0）', () => {
    const entry = { fullName: 'a/b', desc: 'test' }
    const r = normalizeRepoSummaryFromCache(entry, 'a/b')
    expect(r.stars).toBeNull()
    expect(r.forks).toBeNull()
    expect(r.openIssues).toBeNull()
  })

  it('stars:0（旧缓存）→ 0（保留真实 0）', () => {
    const entry = { fullName: 'a/b', stars: 0, forks: 0, openIssues: 0 }
    const r = normalizeRepoSummaryFromCache(entry, 'a/b')
    expect(r.stars).toBe(0)
    expect(r.forks).toBe(0)
    expect(r.openIssues).toBe(0)
  })

  it('不再输出兼容字段（Step 8 已删除双写）', () => {
    const entry = { fullName: 'a/b', desc: 'test', stars: 100 }
    const r = normalizeRepoSummaryFromCache(entry, 'a/b')
    expect(r).not.toHaveProperty('full_name')
    expect(r).not.toHaveProperty('description')
    expect(r).not.toHaveProperty('pushedAt')
    expect(r).not.toHaveProperty('owner')
  })

  it('旧缓存兼容：entry 只有 description 无 desc → 仍能读到', () => {
    // 旧缓存 entry 可能只有兼容字段 description，无主字段 desc
    const oldEntry = { fullName: 'a/b', description: 'old cache desc', stars: 50 }
    const r = normalizeRepoSummaryFromCache(oldEntry, 'a/b')
    expect(r.desc).toBe('old cache desc')
  })

  it('旧缓存兼容：entry 只有 pushedAt 无 updatedAt → 仍能读到', () => {
    const oldEntry = { fullName: 'a/b', pushedAt: '2024-01-01T00:00:00Z' }
    const r = normalizeRepoSummaryFromCache(oldEntry, 'a/b')
    expect(r.updatedAt).toBe('2024-01-01T00:00:00Z')
  })

  it('新缓存 entry 优先读主字段', () => {
    const newEntry = {
      fullName: 'a/b',
      desc: 'new desc',
      description: 'old desc',
      updatedAt: '2024-06-01T00:00:00Z',
      pushedAt: '2024-01-01T00:00:00Z',
    }
    const r = normalizeRepoSummaryFromCache(newEntry, 'a/b')
    expect(r.desc).toBe('new desc')
    expect(r.updatedAt).toBe('2024-06-01T00:00:00Z')
  })
})

describe('normalizeRepoEntryFromREST', () => {
  const restData = {
    full_name: 'vercel/next.js',
    description: 'The React Framework',
    stargazers_count: 120000,
    forks_count: 26000,
    open_issues_count: 1500,
    language: 'JavaScript',
    html_url: 'https://github.com/vercel/next.js',
    topics: ['nextjs', 'react', 'ssr'],
    updated_at: '2024-06-01T00:00:00Z',
    pushed_at: '2024-06-02T00:00:00Z',
    archived: false,
    owner: { login: 'vercel' },
  }

  it('REST 响应 → entry，主字段正确', () => {
    const e = normalizeRepoEntryFromREST(restData, 'vercel/next.js')
    expect(e.name).toBe('vercel/next.js')
    expect(e.fullName).toBe('vercel/next.js')
    expect(e.stars).toBe(120000)
    expect(e.forks).toBe(26000)
    expect(e.openIssues).toBe(1500)
    expect(e.language).toBe('JavaScript')
    expect(e.archived).toBe(false)
    expect(e._ts).toBeTypeOf('number')
  })

  it('不再输出兼容字段（Step 8 已删除双写）', () => {
    const e = normalizeRepoEntryFromREST(restData, 'vercel/next.js')
    expect(e).not.toHaveProperty('full_name')
    expect(e).not.toHaveProperty('description')
    expect(e).not.toHaveProperty('pushedAt')
    expect(e).not.toHaveProperty('owner')
  })

  it('缺 stargazers_count → stars = null（不是 0）', () => {
    const { stargazers_count, forks_count, open_issues_count, ...missing } = restData
    const e = normalizeRepoEntryFromREST(missing, 'vercel/next.js')
    expect(e.stars).toBeNull()
    expect(e.forks).toBeNull()
    expect(e.openIssues).toBeNull()
  })

  it('topics 截断到 5 个', () => {
    const data = { ...restData, topics: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }
    const e = normalizeRepoEntryFromREST(data, 'vercel/next.js')
    expect(e.topics).toHaveLength(5)
  })
})

describe('normalizeRepoEntryFromGraphQL', () => {
  const gqlInfo = {
    pushedAt: '2024-06-02T00:00:00Z',
    isArchived: false,
    stargazerCount: 120000,
    primaryLanguage: { name: 'JavaScript' },
    forkCount: 26000,
    issues: { totalCount: 1500 },
    description: 'The React Framework',
    url: 'https://github.com/vercel/next.js',
    updatedAt: '2024-06-01T00:00:00Z',
    repositoryTopics: {
      nodes: [
        { topic: { name: 'nextjs' } },
        { topic: { name: 'react' } },
      ],
    },
  }

  it('GraphQL 响应 → entry，主字段正确', () => {
    const e = normalizeRepoEntryFromGraphQL(gqlInfo, 'vercel/next.js')
    expect(e.name).toBe('vercel/next.js')
    expect(e.fullName).toBe('vercel/next.js')
    expect(e.stars).toBe(120000)
    expect(e.forks).toBe(26000)
    expect(e.openIssues).toBe(1500)
    expect(e.language).toBe('JavaScript')
    expect(e.archived).toBe(false)
  })

  it('不再输出兼容字段（Step 8 已删除双写）', () => {
    const e = normalizeRepoEntryFromGraphQL(gqlInfo, 'vercel/next.js')
    expect(e).not.toHaveProperty('full_name')
    expect(e).not.toHaveProperty('description')
    expect(e).not.toHaveProperty('pushedAt')
    expect(e).not.toHaveProperty('owner')
  })

  it('repositoryTopics 解析正确', () => {
    const e = normalizeRepoEntryFromGraphQL(gqlInfo, 'vercel/next.js')
    expect(e.topics).toEqual(['nextjs', 'react'])
  })

  it('缺 stargazerCount → stars = null（不是 0）', () => {
    const { stargazerCount, forkCount, issues, ...missing } = gqlInfo
    const e = normalizeRepoEntryFromGraphQL(missing, 'vercel/next.js')
    expect(e.stars).toBeNull()
    expect(e.forks).toBeNull()
    expect(e.openIssues).toBeNull()
  })

  it('primaryLanguage 为 null → language = null', () => {
    const e = normalizeRepoEntryFromGraphQL({ ...gqlInfo, primaryLanguage: null }, 'vercel/next.js')
    expect(e.language).toBeNull()
  })

  it('repositoryTopics.nodes 为空数组 → topics = []', () => {
    const e = normalizeRepoEntryFromGraphQL({ ...gqlInfo, repositoryTopics: { nodes: [] } }, 'vercel/next.js')
    expect(e.topics).toEqual([])
  })
})

describe('normalizeIssueSummaryFromRepoIssue - user 字段已删除', () => {
  const rawIssue = {
    id: 12345,
    number: 42,
    title: 'Fix bug',
    labels: [{ name: 'bug' }],
    html_url: 'https://github.com/owner/repo/issues/42',
    state: 'open',
    created_at: '2024-01-01T00:00:00Z',
    comments: 5,
    body: 'Issue body',
    user: { login: 'contributor1' },
  }

  it('不再输出 user 兼容字段', () => {
    const s = normalizeIssueSummaryFromRepoIssue(rawIssue, 'owner/repo')
    expect(s).not.toHaveProperty('user')
  })

  it('主字段正常输出', () => {
    const s = normalizeIssueSummaryFromRepoIssue(rawIssue, 'owner/repo')
    expect(s.id).toBe(12345)
    expect(s.number).toBe(42)
    expect(s.title).toBe('Fix bug')
    expect(s.repo).toBe('owner/repo')
    expect(s.state).toBe('open')
    expect(s.comments).toBe(5)
    expect(s.body).toBe('Issue body')
  })

  it('user 缺失不崩', () => {
    const { user, ...noUser } = rawIssue
    const s = normalizeIssueSummaryFromRepoIssue(noUser, 'owner/repo')
    expect(s).not.toHaveProperty('user')
  })
})
