/**
 * searchState 单元测试
 *
 * 覆盖：
 *   - INITIAL_SEARCH_STATE 初始值
 *   - SEARCH_TRANSITIONS 状态迁移表
 *   - canTransition 合法性判断
 *   - SEARCH_STATUSES 完整性
 */
import { describe, it, expect } from 'vitest'
import {
  INITIAL_SEARCH_STATE,
  SEARCH_TRANSITIONS,
  SEARCH_STATUSES,
  canTransition,
} from '../../src/lib/search/searchState.js'

describe('INITIAL_SEARCH_STATE', () => {
  it('初始状态为 idle', () => {
    expect(INITIAL_SEARCH_STATE.status).toBe('idle')
  })

  it('初始 hint 为空字符串', () => {
    expect(INITIAL_SEARCH_STATE.hint).toBe('')
  })

  it('初始 error 为 null', () => {
    expect(INITIAL_SEARCH_STATE.error).toBeNull()
  })

  it('初始 ragLoading 为 false', () => {
    expect(INITIAL_SEARCH_STATE.ragLoading).toBe(false)
  })
})

describe('SEARCH_STATUSES', () => {
  it('包含所有 7 个状态', () => {
    expect(SEARCH_STATUSES).toEqual([
      'idle', 'searching', 'label_search', 'loading_more', 'repo_filter', 'expanding', 'error',
    ])
  })
})

describe('SEARCH_TRANSITIONS', () => {
  it('submitSearch 从 idle 迁移到 searching', () => {
    expect(SEARCH_TRANSITIONS.submitSearch.to).toBe('searching')
    expect(SEARCH_TRANSITIONS.submitSearch.from).toContain('idle')
  })

  it('submitSearch 从 error 也能迁移（错误后重试）', () => {
    expect(SEARCH_TRANSITIONS.submitSearch.from).toContain('error')
  })

  it('searchSuccess 从 searching 迁移到 idle', () => {
    expect(SEARCH_TRANSITIONS.searchSuccess.from).toEqual(['searching'])
    expect(SEARCH_TRANSITIONS.searchSuccess.to).toBe('idle')
  })

  it('searchError 从 searching 迁移到 error', () => {
    expect(SEARCH_TRANSITIONS.searchError.from).toEqual(['searching'])
    expect(SEARCH_TRANSITIONS.searchError.to).toBe('error')
  })

  it('loadMore 从 idle 迁移到 loading_more', () => {
    expect(SEARCH_TRANSITIONS.loadMore.from).toEqual(['idle'])
    expect(SEARCH_TRANSITIONS.loadMore.to).toBe('loading_more')
  })

  it('applyLabelFilter 从 idle 迁移到 label_search', () => {
    expect(SEARCH_TRANSITIONS.applyLabelFilter.to).toBe('label_search')
  })

  it('applyRepoFilter 从 idle 迁移到 repo_filter', () => {
    expect(SEARCH_TRANSITIONS.applyRepoFilter.to).toBe('repo_filter')
  })

  it('startRag 设置 ragLoading=true 但不改 status', () => {
    expect(SEARCH_TRANSITIONS.startRag.ragLoading).toBe(true)
  })

  it('ragDone 设置 ragLoading=false', () => {
    expect(SEARCH_TRANSITIONS.ragDone.ragLoading).toBe(false)
  })

  it('ragError 设置 ragLoading=false', () => {
    expect(SEARCH_TRANSITIONS.ragError.ragLoading).toBe(false)
  })

  it('resetSearch 从任意状态迁移到 idle', () => {
    const reset = SEARCH_TRANSITIONS.resetSearch
    expect(reset.to).toBe('idle')
    // 应该能从所有非 idle 状态恢复
    expect(reset.from).toContain('error')
    expect(reset.from).toContain('searching')
    expect(reset.from).toContain('loading_more')
    expect(reset.from).toContain('label_search')
    expect(reset.from).toContain('repo_filter')
  })
})

describe('canTransition', () => {
  it('idle → submitSearch 合法', () => {
    expect(canTransition('idle', 'submitSearch')).toBe(true)
  })

  it('error → submitSearch 合法（错误后重试）', () => {
    expect(canTransition('error', 'submitSearch')).toBe(true)
  })

  it('searching → searchSuccess 合法', () => {
    expect(canTransition('searching', 'searchSuccess')).toBe(true)
  })

  it('searching → searchError 合法', () => {
    expect(canTransition('searching', 'searchError')).toBe(true)
  })

  it('idle → loadMore 合法', () => {
    expect(canTransition('idle', 'loadMore')).toBe(true)
  })

  it('searching → loadMore 不合法（搜索中不能加载更多）', () => {
    expect(canTransition('searching', 'loadMore')).toBe(false)
  })

  it('idle → applyLabelFilter 合法', () => {
    expect(canTransition('idle', 'applyLabelFilter')).toBe(true)
  })

  it('loading_more → applyLabelFilter 不合法', () => {
    expect(canTransition('loading_more', 'applyLabelFilter')).toBe(false)
  })

  it('任意状态 → resetSearch 合法', () => {
    expect(canTransition('idle', 'resetSearch')).toBe(true)
    expect(canTransition('error', 'resetSearch')).toBe(true)
    expect(canTransition('searching', 'resetSearch')).toBe(true)
    expect(canTransition('loading_more', 'resetSearch')).toBe(true)
  })

  it('未知动作返回 false', () => {
    expect(canTransition('idle', 'unknownAction')).toBe(false)
  })

  it('startRag 可在多个状态下触发（RAG 独立并行）', () => {
    expect(canTransition('idle', 'startRag')).toBe(true)
    expect(canTransition('searching', 'startRag')).toBe(true)
    expect(canTransition('loading_more', 'startRag')).toBe(true)
  })
})
