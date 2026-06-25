import { getSetting, setSetting } from './db.js'

const CONFIG_KEY = 'search_config'

/** 默认配置 */
export const DEFAULT_CONFIG = {
  sources: {
    repo: { enabled: true, perPage: 10 },
    issue: { enabled: true, perPage: 10 },
    code: { enabled: false, perPage: 10 },
    qa: { enabled: true },
  },
  filters: {
    language: '',
    contentLang: 'en',
    minLiveness: 'maintained',
    minStars: 0,
    labels: '',
    dateRange: 'all',
  },
  intentMap: {
    repo: ['repo'],
    issue: ['issue'],
    code: ['code'],
    qa: ['qa'],
    mixed: ['issue', 'repo'],
  },
  llm: { rewriteQuery: false },
  pagination: {
    issuePageSize: 20,
  },
}

/** 语言选项 */
export const LANGUAGE_OPTIONS = [
  '', 'JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java',
  'C++', 'C', 'Ruby', 'PHP', 'Swift', 'Kotlin',
]

/** 内容语言选项 */
export const CONTENT_LANG_OPTIONS = [
  { value: 'en', label: '英文优先' },
  { value: 'zh', label: '中文优先' },
  { value: 'any', label: '不限' },
]

/** 活跃度选项 */
export const LIVENESS_OPTIONS = [
  { value: 'active', label: '仅活跃' },
  { value: 'maintained', label: '维护中及以上' },
  { value: 'any', label: '不限' },
]

/** 时间范围选项 */
export const DATE_OPTIONS = [
  { value: 'all', label: '不限' },
  { value: 'week', label: '近一周' },
  { value: 'month', label: '近一月' },
  { value: 'year', label: '近一年' },
]

/** 标签选项 */
export const LABEL_OPTIONS = [
  { value: '', label: '不限' },
  { value: 'good first issue', label: 'good first issue' },
  { value: 'help wanted', label: 'help wanted' },
  { value: 'bug', label: 'bug' },
  { value: 'enhancement', label: 'enhancement' },
  { value: 'documentation', label: 'documentation' },
]

/** 从 IndexedDB 加载配置 */
export async function loadConfig() {
  try {
    const saved = await getSetting(CONFIG_KEY, null)
    if (saved) {
      return {
        ...DEFAULT_CONFIG,
        ...saved,
        sources: { ...DEFAULT_CONFIG.sources, ...saved.sources },
        filters: { ...DEFAULT_CONFIG.filters, ...saved.filters },
        intentMap: { ...DEFAULT_CONFIG.intentMap, ...saved.intentMap },
        llm: { ...DEFAULT_CONFIG.llm, ...saved.llm },
        pagination: { ...DEFAULT_CONFIG.pagination, ...saved.pagination },
      }
    }
  } catch (err) {
    console.warn('[searchConfig] 加载配置失败:', err.message)
  }
  return { ...DEFAULT_CONFIG }
}

/** 保存配置到 IndexedDB */
export async function saveConfig(config) {
  await setSetting(CONFIG_KEY, config)
}

/**
 * 解析内联搜索语法（不影响主查询词）
 * 语法：!language:xxx !contentLang:en !minLiveness:active !stars:100 !labels:xxx !since:week
 * 返回 { query, filters }
 */
export function parseInlineSyntax(query) {
  const filters = {}
  let cleaned = query
  const patterns = [
    [/!language:(\S+)/gi, 'language'],
    [/!contentLang:(\S+)/gi, 'contentLang'],
    [/!minLiveness:(\S+)/gi, 'minLiveness'],
    [/!stars:(\d+)/gi, 'minStars'],
    [/!labels:(\S+)/gi, 'labels'],
    [/!since:(week|month|year)/gi, 'dateRange'],
  ]
  for (const [regex, key] of patterns) {
    const match = regex.exec(cleaned)
    if (match) {
      filters[key] = key === 'minStars' ? Number(match[1]) : match[1]
      cleaned = cleaned.replace(match[0], '').trim()
    }
  }
  return { query: cleaned, filters }
}