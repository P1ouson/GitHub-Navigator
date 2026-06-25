/**
 * 意图 Embedding 匹配（L2）— 独立于知识库 RAG
 *
 * 设计原则：
 *   1. 独立存储：用 db.intentCache 表，不碰 ragChunks（知识库）
 *   2. 独立职责：服务"搜索意图路由"，不服务"知识问答"
 *   3. 增量学习：每次 LLM 分析成功的 (query, intent) 存入缓存，下次相似 query 直接命中
 *
 * 流程：
 *   1. 新 query 进来 → 算 embedding（0.2s）
 *   2. 跟 intentCache 里所有历史 query 的 embedding 算余弦相似度
 *   3. 最高相似度 > 阈值（0.88）→ 直接返回历史结果（命中 L2）
 *   4. 否则返回 null → 调用方降级到 L3（轻量模型）
 *
 * 注意：embedding API 与知识库共用 SiliconFlow BAAI/bge-m3，但存储和检索完全独立
 */

import { db } from './db.js'
import { getEmbedding, cosineSimilarity } from './embedding.js'

const SIMILARITY_THRESHOLD = 0.88  // 相似度阈值：高于此值认为意图相同
const MAX_CACHE_SIZE = 200          // 缓存上限，超过时清理最旧的

/**
 * L2：用 embedding 匹配历史意图
 * @param {string} query 用户原始查询
 * @returns {Promise<{intent, rewrittenQuery, filters, score} | null>}
 *   命中返回历史结果，未命中返回 null
 */
export async function matchIntentByEmbedding(query) {
  try {
    // 1. 算当前 query 的 embedding
    const queryEmbedding = await getEmbedding(query)

    // 2. 加载所有历史缓存（数据量不大，全量扫描）
    const allCache = await db.intentCache.toArray()
    if (allCache.length === 0) return null

    // 3. 找最相似的历史 query
    let bestMatch = null
    let bestScore = 0
    for (const entry of allCache) {
      if (!entry.embedding || entry.embedding.length !== queryEmbedding.length) continue
      const score = cosineSimilarity(queryEmbedding, entry.embedding)
      if (score > bestScore) {
        bestScore = score
        bestMatch = entry
      }
    }

    // 4. 相似度达标才算命中
    if (bestMatch && bestScore >= SIMILARITY_THRESHOLD) {
      return {
        intent: bestMatch.intent,
        rewrittenQuery: bestMatch.rewrittenQuery,
        filters: bestMatch.filters || {},
        score: bestScore,
      }
    }

    return null
  } catch (err) {
    console.warn('[L2] 意图 embedding 匹配失败:', err.message)
    return null
  }
}

/**
 * 把一次成功的意图分析结果存入缓存（供下次 L2 匹配）
 * @param {string} query 用户原始查询
 * @param {{intent, rewrittenQuery, filters}} result LLM 分析结果
 */
export async function cacheIntentResult(query, result) {
  if (!query || !result || !result.intent) return

  try {
    // 算 embedding（复用，如果 matchIntentByEmbedding 已经算过就不重复算了——
    // 这里简单起见重新算一次，0.2s 开销可接受）
    const embedding = await getEmbedding(query)

    // 去重：如果已有相同 query，更新而非新增
    const existing = await db.intentCache.where('query').equals(query).first()
    if (existing) {
      await db.intentCache.update(existing.id, {
        intent: result.intent,
        rewrittenQuery: result.rewrittenQuery,
        filters: result.filters,
        embedding,
        ts: Date.now(),
      })
      return
    }

    await db.intentCache.add({
      query,
      intent: result.intent,
      rewrittenQuery: result.rewrittenQuery,
      filters: result.filters,
      embedding,
      ts: Date.now(),
    })

    // 清理：超过上限时删最旧的
    const count = await db.intentCache.count()
    if (count > MAX_CACHE_SIZE) {
      const oldest = await db.intentCache.orderBy('ts').limit(count - MAX_CACHE_SIZE).toArray()
      await db.intentCache.bulkDelete(oldest.map(e => e.id))
    }
  } catch (err) {
    console.warn('[L2] 缓存意图结果失败:', err.message)
  }
}

/**
 * 获取意图缓存统计（调试/设置页用）
 */
export async function getIntentCacheStats() {
  const count = await db.intentCache.count()
  return { count, threshold: SIMILARITY_THRESHOLD, max: MAX_CACHE_SIZE }
}

/**
 * 清空意图缓存（设置页"清除缓存"用）
 */
export async function clearIntentCache() {
  await db.intentCache.clear()
}