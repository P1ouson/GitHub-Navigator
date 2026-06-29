/**
 * Embedding 公共能力模块
 *
 * 收口 SiliconFlow BAAI/bge-m3 embedding 的请求样板代码：
 *   - API key 获取（统一 fallback 策略）
 *   - API 地址 / model 常量
 *   - 单条 / 批量 embedding 请求
 *   - 余弦相似度计算
 *
 * 收口原因：intentEmbedding.js 与 rag.js 各维护一份相同的
 *   getAPIKey / EMBEDDING_API / EMBEDDING_MODEL / cosineSimilarity / fetch 样板，
 *   后续若要改 provider / timeout / key 获取方式，只改一处。
 *
 * 注意：本模块只提供 embedding 能力，不涉及 RAG 主流程或意图分析业务逻辑。
 */

import { getSetting } from './db.js'
import { DEFAULT_SILICONFLOW_KEY } from './keys.js'

/** SiliconFlow embedding API 地址 */
export const EMBEDDING_API = 'https://api.siliconflow.cn/v1/embeddings'

/** embedding 模型常量 */
export const EMBEDDING_MODEL = 'BAAI/bge-m3'

/** 内存缓存上限：超过该条数时按插入顺序淘汰最旧的一条 */
const EMBEDDING_CACHE_MAX = 200

/**
 * embedding 内存缓存
 * key 为输入文本 text，value 为对应的 embedding 向量
 * 利用 Map 的插入顺序特性实现简单的 FIFO 淘汰
 */
const embeddingCache = new Map()

/**
 * 重置 embedding 内存缓存（仅供测试使用）
 */
export function __resetEmbeddingCache() {
  embeddingCache.clear()
}

/**
 * 获取 embedding API key
 * 优先读用户配置，缺失时使用 fallback（与原 intentEmbedding/rag 行为一致）
 * @returns {Promise<string>}
 */
export async function getEmbeddingAPIKey() {
  return await getSetting('siliconflow_api_key') || DEFAULT_SILICONFLOW_KEY
}

/**
 * 获取单条文本的 embedding
 * 内置内存缓存：相同 text 命中缓存时直接返回，未命中才发起网络请求
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text) {
  // 命中缓存直接返回，避免重复请求
  if (embeddingCache.has(text)) {
    return embeddingCache.get(text)
  }

  const apiKey = await getEmbeddingAPIKey()
  const resp = await fetch(EMBEDDING_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  })
  if (!resp.ok) {
    throw new Error(`Embedding API 错误 (${resp.status})`)
  }
  const data = await resp.json()
  const embedding = data.data[0].embedding

  // 写入缓存；超过上限时按插入顺序淘汰最旧的一条
  embeddingCache.set(text, embedding)
  if (embeddingCache.size > EMBEDDING_CACHE_MAX) {
    const oldestKey = embeddingCache.keys().next().value
    embeddingCache.delete(oldestKey)
  }

  return embedding
}

/**
 * 批量获取文本 embedding（单条输入也兼容）
 * @param {string|string[]} texts - 单条或批量文本
 * @returns {Promise<number[]|number[][]>} - 单条返回 number[]，批量返回 number[][]
 */
export async function getEmbeddings(texts) {
  const apiKey = await getEmbeddingAPIKey()
  const input = Array.isArray(texts) ? texts : [texts]
  const resp = await fetch(EMBEDDING_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Embedding API 错误 (${resp.status}): ${err}`)
  }
  const data = await resp.json()
  const embeddings = data.data.map(d => d.embedding)
  return Array.isArray(texts) ? embeddings : embeddings[0]
}

/**
 * 余弦相似度
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} [-1, 1]，分母为 0 时返回 0
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
