/**
 * contentFilter 单元测试
 *
 * 覆盖 isRepoBlocked 改读主字段后的过滤正确性：
 *   - 黑名单仓库命中（fullName）
 *   - owner 黑名单命中（从 fullName 解析）
 *   - 关键词命中（desc 字段）
 *   - GraphQL entry（无 owner 对象）owner 黑名单仍能命中
 *   - 原始 API data 兼容（只有 full_name 无 fullName）
 *   - null/undefined 不崩
 *   - isRepoNameBlocked
 */
import { describe, it, expect } from 'vitest'
import { isRepoBlocked, isRepoNameBlocked } from '../../src/lib/contentFilter.js'

describe('isRepoBlocked — 主字段读取', () => {
  it('黑名单仓库命中（fullName）', () => {
    expect(isRepoBlocked({ fullName: 'cirosantilli/china-dictatorship' })).toBe(true)
  })

  it('黑名单仓库未命中', () => {
    expect(isRepoBlocked({ fullName: 'facebook/react' })).toBe(false)
  })

  it('owner 黑名单命中（从 fullName 解析）', () => {
    expect(isRepoBlocked({ fullName: 'cirosantilli/other-repo' })).toBe(true)
  })

  it('owner 黑名单未命中', () => {
    expect(isRepoBlocked({ fullName: 'facebook/react' })).toBe(false)
  })

  it('关键词命中 — desc 字段', () => {
    expect(isRepoBlocked({ fullName: 'someone/repo', desc: 'A tool for tibet independence' })).toBe(true)
  })

  it('关键词命中 — name 字段', () => {
    expect(isRepoBlocked({ name: 'anti-china-tool' })).toBe(true)
  })

  it('关键词未命中', () => {
    expect(isRepoBlocked({ fullName: 'someone/repo', desc: 'A great tool' })).toBe(false)
  })

  it('GraphQL entry（无 owner 对象）— owner 黑名单仍能命中', () => {
    // GraphQL 路径 entry 没有 owner 对象，但 fullName.split('/')[0] 仍能提取 owner
    expect(isRepoBlocked({ fullName: 'cirosantilli/some-repo', owner: undefined })).toBe(true)
  })

  it('GraphQL entry — owner 不在黑名单', () => {
    expect(isRepoBlocked({ fullName: 'facebook/react', owner: undefined })).toBe(false)
  })

  it('原始 API data 兼容（只有 full_name 无 fullName）', () => {
    expect(isRepoBlocked({ full_name: 'cirosantilli/china-dictatorship' })).toBe(true)
  })

  it('原始 API data — owner 黑名单通过 full_name 命中', () => {
    expect(isRepoBlocked({ full_name: 'cirosantilli/other-repo', owner: { login: 'cirosantilli' } })).toBe(true)
  })

  it('原始 API data — description 兼容', () => {
    expect(isRepoBlocked({ full_name: 'someone/repo', description: 'tiananmen docs' })).toBe(true)
  })

  it('null 不崩', () => {
    expect(isRepoBlocked(null)).toBe(false)
  })

  it('undefined 不崩', () => {
    expect(isRepoBlocked(undefined)).toBe(false)
  })

  it('空对象不崩', () => {
    expect(isRepoBlocked({})).toBe(false)
  })

  it('只有 name 无 fullName/full_name — 关键词仍能命中', () => {
    expect(isRepoBlocked({ name: 'dictatorship-detector' })).toBe(true)
  })
})

describe('isRepoNameBlocked', () => {
  it('黑名单仓库命中', () => {
    expect(isRepoNameBlocked('cirosantilli/china-dictatorship')).toBe(true)
  })

  it('owner 黑名单命中', () => {
    expect(isRepoNameBlocked('cirosantilli/other-repo')).toBe(true)
  })

  it('未命中', () => {
    expect(isRepoNameBlocked('facebook/react')).toBe(false)
  })

  it('空字符串', () => {
    expect(isRepoNameBlocked('')).toBe(false)
  })

  it('null', () => {
    expect(isRepoNameBlocked(null)).toBe(false)
  })
})
