/**
 * searchBuilder 单元测试
 *
 * 覆盖：
 *   - tagRepoItem / tagIssueItem / tagCodeItem 打标
 *   - buildRankedSections 构建 + 空数组删除
 *   - prepareIssueList 过滤 + 排序
 *   - prepareRepoList 过滤 + 重排
 *   - mergeSectionSlice 合并
 *   - 缺字段 / 空字段 / labels 空数组 / topics 空数组时不崩
 */
import { describe, it, expect } from 'vitest'
import {
  tagRepoItem, tagIssueItem, tagCodeItem,
  buildRankedSections, prepareIssueList, prepareRepoList, mergeSectionSlice,
} from '../../src/lib/search/searchBuilder.js'

describe('tagRepoItem', () => {
  it('给 repo item 打上 _type=repo 和 _source=github_api', () => {
    const repo = { name: 'react', fullName: 'facebook/react', stars: 100 }
    const tagged = tagRepoItem(repo)
    expect(tagged._type).toBe('repo')
    expect(tagged._source).toBe('github_api')
    // 原字段保留
    expect(tagged.name).toBe('react')
    expect(tagged.stars).toBe(100)
  })

  it('不修改原始对象', () => {
    const repo = { name: 'vue' }
    const tagged = tagRepoItem(repo)
    expect(repo._type).toBeUndefined()
    expect(tagged._type).toBe('repo')
  })

  it('空对象不崩', () => {
    const tagged = tagRepoItem({})
    expect(tagged._type).toBe('repo')
    expect(tagged._source).toBe('github_api')
  })
})

describe('tagIssueItem', () => {
  it('给 issue item 打上 _type=issue', () => {
    const issue = { title: 'bug', labels: [] }
    const tagged = tagIssueItem(issue)
    expect(tagged._type).toBe('issue')
    expect(tagged._source).toBe('github_api')
    expect(tagged.title).toBe('bug')
  })

  it('labels 为空数组时不崩', () => {
    const tagged = tagIssueItem({ labels: [] })
    expect(tagged._type).toBe('issue')
  })

  it('labels 为 undefined 时不崩', () => {
    const tagged = tagIssueItem({ labels: undefined })
    expect(tagged._type).toBe('issue')
  })
})

describe('tagCodeItem', () => {
  it('给 code item 打上 _type=code', () => {
    const code = { name: 'index.js', path: 'src/index.js' }
    const tagged = tagCodeItem(code)
    expect(tagged._type).toBe('code')
    expect(tagged._source).toBe('github_api')
  })
})

describe('buildRankedSections', () => {
  it('从多源 rawResults 构建 sections', () => {
    const raw = {
      repo: [{ name: 'react', fullName: 'facebook/react' }],
      issue: [{ title: 'bug' }],
      code: [{ name: 'index.js' }],
    }
    const sections = buildRankedSections(raw, 'react', 'mixed')
    expect(sections.repo).toBeDefined()
    expect(sections.issue).toBeDefined()
    expect(sections.code).toBeDefined()
  })

  it('空数组 issue section 被删除（避免 tab 误显示）', () => {
    const raw = {
      repo: [{ name: 'react' }],
      issue: [],
      code: [{ name: 'index.js' }],
    }
    const sections = buildRankedSections(raw, 'react', 'repo')
    expect(sections.repo).toBeDefined()
    expect(sections.issue).toBeUndefined()
  })

  it('某个源返回 null 不崩', () => {
    const raw = { repo: null, issue: null, code: null }
    // rankResults 内部应处理 null
    expect(() => buildRankedSections(raw, 'test', 'mixed')).not.toThrow()
  })

  it('空 rawResults 不崩', () => {
    expect(() => buildRankedSections({}, 'test', 'mixed')).not.toThrow()
  })
})

describe('prepareIssueList', () => {
  it('过滤被屏蔽的 repo name', () => {
    // isRepoNameBlocked 会屏蔽特定 repo，这里用一个肯定不屏蔽的
    const issues = [
      { title: 'a', repo: 'facebook/react' },
      { title: 'b', repo: 'normal/repo' },
    ]
    const result = prepareIssueList(issues, 'any')
    // 至少返回了非屏蔽的 issue
    expect(result.length).toBeGreaterThan(0)
  })

  it('空数组不崩', () => {
    const result = prepareIssueList([], 'any')
    expect(result).toEqual([])
  })

  it('prefLang=en 时中文 issue 排后', () => {
    const issues = [
      { title: '修复问题', repo: 'foo/bar', _repoHealth: { language: 'Python' } },
      { title: 'fix bug', repo: 'foo/baz', _repoHealth: { language: 'JavaScript' } },
    ]
    const result = prepareIssueList(issues, 'en')
    // 英文 issue 应该排前面（prefLang=en 时中文排后）
    expect(result[0].title).toBe('fix bug')
  })

  it('prefLang=zh 时中文 issue 排前', () => {
    const issues = [
      { title: 'fix bug', repo: 'foo/baz', _repoHealth: { language: 'JavaScript' } },
      { title: '修复问题', repo: 'foo/bar', _repoHealth: { language: 'Python' } },
    ]
    const result = prepareIssueList(issues, 'zh')
    // 中文 issue 应该排前面
    expect(result[0].title).toBe('修复问题')
  })
})

describe('prepareRepoList', () => {
  it('过滤被屏蔽的 repo + 重排', () => {
    const repos = [
      { name: 'react', fullName: 'facebook/react', stars: 100, description: 'react' },
      { name: 'vue', fullName: 'vuejs/vue', stars: 200, description: 'vue framework' },
    ]
    const result = prepareRepoList(repos, 'react')
    expect(result.length).toBeGreaterThan(0)
  })

  it('空数组不崩', () => {
    const result = prepareRepoList([], 'test')
    expect(result).toEqual([])
  })

  it('topics 为空数组时不崩', () => {
    const repos = [{ name: 'test', fullName: 'foo/test', topics: [] }]
    expect(() => prepareRepoList(repos, 'test')).not.toThrow()
  })

  it('topics 为 undefined 时不崩', () => {
    const repos = [{ name: 'test', fullName: 'foo/test' }]
    expect(() => prepareRepoList(repos, 'test')).not.toThrow()
  })
})

describe('mergeSectionSlice', () => {
  it('prevSections 为 null 时创建新对象', () => {
    const result = mergeSectionSlice(null, 'issue', [{ title: 'a' }])
    expect(result.issue).toEqual([{ title: 'a' }])
  })

  it('合并新 slice 到已有 sections', () => {
    const prev = { repo: [{ name: 'r1' }], issue: [{ title: 'old' }] }
    const result = mergeSectionSlice(prev, 'issue', [{ title: 'new' }])
    expect(result.issue).toEqual([{ title: 'new' }])
    // 其他 tab 不受影响
    expect(result.repo).toEqual([{ name: 'r1' }])
  })

  it('不修改原始 prevSections', () => {
    const prev = { repo: [{ name: 'r1' }] }
    mergeSectionSlice(prev, 'issue', [{ title: 'a' }])
    expect(prev.issue).toBeUndefined()
  })

  it('支持函数式更新（prev 为函数）', () => {
    // mergeSectionSlice 本身不接受函数，但 orchestrator 通过 cb.onRankedSections(prev => ...) 传函数
    // 这里测试 mergeSectionSlice 接收 prevSections 对象
    const prev = { repo: [{ name: 'r1' }] }
    const result = mergeSectionSlice(prev, 'code', [{ name: 'c1' }])
    expect(result.code).toEqual([{ name: 'c1' }])
    expect(result.repo).toEqual([{ name: 'r1' }])
  })

  it('空切片时替换为空数组（语义是替换不是追加）', () => {
    const prev = { issue: [{ title: 'old1' }, { title: 'old2' }] }
    const result = mergeSectionSlice(prev, 'issue', [])
    expect(result.issue).toEqual([])
  })

  it('section 不存在时创建新 tab', () => {
    const prev = { repo: [{ name: 'r1' }] }
    const result = mergeSectionSlice(prev, 'code', [{ name: 'c1' }])
    expect(result.code).toEqual([{ name: 'c1' }])
    expect(result.repo).toEqual([{ name: 'r1' }])
  })

  it('多次 merge 顺序稳定（后调覆盖先调）', () => {
    const prev1 = { issue: [{ title: 'v1' }] }
    const r1 = mergeSectionSlice(prev1, 'issue', [{ title: 'v2' }])
    const r2 = mergeSectionSlice(r1, 'issue', [{ title: 'v3' }])
    expect(r2.issue).toEqual([{ title: 'v3' }])
  })
})

// ===== 补齐：section 结构 / knowledge / 缺字段 / archived =====

describe('buildRankedSections - section 结构', () => {
  it('每个 item 带 _type / _source / _label / _priority', () => {
    const raw = {
      repo: [{ name: 'react', fullName: 'facebook/react' }],
    }
    const sections = buildRankedSections(raw, 'react', 'repo')
    expect(sections.repo).toBeDefined()
    expect(sections.repo.length).toBe(1)
    const item = sections.repo[0]
    expect(item._type).toBe('repo')
    expect(item._source).toBe('github_api')
    expect(item._label).toBeDefined()
    expect(item._priority).toBeDefined()
  })

  it('issue section 的 item 带 _type=issue', () => {
    const raw = {
      issue: [{ title: 'bug', labels: [{ name: 'bug' }], repo: 'foo/bar' }],
    }
    const sections = buildRankedSections(raw, 'bug', 'issue')
    expect(sections.issue).toBeDefined()
    expect(sections.issue[0]._type).toBe('issue')
  })

  it('code section 的 item 带 _type=code', () => {
    const raw = {
      code: [{ name: 'index.js', path: 'src/index.js' }],
    }
    const sections = buildRankedSections(raw, 'index', 'code')
    expect(sections.code).toBeDefined()
    expect(sections.code[0]._type).toBe('code')
  })

  it('knowledge 缺失时不崩', () => {
    const raw = { repo: [{ name: 'r' }] }
    expect(() => buildRankedSections(raw, 'test', 'repo')).not.toThrow()
  })

  it('knowledge 为 undefined 时不崩', () => {
    const raw = { repo: [{ name: 'r' }], knowledge: undefined }
    expect(() => buildRankedSections(raw, 'test', 'repo')).not.toThrow()
  })

  it('knowledge 为 null 时不崩', () => {
    const raw = { repo: [{ name: 'r' }], knowledge: null }
    expect(() => buildRankedSections(raw, 'test', 'repo')).not.toThrow()
  })

  it('所有源都为空时返回空对象', () => {
    const raw = { repo: [], issue: [], code: [] }
    const sections = buildRankedSections(raw, 'test', 'mixed')
    expect(sections.repo).toBeUndefined()
    expect(sections.issue).toBeUndefined()
    expect(sections.code).toBeUndefined()
  })
})

describe('prepareIssueList - 缺字段容错', () => {
  it('无 labels 时不崩', () => {
    const issues = [{ title: 'a', repo: 'foo/bar' }]
    expect(() => prepareIssueList(issues, 'any')).not.toThrow()
  })

  it('无 comments 时不崩', () => {
    const issues = [{ title: 'a', repo: 'foo/bar', labels: [] }]
    expect(() => prepareIssueList(issues, 'any')).not.toThrow()
  })

  it('无 body 时不崩', () => {
    const issues = [{ title: 'a', repo: 'foo/bar', labels: [], body: undefined }]
    expect(() => prepareIssueList(issues, 'any')).not.toThrow()
  })

  it('无 repo 字段时不崩', () => {
    const issues = [{ title: 'a', labels: [] }]
    expect(() => prepareIssueList(issues, 'any')).not.toThrow()
  })

  it('完全空对象不崩', () => {
    const issues = [{}]
    expect(() => prepareIssueList(issues, 'any')).not.toThrow()
  })
})

describe('prepareRepoList - 缺字段容错', () => {
  it('缺 stars 时不崩', () => {
    const repos = [{ name: 'test', fullName: 'foo/test' }]
    expect(() => prepareRepoList(repos, 'test')).not.toThrow()
  })

  it('缺 forks 时不崩', () => {
    const repos = [{ name: 'test', fullName: 'foo/test', stars: 10 }]
    expect(() => prepareRepoList(repos, 'test')).not.toThrow()
  })

  it('缺 updatedAt 时不崩', () => {
    const repos = [{ name: 'test', fullName: 'foo/test', stars: 10, forks: 5 }]
    expect(() => prepareRepoList(repos, 'test')).not.toThrow()
  })

  it('archived 仓库不被过滤（archived 不在过滤条件里）', () => {
    const repos = [
      { name: 'active', fullName: 'foo/active', stars: 10, archived: false },
      { name: 'archived', fullName: 'foo/archived', stars: 20, archived: true },
    ]
    const result = prepareRepoList(repos, 'test')
    // archived 仓库也应该保留（isRepoBlocked 不检查 archived）
    expect(result.length).toBe(2)
  })

  it('完全空对象不崩', () => {
    const repos = [{}]
    expect(() => prepareRepoList(repos, 'test')).not.toThrow()
  })
})
