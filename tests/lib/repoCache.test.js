/**
 * repoCache 单元测试
 *
 * 覆盖：
 *   - getRepoCacheEntry / setRepoCacheEntry 基本存取
 *   - TTL 过期判断
 *   - hydrateRepoCache 从 Dexie 恢复 + 过滤过期
 *   - persistRepoCache 写入 Dexie
 *   - 旧缓存 entry 兼容（缺字段不崩）
 *   - 空缓存 hydrate 不崩
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// mock db.js
const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()
vi.mock('../../src/lib/db.js', () => ({
  getSetting: (...args) => mockGetSetting(...args),
  setSetting: (...args) => mockSetSetting(...args),
}))

// 每个测试重置模块，清空 repoInfoCache Map
let repoCache
beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  mockGetSetting.mockReset()
  mockSetSetting.mockReset()
  // 重新 mock（resetModules 后需要重新定义）
  vi.doMock('../../src/lib/db.js', () => ({
    getSetting: (...args) => mockGetSetting(...args),
    setSetting: (...args) => mockSetSetting(...args),
  }))
  repoCache = await import('../../src/lib/repoCache.js')
})

describe('getRepoCacheEntry / setRepoCacheEntry', () => {
  it('写入后能读取', () => {
    const entry = { fullName: 'a/b', stars: 100, _ts: Date.now() }
    repoCache.setRepoCacheEntry('a/b', entry)
    const r = repoCache.getRepoCacheEntry('a/b')
    expect(r).toEqual(entry)
  })

  it('未写入 → null', () => {
    expect(repoCache.getRepoCacheEntry('not/exist')).toBeNull()
  })

  it('hasFreshCache 新鲜 → true', () => {
    repoCache.setRepoCacheEntry('a/b', { stars: 1, _ts: Date.now() })
    expect(repoCache.hasFreshCache('a/b')).toBe(true)
  })

  it('hasFreshCache 未命中 → false', () => {
    expect(repoCache.hasFreshCache('not/exist')).toBe(false)
  })
})

describe('TTL 过期判断', () => {
  it('过期 entry → getRepoCacheEntry 返回 null', () => {
    const oldTs = Date.now() - 31 * 60 * 1000 // 31 分钟前
    repoCache.setRepoCacheEntry('a/b', { stars: 1, _ts: oldTs })
    // setRepoCacheEntry 会调 persistRepoCache，但 Map 里 entry 的 _ts 是我们传的
    // 需要直接操作：用 getRawRepoCacheEntry 验证存在，但 getRepoCacheEntry 因 TTL 返回 null
    expect(repoCache.getRepoCacheEntry('a/b')).toBeNull()
    expect(repoCache.getRawRepoCacheEntry('a/b')).toBeDefined() // Map 里还在
  })

  it('hasFreshCache 过期 → false', () => {
    const oldTs = Date.now() - 31 * 60 * 1000
    repoCache.setRepoCacheEntry('a/b', { stars: 1, _ts: oldTs })
    expect(repoCache.hasFreshCache('a/b')).toBe(false)
  })
})

describe('hydrateRepoCache', () => {
  it('从 Dexie 恢复新鲜 entry', async () => {
    const freshEntry = { fullName: 'a/b', stars: 100, _ts: Date.now() }
    mockGetSetting.mockResolvedValue(JSON.stringify({ 'a/b': freshEntry }))
    await repoCache.hydrateRepoCache()
    expect(repoCache.getRepoCacheEntry('a/b')).toEqual(freshEntry)
  })

  it('过滤过期 entry', async () => {
    const oldEntry = { fullName: 'a/b', stars: 100, _ts: Date.now() - 31 * 60 * 1000 }
    const freshEntry = { fullName: 'c/d', stars: 200, _ts: Date.now() }
    mockGetSetting.mockResolvedValue(JSON.stringify({ 'a/b': oldEntry, 'c/d': freshEntry }))
    await repoCache.hydrateRepoCache()
    expect(repoCache.getRepoCacheEntry('a/b')).toBeNull()
    expect(repoCache.getRepoCacheEntry('c/d')).toEqual(freshEntry)
  })

  it('空缓存（null）不崩', async () => {
    mockGetSetting.mockResolvedValue(null)
    await repoCache.hydrateRepoCache()
    expect(repoCache.getRepoCacheEntry('a/b')).toBeNull()
  })

  it('空字符串缓存不崩', async () => {
    mockGetSetting.mockResolvedValue('')
    await repoCache.hydrateRepoCache()
    expect(repoCache.getRepoCacheEntry('a/b')).toBeNull()
  })

  it('损坏的 JSON 不崩（静默）', async () => {
    mockGetSetting.mockResolvedValue('not-json{')
    await repoCache.hydrateRepoCache()
    expect(repoCache.getRepoCacheEntry('a/b')).toBeNull()
  })

  it('旧缓存 entry 缺字段不崩', async () => {
    const oldEntry = { fullName: 'a/b', _ts: Date.now() } // 缺 stars/forks 等
    mockGetSetting.mockResolvedValue(JSON.stringify({ 'a/b': oldEntry }))
    await repoCache.hydrateRepoCache()
    const r = repoCache.getRepoCacheEntry('a/b')
    expect(r).toEqual(oldEntry)
    expect(r.stars).toBeUndefined()
  })
})

describe('persistRepoCache', () => {
  it('写入后调用 setSetting 持久化（debounce 后触发）', async () => {
    repoCache.setRepoCacheEntry('a/b', { stars: 1, _ts: Date.now() })
    // debounce 300ms 后才触发 setSetting，用 fake timer 加速
    vi.advanceTimersByTime(400)
    expect(mockSetSetting).toHaveBeenCalled()
    const [key, value] = mockSetSetting.mock.calls[0]
    expect(key).toBe('repo_info_cache')
    const parsed = JSON.parse(value)
    expect(parsed['a/b']).toBeDefined()
  })
})
