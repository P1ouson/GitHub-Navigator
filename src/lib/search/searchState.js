/**
 * 搜索状态定义
 *
 * 状态语义：
 *   - 'idle'        : 空闲，无搜索进行中
 *   - 'searching'   : 首次搜索中（主流程，含 L1-L4 路由 + 多源调度 + 两阶段加载）
 *   - 'label_search': label 重搜中（用户在筛选栏勾选 label 触发）
 *   - 'loading_more': 加载更多中（翻页时池中数据不足，后台 fetchMore）
 *   - 'repo_filter' : repo 筛选后台拉取中（用户勾选语言/主题触发）
 *   - 'expanding'   : 自动扩搜中
 *   - 'error'       : 出错（网络/限流/鉴权等，文案在 error 字段）
 *
 * 不变量（invariants）：
 *   - status 任意时刻只能取一个值（互斥）
 *   - ragLoading 独立于 status，可并行
 *   - searching 期间不允许再触发 searching（由 orchestrator._running 守护）
 *   - error 状态后下一次 submitSearch 会重置回 searching
 *
 * @typedef {'idle'|'searching'|'label_search'|'loading_more'|'repo_filter'|'expanding'|'error'} SearchStatus
 */

/**
 * 初始搜索状态
 * @type {{status: SearchStatus, hint: string, error: string|null, ragLoading: boolean}}
 */
export const INITIAL_SEARCH_STATE = {
  status: 'idle',
  hint: '',
  error: null,
  ragLoading: false,
}
