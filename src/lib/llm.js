/**
 * LLM 适配器 — 接入 SiliconFlow
 *
 * 模型：
 *   默认:  GLM-4-9B-0414（稠密 9B，~1s，主力，RAG/翻译/画像/漫游）
 *   L3:    Qwen3-30B-A3B（MoE 3B active，~0.8s，意图分类）
 *   L4:    GLM-4-9B-0414（稠密 9B，同义词扩展兜底）
 *   Embedding: BAAI/bge-m3（永久免费）
 *
 * LLM 不可用时自动降级为纯规则模式。
 */

import { getSetting, setSetting } from './db.js'

const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1'
// 默认模型：GLM-4-9B（稠密 9B，~1s，RAG/翻译/画像/漫游主力）
const DEFAULT_LLM_MODEL = 'THUDM/GLM-4-9B-0414'
// L3 轻量模型（意图分类专用，A3B 极短 prompt 场景最快）
const LIGHT_LLM_MODEL = 'Qwen/Qwen3-30B-A3B-Instruct-2507'
// L4 全量模型（同义词扩展兜底，L3 失败时触发）
const FULL_LLM_MODEL = 'THUDM/GLM-4-9B-0414'
const DEFAULT_API_KEY = 'sk-huzesdqsfacrwehmnoaaezatkcqzrcvdckwwqujjgqethywx'

let llmProvider = null

export function setLLMProvider(provider) {
  llmProvider = provider
}

export function isLLMAvailable() {
  return llmProvider !== null
}

/**
 * 从存储恢复 LLM 配置，启动时调用
 */
export async function initLLMFromStorage() {
  const apiKey = await getSetting('siliconflow_api_key') || DEFAULT_API_KEY
  const model = await getSetting('siliconflow_model') || DEFAULT_LLM_MODEL
  if (apiKey) {
    setLLMProvider(createSiliconFlowAdapter({ apiKey, model }))
  }
}

/**
 * 更新 LLM 配置（设置页调用）
 */
export async function updateLLMConfig({ apiKey, model }) {
  const key = apiKey || await getSetting('siliconflow_api_key') || DEFAULT_API_KEY
  const mdl = model || await getSetting('siliconflow_model') || DEFAULT_LLM_MODEL
  await setSetting('siliconflow_api_key', key)
  await setSetting('siliconflow_model', mdl)
  setLLMProvider(createSiliconFlowAdapter({ apiKey: key, model: mdl }))
}

/**
 * 调用 LLM 增强（每个功能点的统一入口）
 * @param {string} feature - 功能点标识，如 'search.intent', 'pr.polish'
 * @param {object} input - 输入数据
 * @returns {Promise<any|null>} LLM 增强结果，不可用时返回 null（调用方降级）
 */
export async function enhance(feature, input) {
  if (!isLLMAvailable()) return null
  try {
    return await llmProvider.complete(feature, input)
  } catch (err) {
    console.warn(`[LLM] ${feature} 降级到纯规则:`, err.message)
    return null
  }
}

/**
 * 直接对话接口（RAG 问答用）
 * @param {string} systemPrompt 系统提示词
 * @param {string} userMessage 用户消息
 * @returns {Promise<string>}
 */
export async function chat(systemPrompt, userMessage) {
  if (!isLLMAvailable()) return null
  try {
    return await llmProvider.chat(systemPrompt, userMessage)
  } catch (err) {
    console.warn('[LLM] chat 失败:', err.message)
    return null
  }
}

/**
 * 内部统一的 chat 请求（收口 4 份重复的 fetch 样板）
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {number} [opts.maxTokens=1024]
 * @param {number} [opts.timeout=15000] 超时 ms
 * @param {boolean} [opts.stream=false] 是否流式
 * @param {(chunk: string) => void} [opts.onChunk] 流式回调
 * @returns {Promise<string>} 完整内容（流式时为拼接结果，非流式时为 message.content）
 */
async function _chat({ apiKey, model, systemPrompt, userMessage, maxTokens = 1024, timeout = 15000, stream = false, onChunk }) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    const resp = await fetch(`${SILICONFLOW_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
        ...(stream ? { stream: true } : {}),
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`LLM API 错误 (${resp.status}): ${err.slice(0, 200)}`)
    }

    if (!stream) {
      const data = await resp.json()
      return data.choices[0].message.content
    }

    // 流式：逐 chunk 回调
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const jsonStr = trimmed.slice(6).trim()
        if (jsonStr === '[DONE]') break
        try {
          const parsed = JSON.parse(jsonStr)
          const content = parsed.choices?.[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            onChunk?.(content)
          }
        } catch {
          // 跳过格式异常的行
        }
      }
    }
    return fullContent
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') throw new Error(`LLM 请求超时（${timeout / 1000}s）`)
    throw e
  }
}

/** 创建 SiliconFlow 适配器（OpenAI 兼容格式） */
export function createSiliconFlowAdapter({ apiKey, model }) {
  return {
    async complete(feature, input) {
      let systemPrompt = `你是一个助手，当前功能: ${feature}。请用中文回答。`
      let userContent = typeof input === 'string' ? input : JSON.stringify(input)

      // analysis.summary 特化：从报告数据中提取关键指标，构建精简 prompt
      if (feature === 'analysis.summary' && input && input.report) {
        const r = input.report
        const info = r.info || {}
        const liveness = r.liveness || {}
        const scores = r.scores || {}
        const recs = (r.recommendations || []).slice(0, 5)
        const ctx = {
          仓库: info.name || '未知',
          描述: (info.desc || '').slice(0, 200),
          语言: info.language || '未知',
          星数: info.stars || 0,
          Forks: info.forks || 0,
          Open_Issues: info.openIssues || 0,
          Topics: (info.topics || []).slice(0, 10),
          License: info.license || '无',
          活跃度: `${liveness.level || 'unknown'}（距上次推送${liveness.days != null ? liveness.days + '天' : '未知'}）`,
          总评分: scores.total || 0,
          评分明细: {
            活动性: scores.activity || 0,
            贡献者多样性: scores.contributors || 0,
            初学者友好度: scores.beginner || 0,
            维护质量: scores.maintenance || 0,
            文档质量: scores.docs || 0,
            生态影响力: scores.ecosystem || 0,
          },
          关键建议: recs.map(r => r.title || r.text || '').join('；'),
        }
        systemPrompt = '你是 GitHub 仓库分析专家。请根据以下仓库数据，生成一份简洁的中文健康度画像。用 Markdown 表格展示评分明细，表格后附 2-3 句总结。'
        userContent = JSON.stringify(ctx, null, 2)
      }

      return _chat({ apiKey, model, systemPrompt, userMessage: userContent, maxTokens: 1024, timeout: 15000 })
    },

    async chat(systemPrompt, userMessage) {
      return _chat({ apiKey, model, systemPrompt, userMessage, maxTokens: 256, timeout: 15000 })
    },
  }
}

/**
 * 流式聊天 — 逐 chunk 回调
 * @param {string} systemPrompt 系统提示词
 * @param {string} userMessage 用户消息
 * @param {(chunk: string) => void} onChunk 每收到一段内容就回调
 * @param {number} maxTokens 最大 tokens
 * @returns {Promise<string>} 完整内容
 */
export async function chatStream(systemPrompt, userMessage, onChunk, maxTokens = 1024) {
  if (!isLLMAvailable()) return null
  const apiKey = await getSetting('siliconflow_api_key') || DEFAULT_API_KEY
  return _chat({ apiKey, model: DEFAULT_LLM_MODEL, systemPrompt, userMessage, maxTokens, timeout: 30000, stream: true, onChunk })
}

/**
 * 意图分析的系统提示词（L3 轻量路由 / L4 兜底扩词）
 * L3 用 buildIntentSystemPrompt，L4 用 buildExpandSystemPrompt
 * 日期动态生成，避免硬编码过期
 */
function buildIntentSystemPrompt() {
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const halfYearAgo = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
  const yearStart = `${new Date().getFullYear()}-01-01`

  return `你是一个搜索意图分析器。分析用户输入，判断用户想搜索什么，并提取结构化过滤条件。

返回 JSON 格式（只返回 JSON，不要其他内容）：
{
  "intent": "repo|issue|code|qa|mixed",
  "subIntent": "beginner|active|error|tutorial|concept|discovery|null",
  "queryRewrite": "改写后的核心搜索词（可扩词，见下方规则）",
  "sources": ["repo","issue","code","knowledge","web"],
  "filters": {
    "minStars": null,
    "maxStars": null,
    "language": null,
    "createdAfter": null,
    "updatedAfter": null,
    "sort": null
  },
  "confidence": 0.0,
  "ambiguous": false,
  "showAll": false
}

intent 规则：
- repo: 用户想找仓库/项目
- issue: 用户想找 bug/报错/贡献任务
- code: 用户想找代码/API 用法
- qa: 用户想问概念性问题/教程
- mixed: 无法确定，必须配合 ambiguous=true, showAll=true

subIntent 规则（识别专门意图，无则填 null）：
- beginner: "新手/入门/简单/容易/适合新手/初学者/零基础/good first issue/beginner friendly/help wanted/first contribution"
- active: "活跃/维护中/最近更新/热门/项目多"
- error: "报错/修复/怎么解决/bug/异常/崩溃/error/exception"
- tutorial: "教程/示例/demo/怎么用/如何使用/usage"
- concept: "是什么/为什么/原理/概念/区别"
- discovery: "推荐/有哪些/求推荐/有哪些好的"

queryRewrite 规则（重要：允许扩词，不只收缩）：
- 提取核心关键词（技术栈名、项目名、错误关键词）
- 移除客套词（请、帮我、一下、看看等）
- 当 subIntent=beginner 时，扩展为 "技术词 good first issue OR help wanted OR beginner friendly"
- 当 subIntent=error 时，保留错误关键词原文，附加 "error OR bug OR issue"
- 当 subIntent=tutorial 时，附加 "tutorial OR example OR demo"
- 当 subIntent=concept 时，保留原句（适合知识库匹配）
- 当 subIntent=active/discovery 时，附加 "stars:>100"（隐含过滤器）

sources 规则（决定搜索哪些源）：
- intent=repo 且 subIntent=discovery → ["repo"]
- intent=issue 且 subIntent=beginner → ["issue"]
- intent=issue 且 subIntent=error → ["issue","code","knowledge"]
- intent=qa 且 subIntent=tutorial → ["knowledge","code","repo"]
- intent=qa 且 subIntent=concept → ["knowledge"]
- intent=mixed 或 ambiguous=true → ["repo","issue","code","knowledge","web"]（全开）

filters 规则（提取不到就填 null）：
- minStars: "一万以上/过万/star>1万" → 10000，"5k以上" → 5000
- maxStars: "小型/微型/轻量/迷你" → 1000，"中型" → 5000，"小项目" → 1000
- language: "python" → "Python"，"java" → "Java"，"javascript" → "JavaScript"，"vue" → "Vue"，"react" → "React"
- createdAfter: "最近一年" → "${halfYearAgo}"，"今年" → "${yearStart}"，"最近半年" → "${halfYearAgo}"
- updatedAfter: "活跃" → "${monthAgo}"，"近期更新" → "${monthAgo}"
- sort: "最新" → "updated"，"最热/热门" → "stars"，"最多star" → "stars"

confidence 规则：
- 0.9-1.0：意图非常明确（如 "react 报错" → issue+error）
- 0.6-0.9：意图较明确（如 "python 项目" → repo）
- 0.3-0.6：意图模糊（如 "react" 单词，可能是仓库也可能是 issue）
- 0.0-0.3：完全无法判断（如 "test" "abc" "随便搜搜"）

ambiguous 规则：
- true：输入太短（单词）、太泛（test/abc/hello）、无明显意图信号
- false：有明确意图信号

showAll 规则：
- true：应该宽搜多源展示（ambiguous 或 mixed）
- false：意图明确，可以收窄到单源

示例：
"小型 python 仓库" → {"intent":"repo","subIntent":null,"queryRewrite":"python","sources":["repo"],"filters":{"minStars":null,"maxStars":1000,"language":"Python","createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.85,"ambiguous":false,"showAll":false}
"最近一年的活跃 vue 项目" → {"intent":"repo","subIntent":"active","queryRewrite":"vue stars:>100","sources":["repo"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":"${halfYearAgo}","updatedAfter":"${monthAgo}","sort":null},"confidence":0.9,"ambiguous":false,"showAll":false}
"适合新手的 React issue" → {"intent":"issue","subIntent":"beginner","queryRewrite":"react good first issue OR help wanted OR beginner friendly","sources":["issue"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.9,"ambiguous":false,"showAll":false}
"什么是 fork" → {"intent":"qa","subIntent":"concept","queryRewrite":"什么是 fork","sources":["knowledge"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.95,"ambiguous":false,"showAll":false}
"react 报错" → {"intent":"issue","subIntent":"error","queryRewrite":"react error OR bug OR issue","sources":["issue","code","knowledge"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.9,"ambiguous":false,"showAll":false}
"react 教程" → {"intent":"qa","subIntent":"tutorial","queryRewrite":"react tutorial OR example OR demo","sources":["knowledge","code","repo"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.85,"ambiguous":false,"showAll":false}
"test" → {"intent":"mixed","subIntent":null,"queryRewrite":"test","sources":["repo","issue","code","knowledge","web"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.2,"ambiguous":true,"showAll":true}
"async function" → {"intent":"code","subIntent":null,"queryRewrite":"async function","sources":["code"],"filters":{"minStars":null,"maxStars":null,"language":null,"createdAfter":null,"updatedAfter":null,"sort":null},"confidence":0.8,"ambiguous":false,"showAll":false}`
}

/**
 * L4 兜底专用 prompt：同义词扩展 + 最终 rerank 解释
 * 与 L3 不同，L4 专门做"扩词"和"模糊 query 兜底"
 */
function buildExpandSystemPrompt() {
  return `你是一个搜索查询扩展器。当轻量模型无法确定意图或召回结果太少时，你负责扩展同义词和相关词。

返回 JSON 格式（只返回 JSON）：
{
  "intent": "repo|issue|code|qa|mixed",
  "subIntent": "beginner|active|error|tutorial|concept|discovery|null",
  "queryRewrite": "扩展后的查询（用 OR 连接同义词）",
  "sources": ["repo","issue","code","knowledge","web"],
  "filters": {...},
  "confidence": 0.0,
  "ambiguous": true,
  "showAll": true,
  "expandedTerms": ["同义词1","同义词2","相关词1"]
}

扩词规则：
- 技术栈名：react → "react OR reactjs OR react.js"
- 概念词：新手 → "good first issue OR beginner friendly OR help wanted OR first contribution"
- 错误词：报错 → "error OR bug OR exception OR crash"
- 教程词：教程 → "tutorial OR guide OR example OR demo OR walkthrough"
- 框架别名：vue → "vue OR vuejs OR vue.js OR vue2 OR vue3"
- 语言别名：js → "javascript OR js OR nodejs"

示例：
"react 新手" → {"intent":"issue","subIntent":"beginner","queryRewrite":"react OR reactjs good first issue OR beginner friendly OR help wanted","sources":["issue"],"filters":{},"confidence":0.7,"ambiguous":false,"showAll":false,"expandedTerms":["reactjs","good first issue","beginner friendly","help wanted"]}
"python 怎么用" → {"intent":"qa","subIntent":"tutorial","queryRewrite":"python tutorial OR guide OR example OR demo","sources":["knowledge","code","repo"],"filters":{},"confidence":0.75,"ambiguous":false,"showAll":false,"expandedTerms":["guide","example","demo"]}`
}

/** 解析 LLM 返回的意图 JSON（L3/L4 共用，输出 8 字段结构） */
function parseIntentResult(result, query) {
  if (!result) return null
  const jsonStr = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const parsed = JSON.parse(jsonStr)
  if (!['repo', 'issue', 'code', 'qa', 'mixed'].includes(parsed.intent)) return null

  // 兼容旧字段名 rewrittenQuery → queryRewrite
  const queryRewrite = parsed.queryRewrite || parsed.rewrittenQuery || query

  // sources 默认根据 intent 推导（兜底）
  let sources = parsed.sources
  if (!Array.isArray(sources) || sources.length === 0) {
    if (parsed.intent === 'mixed' || parsed.ambiguous === true) {
      sources = ['repo', 'issue', 'code', 'knowledge', 'web']
    } else if (parsed.intent === 'repo') sources = ['repo']
    else if (parsed.intent === 'issue') sources = ['issue']
    else if (parsed.intent === 'code') sources = ['code']
    else if (parsed.intent === 'qa') sources = ['knowledge', 'web']
    else sources = ['repo', 'issue', 'code', 'knowledge', 'web']
  }

  return {
    intent: parsed.intent,
    subIntent: parsed.subIntent || null,
    queryRewrite,
    sources,
    filters: parsed.filters || {},
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    ambiguous: parsed.ambiguous === true,
    showAll: parsed.showAll === true || parsed.ambiguous === true || parsed.intent === 'mixed',
    // L4 扩展词（仅 L4 输出，L3 为空数组）
    expandedTerms: Array.isArray(parsed.expandedTerms) ? parsed.expandedTerms : [],
  }
}

/**
 * 用指定模型调用 chat（内部工具函数）
 * 不走 llmProvider.chat（那个固定用配置的模型），这里直接指定模型
 */
async function chatWithModel(systemPrompt, userMessage, model, maxTokens) {
  const apiKey = await getSetting('siliconflow_api_key') || DEFAULT_API_KEY
  return _chat({ apiKey, model, systemPrompt, userMessage, maxTokens, timeout: 15000 })
}

/**
 * L3：轻量模型分析意图（A3B，~1.7s）
 * 大部分情况走这里，输出 8 字段结构（intent/subIntent/queryRewrite/sources/filters/confidence/ambiguous/showAll）
 * @param {string} query 用户原始输入
 * @returns {Promise<object | null>}
 */
export async function analyzeIntentLight(query) {
  if (!isLLMAvailable()) return null
  try {
    const result = await chatWithModel(buildIntentSystemPrompt(), query, LIGHT_LLM_MODEL, 1024)
    return parseIntentResult(result, query)
  } catch (err) {
    console.warn('[L3] 轻量模型意图分析失败:', err.message)
    return null
  }
}

/**
 * L4：全量模型兜底扩词（8B，~15s）
 * L3 失败/置信度低/召回少时才走，专门做同义词扩展
 * @param {string} query 用户原始输入
 * @returns {Promise<object | null>}
 */
export async function analyzeIntent(query) {
  if (!isLLMAvailable()) return null
  try {
    const result = await chatWithModel(buildExpandSystemPrompt(), query, FULL_LLM_MODEL, 1024)
    return parseIntentResult(result, query)
  } catch (err) {
    console.warn('[L4] 全量模型扩词失败:', err.message)
    return null
  }
}
