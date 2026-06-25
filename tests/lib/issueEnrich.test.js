/**
 * issueEnrich 单元测试
 *
 * 覆盖：
 *   - assessLiveness 读主字段 updatedAt，兼容 pushedAt
 *   - enrichIssues 纯函数（entry 缺失 → unknown，缺字段 → null）
 *   - filterByLiveness（unknown 保留）
 *   - filterByStars（null stars 不被过滤）
 */
import { describe, it, expect } from 'vitest'
import {
  assessLiveness,
  isRepoEligibleForIssues,
  enrichIssues,
  filterByLiveness,
  filterByStars,
} from '../../src/lib/issueEnrich.js'

describe('assessLiveness', () => {
  it('info 为 null → dead', () => {
    expect(assessLiveness(null)).toEqual({ level: 'dead', days: null })
  })

  it('archived → dead', () => {
    expect(assessLiveness({ archived: true, updatedAt: '2024-01-01' })).toEqual({ level: 'dead', days: null })
  })

  it('读主字段 updatedAt', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const r = assessLiveness({ archived: false, updatedAt: recent })
    expect(r.level).toBe('active')
    expect(r.days).toBeTypeOf('number')
  })

  it('兼容旧字段 pushedAt（updatedAt 缺失时）', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const r = assessLiveness({ archived: false, pushedAt: recent })
    expect(r.level).toBe('active')
  })

  it('updatedAt 优先于 pushedAt', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const old = '2020-01-01T00:00:00Z'
    const r = assessLiveness({ archived: false, updatedAt: recent, pushedAt: old })
    expect(r.level).toBe('active')
  })

  it('缺时间字段 → unknown', () => {
    expect(assessLiveness({ archived: false })).toEqual({ level: 'unknown', days: null })
  })

  it('超过 730 天 → dead', () => {
    const old = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString()
    expect(assessLiveness({ archived: false, updatedAt: old }).level).toBe('dead')
  })
})

describe('isRepoEligibleForIssues', () => {
  it('health 为 null → false', () => {
    expect(isRepoEligibleForIssues(null, 'maintained')).toBe(false)
  })

  it('unknown + maintained → true（API 失败不算坏）', () => {
    expect(isRepoEligibleForIssues({ level: 'unknown' }, 'maintained')).toBe(true)
  })

  it('unknown + active → false', () => {
    expect(isRepoEligibleForIssues({ level: 'unknown' }, 'active')).toBe(false)
  })

  it('dead + any → false（archived 仍排除）', () => {
    expect(isRepoEligibleForIssues({ level: 'dead' }, 'any')).toBe(false)
  })

  it('inactive + maintained → false', () => {
    expect(isRepoEligibleForIssues({ level: 'inactive' }, 'maintained')).toBe(false)
  })

  it('inactive + any → true', () => {
    expect(isRepoEligibleForIssues({ level: 'inactive' }, 'any')).toBe(true)
  })
})

describe('enrichIssues', () => {
  const issues = [
    { id: 1, repo: 'a/b', title: 'issue1' },
    { id: 2, repo: 'c/d', title: 'issue2' },
    { id: 3, repo: 'e/f', title: 'issue3' },
  ]

  it('entry 存在 → _repoHealth 有值', () => {
    const entries = new Map([
      ['a/b', { stars: 100, forks: 10, language: 'JS', updatedAt: new Date().toISOString(), archived: false }],
    ])
    const r = enrichIssues([issues[0]], entries)
    expect(r[0]._repoHealth).not.toBeNull()
    expect(r[0]._repoHealth.stars).toBe(100)
    expect(r[0]._repoHealth.liveness.level).toBe('active')
  })

  it('entry 缺失 → _repoHealth.liveness = unknown（不伪造）', () => {
    const r = enrichIssues([issues[1]], new Map())
    expect(r[0]._repoHealth.liveness.level).toBe('unknown')
    expect(r[0]._repoHealth.stars).toBeNull()
    expect(r[0]._repoHealth.forks).toBeNull()
  })

  it('entry 缺 stars → _repoHealth.stars = null（不是 0）', () => {
    const entries = new Map([
      ['a/b', { language: 'JS', updatedAt: new Date().toISOString(), archived: false }],
    ])
    const r = enrichIssues([issues[0]], entries)
    expect(r[0]._repoHealth.stars).toBeNull()
    expect(r[0]._repoHealth.forks).toBeNull()
  })

  it('_repoHealth 永不为 null（总有 liveness）', () => {
    const r = enrichIssues(issues, new Map())
    for (const issue of r) {
      expect(issue._repoHealth).not.toBeNull()
      expect(issue._repoHealth.liveness).toBeDefined()
    }
  })

  it('保留原 issue 字段', () => {
    const entries = new Map([['a/b', { stars: 1, archived: false }]])
    const r = enrichIssues([issues[0]], entries)
    expect(r[0].id).toBe(1)
    expect(r[0].title).toBe('issue1')
    expect(r[0].repo).toBe('a/b')
  })
})

describe('filterByLiveness', () => {
  it('maintained 过滤掉 dead/inactive，保留 unknown', () => {
    const issues = [
      { _repoHealth: { liveness: { level: 'active' } } },
      { _repoHealth: { liveness: { level: 'maintained' } } },
      { _repoHealth: { liveness: { level: 'inactive' } } },
      { _repoHealth: { liveness: { level: 'dead' } } },
      { _repoHealth: { liveness: { level: 'unknown' } } },
    ]
    const r = filterByLiveness(issues, 'maintained')
    expect(r).toHaveLength(3) // active + maintained + unknown
    expect(r.map(i => i._repoHealth.liveness.level)).toEqual(['active', 'maintained', 'unknown'])
  })

  it('any 仅排除 dead', () => {
    const issues = [
      { _repoHealth: { liveness: { level: 'inactive' } } },
      { _repoHealth: { liveness: { level: 'dead' } } },
      { _repoHealth: { liveness: { level: 'unknown' } } },
    ]
    const r = filterByLiveness(issues, 'any')
    expect(r).toHaveLength(2)
  })
})

describe('filterByStars', () => {
  it('null stars 不被过滤（未知保留）', () => {
    const issues = [
      { _repoHealth: { stars: null } },
      { _repoHealth: { stars: 50 } },
    ]
    const r = filterByStars(issues, 100, 0)
    expect(r).toHaveLength(1) // 只有 null 的保留
    expect(r[0]._repoHealth.stars).toBeNull()
  })

  it('minStars 过滤低星', () => {
    const issues = [
      { _repoHealth: { stars: 50 } },
      { _repoHealth: { stars: 200 } },
      { _repoHealth: { stars: 500 } },
    ]
    const r = filterByStars(issues, 100, 0)
    expect(r).toHaveLength(2)
  })

  it('maxStars 过滤高星', () => {
    const issues = [
      { _repoHealth: { stars: 50 } },
      { _repoHealth: { stars: 200 } },
      { _repoHealth: { stars: 5000 } },
    ]
    const r = filterByStars(issues, 0, 1000)
    expect(r).toHaveLength(2)
  })

  it('minStars=0 + maxStars=0 → 全保留', () => {
    const issues = [
      { _repoHealth: { stars: null } },
      { _repoHealth: { stars: 0 } },
      { _repoHealth: { stars: 99999 } },
    ]
    const r = filterByStars(issues, 0, 0)
    expect(r).toHaveLength(3)
  })

  it('区间过滤', () => {
    const issues = [
      { _repoHealth: { stars: 50 } },
      { _repoHealth: { stars: 200 } },
      { _repoHealth: { stars: 5000 } },
    ]
    const r = filterByStars(issues, 100, 1000)
    expect(r).toHaveLength(1)
    expect(r[0]._repoHealth.stars).toBe(200)
  })
})
