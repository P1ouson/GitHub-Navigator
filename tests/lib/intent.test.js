/**
 * 两阶段意图识别测试（P3 重构）
 *
 * 核心验证：属性词（简单/新手/活跃）只修饰类别，不决定类别
 */
import { describe, it, expect } from 'vitest'
import { routeQuery } from '../../src/lib/intent.js'

describe('两阶段意图识别', () => {

  describe('Stage 1: 对象类型识别（属性词不决定类别）', () => {

    it('"简单的 python 项目" → repo（不是 issue）', () => {
      const plan = routeQuery('我需要一个简单一点的 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.sources).toContain('repo')
      expect(plan.reason).toContain('项目')
    })

    it('"简单的 issue" → issue（显式对象词）', () => {
      const plan = routeQuery('简单的 issue')
      expect(plan.intent).toBe('issue')
      expect(plan.sources).toContain('issue')
    })

    it('"新手项目" → repo（不是 issue）', () => {
      const plan = routeQuery('新手项目')
      expect(plan.intent).toBe('repo')
      expect(plan.sources).toContain('repo')
    })

    it('"新手 issue" → issue + good first issue 扩词', () => {
      const plan = routeQuery('新手 issue')
      expect(plan.intent).toBe('issue')
      expect(plan.sources).toContain('issue')
      expect(plan.query_by_source.issue).toContain('good first issue')
    })

    it('"活跃的 python 项目" → repo + 活跃度过滤', () => {
      const plan = routeQuery('活跃的 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.updatedAfter).toBeTruthy()
    })

    it('"活跃的 issue" → issue（不是 repo）', () => {
      const plan = routeQuery('活跃的 issue')
      expect(plan.intent).toBe('issue')
    })

    it('"react"（无对象词）→ 不走两阶段，交给 L1', () => {
      const plan = routeQuery('react')
      // 短词走 L1 mixed/unknown
      expect(plan.intent).toBeTruthy()
    })
  })

  describe('Stage 2: 属性提取（修饰 filters，不改变类别）', () => {

    it('complexity=simple → repo minStars 低门槛', () => {
      const plan = routeQuery('简单的 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.minStars).toBeLessThanOrEqual(10)
    })

    it('complexity=complex → repo minStars 高门槛', () => {
      const plan = routeQuery('复杂的 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.minStars).toBeGreaterThanOrEqual(1000)
    })

    it('quality=high → repo minStars 1000+', () => {
      const plan = routeQuery('优秀的 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.minStars).toBeGreaterThanOrEqual(1000)
    })

    it('activity=active → repo updatedAfter 设置', () => {
      const plan = routeQuery('活跃的 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.updatedAfter).toBeTruthy()
    })

    it('beginner + repo → minStars 上限 200（小项目易理解）', () => {
      const plan = routeQuery('新手 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.minStars).toBeLessThanOrEqual(200)
    })
  })

  describe('组合场景', () => {

    it('"活跃的优秀 python 项目" → repo + 活跃+高质量', () => {
      const plan = routeQuery('活跃的优秀 python 项目')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.updatedAfter).toBeTruthy()
      expect(plan.filters.minStars).toBeGreaterThanOrEqual(1000)
    })

    it('"简单的 python 教程" → knowledge（教程是对象词）', () => {
      const plan = routeQuery('简单的 python 教程')
      expect(plan.intent).toBe('qa')
      expect(plan.sources).toContain('knowledge')
    })

    it('"python 报错" → issue（报错是对象词）', () => {
      const plan = routeQuery('python 报错')
      expect(plan.intent).toBe('issue')
      expect(plan.sources).toContain('issue')
    })

    it('"react 是什么" → knowledge（概念提问）', () => {
      const plan = routeQuery('react 是什么')
      expect(plan.intent).toBe('qa')
      expect(plan.sources).toContain('knowledge')
    })

    it('"python 代码" → code（代码是对象词）', () => {
      const plan = routeQuery('python 代码')
      expect(plan.intent).toBe('code')
      expect(plan.sources).toContain('code')
    })

    it('"轻量级框架" → repo（框架是对象词，轻量是属性）', () => {
      const plan = routeQuery('轻量级框架')
      expect(plan.intent).toBe('repo')
      expect(plan.filters.minStars).toBeLessThanOrEqual(10)
    })
  })

  describe('性能基准', () => {

    it('routeQuery 单次调用 < 5ms', () => {
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        routeQuery('我需要一个简单一点的 python 项目')
      }
      const elapsed = performance.now() - start
      const avgMs = elapsed / 1000
      expect(avgMs).toBeLessThan(5)
    })

    it('复杂组合查询 < 5ms', () => {
      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        routeQuery('活跃的优秀 python 项目')
      }
      const elapsed = performance.now() - start
      const avgMs = elapsed / 1000
      expect(avgMs).toBeLessThan(5)
    })
  })
})
