/**
 * 并发工具模块
 *
 * 提供"限流并发 map"能力：分批并发执行，单批内并行，批间串行；
 * 使用 Promise.allSettled 保证单条失败不中断整体。
 *
 * 行为约定：
 *   - 输入 items 数组 + 异步 fn + concurrency（默认 8）
 *   - 返回 Promise.allSettled 格式的结果数组 [{status, value/reason}, ...]
 *   - 顺序与输入一致
 *   - 不抛错（错误封装在 rejected 状态里）
 *
 * 收口原因：github.js 与 issueLoader.js 各维护一份完全相同的实现，
 *           后续若要调整并发策略或错误传播行为，只改一处。
 */

/**
 * 限流并发 map
 * @template T, R
 * @param {T[]} items - 输入数组
 * @param {(item: T, index: number) => Promise<R>} fn - 异步处理函数
 * @param {number} [concurrency=8] - 单批并发数
 * @returns {Promise<PromiseSettledResult<R>[]>} - allSettled 格式结果
 */
export async function mapConcurrent(items, fn, concurrency = 8) {
  const result = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResult = await Promise.allSettled(batch.map(fn))
    result.push(...batchResult)
  }
  return result
}
