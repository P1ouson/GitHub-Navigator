/**
 * repoHealth 单元测试
 *
 * 覆盖：
 *   - calcAnalysisScores null 跳过维度（stars/forks/openIssues 为 null 时不加分）
 *   - calcAnalysisScores 所有字段 null → 总分不崩（不为 NaN）
 *   - calcAnalysisScores archived 仓库总分 = 0
 *   - calcAnalysisScores 正常数据评分合理
 *   - assessLiveness 四维度取最新
 *   - assessLiveness 无数据 → level='未知', status='warn'
 *   - assessLiveness archived → level='疑似废弃', status='bad'
 */
import { describe, it, expect } from 'vitest'
import { calcAnalysisScores, assessLiveness } from '../../src/lib/repoHealth.js'

/* ===== 测试数据工厂 ===== */

function makeBaseData(overrides = {}) {
  return {
    info: {
      name: 'facebook/react',
      fullName: 'facebook/react',
      desc: 'React library',
      stars: 200000,
      forks: 40000,
      openIssues: 500,
      trueOpenIssues: 480,
      language: 'JavaScript',
      archived: false,
      topics: ['react', 'ui', 'library', 'frontend', 'javascript'],
      ...overrides.info,
    },
    daysSinceLastCommit: 1,
    daysSincePush: 1,
    daysSinceUpdated: 1,
    daysSinceCommunity: 1,
    commits30d: 50,
    contributorCount: 100,
    gfiCount: 10,
    helpWantedCount: 5,
    hasReleases: true,
    hasContributing: true,
    hasReadme: true,
    prDays: 2,
    prMergeRate: 80,
    openPRCount: 10,
    community: {
      hasCodeOfConduct: true,
      hasIssueTemplate: true,
      hasPullRequestTemplate: true,
    },
    ...overrides,
  }
}

/* ===== calcAnalysisScores ===== */

describe('calcAnalysisScores - archived 仓库', () => {
  it('archived 仓库总分 = 0', () => {
    const data = makeBaseData({ info: { archived: true, stars: 99999, forks: 9999 } })
    const s = calcAnalysisScores(data)
    expect(s.total).toBe(0)
    expect(s.activity).toBe(0)
    expect(s.contributors).toBe(0)
    expect(s.ecosystem).toBe(0)
  })
})

describe('calcAnalysisScores - null 跳过维度', () => {
  it('stars=null 时跳过 star 加分（ecosystem 不含 star 分）', () => {
    const data = makeBaseData({ info: { stars: null, forks: 40000, topics: ['a', 'b', 'c', 'd', 'e'] } })
    const s = calcAnalysisScores(data)
    // topics=5 → ecosystem=4，forks>=1000 → +1，stars=null 不加分
    // ecosystem = 4 + 1 = 5（不含 star 分）
    expect(s.ecosystem).toBe(5)
  })

  it('forks=null 时跳过 fork 加分', () => {
    const data = makeBaseData({ info: { stars: 200000, forks: null, topics: ['a', 'b', 'c', 'd', 'e'] } })
    const s = calcAnalysisScores(data)
    // topics=5 → 4，stars>=10000 → +4，forks=null 不加分
    expect(s.ecosystem).toBe(8)
  })

  it('openIssues=null 时跳过 PR 比例加分（走 else 分支 +2）', () => {
    const data = makeBaseData({
      info: { trueOpenIssues: null, openIssues: null, stars: 200000, forks: 40000 },
    })
    const s = calcAnalysisScores(data)
    // openIssues=null → 走 else 分支，maintenance += 2
    expect(s.maintenance).toBeGreaterThanOrEqual(2)
  })

  it('stars/forks/openIssues 全 null → 总分不为 NaN', () => {
    const data = makeBaseData({
      info: { stars: null, forks: null, trueOpenIssues: null, openIssues: null, topics: [] },
    })
    const s = calcAnalysisScores(data)
    expect(Number.isNaN(s.total)).toBe(false)
    expect(Number.isNaN(s.ecosystem)).toBe(false)
    expect(Number.isNaN(s.maintenance)).toBe(false)
  })

  it('commits30d=null → 按 0 处理（计数型，0 是合理值）', () => {
    const data = makeBaseData({ commits30d: null })
    const s = calcAnalysisScores(data)
    // commits30d=null → ?? 0 → 不加分，但 activity 仍有时间维度基础分
    expect(s.activity).toBeGreaterThan(0)
    expect(Number.isNaN(s.activity)).toBe(false)
  })

  it('contributorCount=null → 按 0 处理（计数型）', () => {
    const data = makeBaseData({ contributorCount: null })
    const s = calcAnalysisScores(data)
    // contributorCount=null → ?? 0 → contributors=0，但 hasReleases 仍 +3
    expect(s.contributors).toBe(3) // hasReleases=true → 0+3
  })
})

describe('calcAnalysisScores - 正常数据评分', () => {
  it('正常数据总分合理（> 50）', () => {
    const data = makeBaseData()
    const s = calcAnalysisScores(data)
    expect(s.total).toBeGreaterThan(50)
    expect(s.total).toBeLessThanOrEqual(100)
  })

  it('各维度分值在合理范围', () => {
    const data = makeBaseData()
    const s = calcAnalysisScores(data)
    expect(s.activity).toBeGreaterThanOrEqual(0)
    expect(s.activity).toBeLessThanOrEqual(20)
    expect(s.contributors).toBeGreaterThanOrEqual(0)
    expect(s.contributors).toBeLessThanOrEqual(15)
    expect(s.beginner).toBeGreaterThanOrEqual(0)
    expect(s.beginner).toBeLessThanOrEqual(20)
    expect(s.maintenance).toBeGreaterThanOrEqual(0)
    expect(s.maintenance).toBeLessThanOrEqual(20)
    expect(s.docs).toBeGreaterThanOrEqual(0)
    expect(s.docs).toBeLessThanOrEqual(15)
    expect(s.ecosystem).toBeGreaterThanOrEqual(0)
    expect(s.ecosystem).toBeLessThanOrEqual(10)
  })

  it('total = 各维度之和', () => {
    const data = makeBaseData()
    const s = calcAnalysisScores(data)
    expect(s.total).toBe(s.activity + s.contributors + s.beginner + s.maintenance + s.docs + s.ecosystem)
  })
})

/* ===== assessLiveness ===== */

describe('assessLiveness - 四维度取最新', () => {
  it('取四维度中天数最小的', () => {
    const data = {
      daysSinceCommunity: 5,
      daysSinceUpdated: 10,
      daysSincePush: 20,
      daysSinceLastCommit: 30,
    }
    const l = assessLiveness(data)
    expect(l.days).toBe(5)
    expect(l.basis).toBe('社区活动')
  })

  it('部分维度为 null 时取非 null 中最小的', () => {
    const data = {
      daysSinceCommunity: null,
      daysSinceUpdated: 15,
      daysSincePush: null,
      daysSinceLastCommit: 3,
    }
    const l = assessLiveness(data)
    expect(l.days).toBe(3)
    expect(l.basis).toBe('Commit')
  })

  it('days <= 30 → level=活跃, status=good', () => {
    const l = assessLiveness({ daysSinceLastCommit: 10 })
    expect(l.level).toBe('活跃')
    expect(l.status).toBe('good')
  })

  it('30 < days <= 180 → level=维护中, status=warn', () => {
    const l = assessLiveness({ daysSinceLastCommit: 90 })
    expect(l.level).toBe('维护中')
    expect(l.status).toBe('warn')
  })

  it('180 < days <= 365 → level=低活跃, status=warn', () => {
    const l = assessLiveness({ daysSinceLastCommit: 200 })
    expect(l.level).toBe('低活跃')
    expect(l.status).toBe('warn')
  })

  it('days > 365 → level=疑似废弃, status=bad', () => {
    const l = assessLiveness({ daysSinceLastCommit: 400 })
    expect(l.level).toBe('疑似废弃')
    expect(l.status).toBe('bad')
  })
})

describe('assessLiveness - 边界情况', () => {
  it('无任何时间数据 → level=未知, status=warn', () => {
    const l = assessLiveness({})
    expect(l.level).toBe('未知')
    expect(l.status).toBe('warn')
    expect(l.days).toBeNull()
    expect(l.basis).toBe('无时间数据')
  })

  it('所有维度为 null → level=未知', () => {
    const l = assessLiveness({
      daysSinceCommunity: null,
      daysSinceUpdated: null,
      daysSincePush: null,
      daysSinceLastCommit: null,
    })
    expect(l.level).toBe('未知')
    expect(l.status).toBe('warn')
  })
})
