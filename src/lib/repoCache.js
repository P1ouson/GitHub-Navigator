/**
 * Layer A 持久仓库缓存（跨搜索、跨刷新，30 分钟 TTL）
 *
 * 职责边界：
 *   - 仅负责缓存存取、TTL 判断、Dexie 持久化、hydrate
 *   - 不负责 normalizer（由 githubSchema.js 负责）
 *   - 不负责 API 调用（由 repoService.js 负责）
 *   - 不负责 entry 字段拼装（由 githubSchema.js 的 normalizeRepoEntryFrom* 负责）
 *
 * 缓存 entry 结构（由 githubSchema.normalizeRepoEntryFromREST/GraphQL 产出）：
 *   主字段：name, fullName, desc, stars, forks, openIssues, language, url, topics, updatedAt, archived
 *   元数据：_ts
 *
 * 性能优化：
 *   - persistRepoCache debounce 300ms，多次写入合并为一次全量 persist
 *   - maxEntries = 500，超过上限时淘汰 _ts 最早的 entry（LRU 简单版）
 *   - hydrate 时同样限制，只恢复最新的 500 条
 *
 * 字段语义约定：
 *   - stars/forks/openIssues 为 number | null（null 表示未知，禁止用 0 伪装）
 *   - 旧缓存 entry 的兼容字段（description/pushedAt 等）原样保留，由 normalizer 层兜底
 */

import { getSetting, setSetting } from './db.js'

/** Dexie 中存储 repo 缓存的 setting key */
export const REPO_CACHE_SETTING_KEY = 'repo_info_cache'

/** 缓存 TTL：30 分钟 */
export const REPO_CACHE_TTL = 30 * 60 * 1000

/** 缓存上限：超过时淘汰 _ts 最早的 entry（LRU 简单版） */
export const REPO_CACHE_MAX_ENTRIES = 500

/** persist debounce 延迟：多次写入合并为一次全量持久化 */
const PERSIST_DEBOUNCE_MS = 300

/** 内存缓存（Layer A 的第一级，最快） */
const repoInfoCache = new Map()

/** persist debounce 定时器 */
let persistTimer = null

/**
 * 读取缓存 entry（含 TTL 判断）
 * @param {string} key - "owner/repo"
 * @returns {object|null} entry 或 null（未命中/已过期）
 */
export function getRepoCacheEntry(key) {
  const cached = repoInfoCache.get(key)
  if (cached && Date.now() - cached._ts < REPO_CACHE_TTL) return cached
  return null
}

/**
 * 写入缓存 entry 并触发 debounced 持久化
 * 超过 maxEntries 时淘汰 _ts 最早的 entry
 * @param {string} key - "owner/repo"
 * @param {object} entry - 缓存 entry（须含 _ts）
 */
export function setRepoCacheEntry(key, entry) {
  repoInfoCache.set(key, entry)
  evictIfNeeded()
  schedulePersist()
}

/**
 * 是否有新鲜缓存（不返回 entry，仅判断）
 * @param {string} key
 * @returns {boolean}
 */
export function hasFreshCache(key) {
  const cached = repoInfoCache.get(key)
  return !!(cached && Date.now() - cached._ts < REPO_CACHE_TTL)
}

/**
 * 直接读取内存 Map 中的 entry（不做 TTL 判断，供 batch 场景内部使用）
 * @param {string} key
 * @returns {object|undefined}
 */
export function getRawRepoCacheEntry(key) {
  return repoInfoCache.get(key)
}

/**
 * 从 Dexie 恢复仓库缓存
 * 旧 entry 原样保留（不强制升级字段格式），由 normalizer 层统一处理兼容。
 * 只恢复最新的 maxEntries 条（按 _ts 降序）。
 */
export async function hydrateRepoCache() {
  try {
    const raw = await getSetting(REPO_CACHE_SETTING_KEY, null)
    if (raw && typeof raw === 'string') {
      const entries = JSON.parse(raw)
      const now = Date.now()
      const valid = []
      for (const [k, v] of Object.entries(entries)) {
        if (v && now - v._ts < REPO_CACHE_TTL) valid.push([k, v])
      }
      // 按 _ts 降序排序，只取最新的 maxEntries 条
      valid.sort((a, b) => (b[1]._ts || 0) - (a[1]._ts || 0))
      for (const [k, v] of valid.slice(0, REPO_CACHE_MAX_ENTRIES)) {
        repoInfoCache.set(k, v)
      }
    }
  } catch { /* 静默：缓存损坏不应阻塞应用启动 */ }
}

/**
 * 淘汰超额 entry：当 Map 大小超过 maxEntries 时，删除 _ts 最早的若干条
 * 简单 LRU 实现：不维护访问顺序，仅按写入时间淘汰
 */
function evictIfNeeded() {
  if (repoInfoCache.size <= REPO_CACHE_MAX_ENTRIES) return
  // 找出 _ts 最早的 entry，删除直到 size <= maxEntries
  const sorted = [...repoInfoCache.entries()].sort(
    (a, b) => (a[1]._ts || 0) - (b[1]._ts || 0)
  )
  const evictCount = repoInfoCache.size - REPO_CACHE_MAX_ENTRIES
  for (let i = 0; i < evictCount; i++) {
    repoInfoCache.delete(sorted[i][0])
  }
}

/**
 * 安排 debounced 持久化
 * 多次 setRepoCacheEntry 在 PERSIST_DEBOUNCE_MS 内合并为一次全量 persist
 */
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persistRepoCache()
  }, PERSIST_DEBOUNCE_MS)
}

/** 持久化到 Dexie（异步，不阻塞主流程） */
export function persistRepoCache() {
  try {
    const obj = Object.fromEntries(repoInfoCache)
    setSetting(REPO_CACHE_SETTING_KEY, JSON.stringify(obj)).catch(() => {})
  } catch { /* 静默：持久化失败不影响内存缓存 */ }
}

/** 测试用：清空内存缓存 + 取消 pending persist（不暴露给 product code） */
export function __resetForTest() {
  repoInfoCache.clear()
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}
