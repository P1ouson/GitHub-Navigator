/**
 * Issue 意图信号检测
 * resolveIssueSearch(rawQuery, filters) → 双参数版
 * 返回 { query, filters, context }
 */

const BEGINNER_PATTERNS = [
  /新手/, /入门/, /初学者/, /beginner/i, /newcomer/i,
  /good first/i, /first issue/i, /first contribution/i,
  /适合新手/, /新手友好/, /新手入门/,
  /初学/, /上手/, /hello world/i,
  /easy pick/i, /low.hanging/i,
  /简单/, /容易/, /练手/, /适合初学者/,
  /help wanted/i, /help-wanted/i,
]

function isBeginnerIssueQuery(rawQuery) {
  return rawQuery && BEGINNER_PATTERNS.some(p => p.test(rawQuery))
}

/** 去掉新手信号词，保留纯搜索关键词 */
function stripBeginnerWords(rawQuery) {
  return rawQuery
    .replace(/适合新手的?|新手友好的?|适合新人的?/g, '')
    .replace(/good first issue|gfi\b|beginner/g, '')
    .replace(/新手|入门|新人|第一次贡献/g, '')
    .replace(/\bissues?\b/gi, '') // 去掉用户输入的 issue，避免与 is:issue 重复收窄结果
    .replace(/good\s*first\s*issue|first\s*issue|first\s*contribution|easy\s*pick|low[\s-]*hanging|help[\s-]*wanted|beginner|newcomer|hello\s*world/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解析新手信号，返回修改后的搜索参数 + context
 * @param {string} rawQuery 原始搜索词
 * @param {object} filters 当前 filters 配置
 * @returns {{ query: string, filters: object, context: { mode: string|null, note: string, label?: string } }}
 */
export function resolveIssueSearch(rawQuery, filters = {}) {
  if (!isBeginnerIssueQuery(rawQuery)) {
    return { query: rawQuery, filters, context: null }
  }

  if (filters.labels) {
    return {
      query: stripBeginnerWords(rawQuery),
      filters,
      context: {
        mode: 'beginner',
        note: '已添加新手信号过滤，只展示适合新手的 Issue',
      },
    }
  }

  return {
    query: stripBeginnerWords(rawQuery),
    filters: { ...filters, labels: 'good first issue' },
    context: {
      mode: 'beginner',
      label: 'good first issue',
      note: '已添加 good first issue 标签过滤，只展示适合新手的 Issue',
    },
  }
}