/**
 * RAG 引擎 — 多源知识库检索 + LLM 问答
 *
 * 流程：
 * 1. 从 4 个外部知识源并行检索（DevDocs / GitHub Docs / GitHub Blog / GitHub Skills）
 * 2. 拼接上下文 → LLM 生成回答（流式 / 非流式）
 *
 * 已移除旧的本地 KB 向量检索（knowledge.js + IndexedDB），改用外部多源实时检索。
 */

import { searchAllSources } from './externalKB.js'
import { chat, chatStream } from './llm.js'

// ==================== RAG 问答（非流式） ====================

/**
 * 多源 RAG 问答：检索 → 拼上下文 → LLM 生成回答
 * @param {string} query 用户问句
 * @returns {Promise<{answer: string, sources: Array}>}
 */
export async function askRAG(query) {
  // 1. 多源检索
  let sources = []
  try {
    sources = await searchAllSources(query)
  } catch {
    sources = []
  }

  const topSources = sources.slice(0, 5)

  // 2. 构造 Prompt
  let systemPrompt
  if (topSources.length > 0) {
    const context = topSources
      .map((r, i) => `[${i + 1}] [${r.source}] ${r.title}\n${r.text}`)
      .join('\n\n---\n\n')
    systemPrompt = `你是 GitHub 新手助手。优先基于知识库内容回答，知识库没有的直接用你的知识补充。

规则：
- 你必须使用简体中文回复，禁止使用英文
- 回答控制在 3-5 句话，不要长篇大论
- 可引用具体命令，但不要展开教程

知识库内容：
${context}`
  } else {
    systemPrompt = `你是 GitHub 新手助手。知识库中没有该问题的直接答案，请用你的知识简要回答。

规则：
- 你必须使用简体中文回复，禁止使用英文
- 回答控制在 3-5 句话，不要长篇大论
- 可以介绍 GitHub 相关概念、命令和流程`
  }

  // 3. LLM 生成
  const answer = await chat(systemPrompt, query)

  return {
    answer: answer || '抱歉，暂时无法生成回答。',
    sources: topSources.map(r => ({ title: r.title, category: r.category, score: r.score, url: r.url })),
  }
}

// ==================== RAG 问答（流式） ====================

/**
 * 流式 RAG 问答 — 逐 chunk 回调，适合边生成边显示
 * @param {string} query 用户问句
 * @param {(chunk: string) => void} onChunk 每收到一段文本就回调
 * @param {number} maxTokens 最大 token 数（默认 512）
 * @returns {Promise<{answer: string, sources: Array}>}
 */
export async function askRAGStream(query, onChunk, maxTokens = 512) {
  // 1. 多源检索
  let sources = []
  try {
    sources = await searchAllSources(query)
  } catch {
    sources = []
  }

  const topSources = sources.slice(0, 5)

  // 2. 构造 Prompt
  let systemPrompt
  if (topSources.length > 0) {
    const context = topSources
      .map((r, i) => `[${i + 1}] [${r.source}] ${r.title}\n${r.text}`)
      .join('\n\n---\n\n')
    systemPrompt = `你是 GitHub 新手助手。优先基于知识库内容回答，知识库没有的直接用你的知识补充。

规则：
- 你必须使用简体中文回复
- 你的回答**必须**在 ${maxTokens === 512 ? '约 400 字' : '约 800 字'} 以内**完整结束**，不要超出导致截断
- 先说结论，再分点说明，最后总结
- 如果涉及操作流程，分步骤说明
- 确保**最后一个句子完整结束**，不要在中途被截断

知识库内容：
${context}`
  } else {
    systemPrompt = `你是 GitHub 新手助手。知识库中没有该问题的直接答案，请用你的知识详细回答。

规则：
- 你必须使用简体中文回复
- 你的回答**必须**在 ${maxTokens === 512 ? '约 400 字' : '约 800 字'} 以内**完整结束**，不要超出导致截断
- 先说结论，再分点说明，最后总结
- 如果涉及操作流程，分步骤说明
- 确保**最后一个句子完整结束**，不要在中途被截断`
  }

  // 3. 流式生成
  let fullAnswer = ''
  try {
    fullAnswer = (await chatStream(systemPrompt, query, (chunk) => {
      fullAnswer += chunk
      onChunk?.(fullAnswer)
    }, maxTokens)) || ''
  } catch (err) {
    console.warn('[RAG] 流式问答失败:', err.message)
  }

  return {
    answer: fullAnswer || '抱歉，暂时无法生成回答。',
    sources: topSources.map(r => ({ title: r.title, category: r.category, score: r.score, url: r.url })),
  }
}

// ==================== 兼容旧接口 ====================

/** 检查 RAG 索引是否可用（始终返回 true，不再需要本地索引） */
export async function isRAGIndexReady() { return true }

/** 获取 RAG 统计信息 */
export async function getRAGStats() {
  return { chunkCount: 0, ready: true, mode: 'external' }
}

/** 向量检索（已废弃，保留兼容） */
export async function searchRAG() { return [] }

/** 构建索引（已废弃，保留兼容） */
export async function buildRAGIndex() {}