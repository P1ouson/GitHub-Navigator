/**
 * 统一 repo 数据 service（Layer A 缓存优先 → API 获取 → normalize）
 *
 * 职责边界：
 *   - 封装"缓存优先 → API 获取 → normalize → 写缓存"流程
 *   - 调用 repoCache.js 做缓存读写
 *   - 调用 githubSchema.js 的 normalizeRepoEntryFromREST/GraphQL 做 entry 拼装（不再内联）
 *   - 不负责 normalizer 的字段语义（由 githubSchema.js 负责）
 *   - 不负责缓存持久化细节（由 repoCache.js 负责）
 *
 * 对外 API 兼容：
 *   - getRepoEntry            = 旧 getRepoInfoCached（返回 entry）
 *   - batchGetRepoEntries     = 旧 batchGetRepoInfos（返回 { map, stats }）
 *   - getRepoSummary          = 旧 getRepoInfo（返回 RepoSummary）
 *   - batchGetRepoSummaries   = 新增（返回 Map<repo, RepoSummary>）
 *
 * 循环依赖说明：
 *   本模块从 github.js import getOctokit/safeGithub，github.js re-export 本模块函数。
 *   ESM live binding 特性保证函数引用在调用时解析，循环依赖可正常工作。
 */

import { getOctokit, safeGithub } from './github.js'
import { mapConcurrent } from './concurrency.js'
import {
  getRepoCacheEntry,
  setRepoCacheEntry,
} from './repoCache.js'
import {
  normalizeRepoEntryFromREST,
  normalizeRepoSummaryFromCache,
} from './githubSchema.js'

/**
 * 统一仓库信息读取（Layer A 缓存优先）
 * 仅当缓存中无有效数据时才调用 API。
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<RepoCacheEntry|null>} entry 或 null（API 失败）
 */
export async function getRepoEntry(owner, repo) {
  const key = `${owner}/${repo}`
  const cached = getRepoCacheEntry(key)
  if (cached) return cached

  const octokit = getOctokit()
  try {
    const { data } = await octokit.rest.repos.get({ owner, repo })
    const entry = normalizeRepoEntryFromREST(data, key)
    setRepoCacheEntry(key, entry)
    return entry
  } catch {
    return null // API 失败不写缓存
  }
}

/**
 * REST 批量获取仓库健康信息（Layer A 缓存优先）
 * 使用 REST API 并行请求替代 GraphQL，避免 GraphQL 超时，提升可靠性
 * @param {string[]} repos - ["owner/repo", ...]
 * @returns {Promise<{ map: Map<string, RepoCacheEntry>, stats: { cacheHits: number } }>}
 */
export async function batchGetRepoEntries(repos) {
  const unique = [...new Set(repos)].filter(Boolean)
  const results = new Map()
  const toFetch = []
  let cacheHits = 0

  for (const repo of unique) {
    const cached = getRepoCacheEntry(repo)
    if (cached) {
      results.set(repo, cached)
      cacheHits++
    } else {
      toFetch.push(repo)
    }
  }

  if (!toFetch.length) return { map: results, stats: { cacheHits } }

  // REST 并行 8 路，分组批量请求
  const fetched = await mapConcurrent(
    toFetch,
    async (repo) => {
      const [o, n] = repo.split('/')
      if (!o || !n) return null
      const info = await safeGithub(() => getRepoEntry(o, n), null)
      return info ? { repo, entry: info } : null
    },
    8
  )
  for (const r of fetched) {
    if (r.status !== 'fulfilled' || !r.value) continue
    results.set(r.value.repo, r.value.entry)
  }

  return { map: results, stats: { cacheHits } }
}

/**
 * 获取仓库基础信息（返回 RepoSummary）
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<RepoSummary>}
 * @throws {Error} 仓库不存在或无法访问
 */
export async function getRepoSummary(owner, repo) {
  const entry = await getRepoEntry(owner, repo)
  if (!entry) throw new Error('仓库不存在或无法访问')
  return normalizeRepoSummaryFromCache(entry, `${owner}/${repo}`)
}

/**
 * 批量获取仓库 RepoSummary
 * @param {string[]} repos - ["owner/repo", ...]
 * @returns {Promise<Map<string, RepoSummary>>}
 */
export async function batchGetRepoSummaries(repos) {
  const { map } = await batchGetRepoEntries(repos)
  const summaries = new Map()
  for (const [repo, entry] of map) {
    summaries.set(repo, normalizeRepoSummaryFromCache(entry, repo))
  }
  return summaries
}

/* ===== 兼容别名导出（保持 github.js 旧 API 不变）===== */
export { getRepoEntry as getRepoInfoCached }
export { batchGetRepoEntries as batchGetRepoInfos }
export { getRepoSummary as getRepoInfo }
