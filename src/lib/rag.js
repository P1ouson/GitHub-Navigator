/**
 * RAG 引擎 — 基于 SiliconFlow API 的向量检索 + LLM 问答
 *
 * 流程：
 * 1. Chunking: 把 knowledge.js 的 KB 条目按段落分块
 * 2. Embedding: 调用 SiliconFlow BAAI/bge-m3 获取向量
 * 3. Storage: 向量存入 IndexedDB (Dexie)
 * 4. Search: 查询时 embed → 余弦相似度 → TopK
 * 5. Generate: 拼接上下文 → LLM 生成回答
 */

import { db, getSetting, setSetting } from './db.js'
import { KB } from './knowledge.js'
import { chat, chatStream } from './llm.js'
import { getEmbeddings, cosineSimilarity } from './embedding.js'

const INDEX_VERSION_KEY = '_rag_index_version'
const CURRENT_INDEX_VERSION = '1'

// ==================== Chunking ====================

/**
 * 把 KB 条目按段落分块
 * 每块包含标题上下文，保证检索时能理解块的含义
 * @returns {Array<{id, docId, title, text, category}>}
 */
function chunkKnowledge() {
  const chunks = []
  for (const entry of KB) {
    const paragraphs = entry.body.split(/\n\s*\n/) // 按空行分段
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim()
      if (!para || para.length < 10) continue
      chunks.push({
        id: `${entry.id}__chunk_${i}`,
        docId: entry.id,
        title: entry.title,
        text: para,
        category: entry.category,
      })
    }
  }
  return chunks
}

// ==================== 向量存储 ====================

/**
 * 构建向量索引（首次或更新时调用）
 * 分批嵌入 → 存入 IndexedDB
 * @param {(progress: number, total: number) => void} onProgress
 */
export async function buildRAGIndex(onProgress) {
  const chunks = chunkKnowledge()
  const BATCH_SIZE = 20 // bge-m3 支持批量

  // 清空旧索引
  await db.ragChunks.clear()

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    const texts = batch.map(c => c.text)
    const embeddings = await getEmbeddings(texts)

    const records = batch.map((chunk, j) => ({
      ...chunk,
      embedding: embeddings[j],
    }))
    await db.ragChunks.bulkPut(records)

    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, chunks.length), chunks.length)
  }

  // 标记索引版本
  await setSetting(INDEX_VERSION_KEY, CURRENT_INDEX_VERSION)
}

/**
 * 检查是否需要重建索引
 */
export async function isRAGIndexReady() {
  const version = await getSetting(INDEX_VERSION_KEY)
  if (version !== CURRENT_INDEX_VERSION) return false
  const count = await db.ragChunks.count()
  return count > 0
}

// ==================== 向量检索 ====================

/**
 * RAG 向量检索
 * @param {string} query 用户问句
 * @param {number} topN 返回条数
 * @returns {Promise<Array<{id, docId, title, text, category, score}>>}
 */
export async function searchRAG(query, topN = 5) {
  if (!(await isRAGIndexReady())) {
    await buildRAGIndex()
  }

  // 嵌入查询
  const queryEmbedding = await getEmbeddings(query)

  // 加载所有块（数据量不大，全量扫描比建索引快）
  const allChunks = await db.ragChunks.toArray()

  // 计算相似度并排序
  const scored = allChunks.map(chunk => ({
    id: chunk.id,
    docId: chunk.docId,
    title: chunk.title,
    text: chunk.text,
    category: chunk.category,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)
}

// ==================== RAG 问答 ====================

/**
 * 完整 RAG 问答：检索 → 拼上下文 → LLM 生成回答
 * 知识库有相关内容时基于 KB 回答，否则 LLM 直接用自己的知识回答
 * @param {string} query 用户问句
 * @returns {Promise<{answer: string, sources: Array}>}
 */
export async function askRAG(query) {
  // 1. 向量检索
  let results = []
  try {
    results = await searchRAG(query, 5)
  } catch {
    // 向量检索失败（如 API 不通），降级为纯 LLM 回答
    results = []
  }

  // 2. 判断是否有相关结果（相似度 > 0.3 才算相关）
  const relevantResults = results.filter(r => r.score > 0.3)

  // 3. 构造 Prompt
  let systemPrompt
  if (relevantResults.length > 0) {
    const context = relevantResults
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.text}`)
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

  // 4. LLM 生成
  const answer = await chat(systemPrompt, query)

  return {
    answer: answer || '抱歉，暂时无法生成回答。',
    sources: relevantResults.map(r => ({ title: r.title, category: r.category, score: r.score })),
  }
}

/**
 * 流式 RAG 问答 — 逐 chunk 回调，适合边生成边显示
 * @param {string} query 用户问句
 * @param {(chunk: string) => void} onChunk 每收到一段文本就回调
 * @returns {Promise<{answer: string, sources: Array}>}
 */
export async function askRAGStream(query, onChunk) {
  // 1. 向量检索
  let results = []
  try {
    results = await searchRAG(query, 5)
  } catch {
    results = []
  }

  const relevantResults = results.filter(r => r.score > 0.3)

  // 2. 构造 Prompt（比非流式更详细）
  let systemPrompt
  if (relevantResults.length > 0) {
    const context = relevantResults
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.text}`)
      .join('\n\n---\n\n')
    systemPrompt = `你是 GitHub 新手助手。优先基于知识库内容回答，知识库没有的直接用你的知识补充。

规则：
- 你必须使用简体中文回复
- 回答尽量详细，把原理和步骤说清楚，但不超过 500 字
- 可以引用具体命令和操作步骤
- 如果涉及操作流程，分步骤说明

知识库内容：
${context}`
  } else {
    systemPrompt = `你是 GitHub 新手助手。知识库中没有该问题的直接答案，请用你的知识详细回答。

规则：
- 你必须使用简体中文回复
- 回答尽量详细，把原理和步骤说清楚，但不超过 500 字
- 介绍 GitHub 相关概念、命令和流程
- 如果涉及操作流程，分步骤说明`
  }

  // 3. 流式生成
  let fullAnswer = ''
  try {
    fullAnswer = (await chatStream(systemPrompt, query, (chunk) => {
      fullAnswer += chunk
      onChunk?.(fullAnswer)
    }, 1024)) || ''
  } catch (err) {
    console.warn('[RAG] 流式问答失败:', err.message)
  }

  return {
    answer: fullAnswer || '抱歉，暂时无法生成回答。',
    sources: relevantResults.map(r => ({ title: r.title, category: r.category, score: r.score })),
  }
}

/**
 * 获取 RAG 索引统计信息
 */
export async function getRAGStats() {
  const count = await db.ragChunks.count()
  const ready = await isRAGIndexReady()
  return { chunkCount: count, ready }
}
