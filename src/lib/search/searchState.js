/**
 * 搜索状态机定义
 *
 * 收口 SearchPage 原本散落的多个 loading 布尔值（loading/loadingMore/loadingHint/
 * labelSearchLoading/repoFilterLoading/ragLoading/error）为单一可解释的状态体系。
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │                       搜索状态迁移图                                │
 * │                                                                      │
 * │   idle ──submitSearch──▶ searching                                   │
 * │    ▲                         │                                       │
 * │    │                         ├──(repo URL/org)──▶ idle (快速完成)    │
 * │    │                         ├──(partial ready)──▶ searching         │
 * │    │                         ├──searchError──▶ error                 │
 * │    │                         └──searchSuccess──▶ idle                │
 * │    │                                                                   │
 * │    ├──loadMore──▶ loading_more ──▶ idle                               │
 * │    ├──applyLabelFilter──▶ label_search ──▶ idle                      │
 * │    ├──applyRepoFilter──▶ repo_filter ──▶ idle                        │
 * │    └──resetSearch──▶ idle                                             │
 * │                                                                      │
 * │   ragLoading 独立并行：startRag ▶ true / ragDone|ragError ▶ false     │
 * │   可与 searching / loading_more / idle 任一状态并存                   │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 状态语义：
 *   - 'idle'        : 空闲，无搜索进行中
 *   - 'searching'   : 首次搜索中（主流程，含 L1-L4 路由 + 多源调度 + 两阶段加载）
 *   - 'label_search': label 重搜中（用户在筛选栏勾选 label 触发）
 *   - 'loading_more': 加载更多中（翻页时池中数据不足，后台 fetchMore）
 *   - 'repo_filter' : repo 筛选后台拉取中（用户勾选语言/主题触发）
 *   - 'error'       : 出错（网络/限流/鉴权等，文案在 error 字段）
 *
 * 注意：ragLoading 可与 searching/loading_more 并行，因此独立于 status。
 *   orchestrator 返回 { status, ragLoading, hint, error } 四个字段，页面据此映射 UI。
 *
 * 不变量（invariants）：
 *   - status 任意时刻只能取一个值（互斥）
 *   - ragLoading 独立于 status，可并行
 *   - searching 期间不允许再触发 searching（由 orchestrator._running 守护）
 *   - error 状态后下一次 submitSearch 会重置回 searching
 */

/**
 * @typedef {'idle'|'searching'|'label_search'|'loading_more'|'repo_filter'|'expanding'|'error'} SearchStatus
 */

/**
 * @typedef {Object} SearchState
 * @property {SearchStatus} status    - 当前搜索状态（互斥）
 * @property {string} hint            - 子阶段提示文案（如 "AI 分析中..."），仅 searching 时有意义
 * @property {string|null} error      - 错误文案，仅 status==='error' 时有意义
 * @property {boolean} ragLoading     - RAG 生成中（独立于 status，可并行）
 */

/**
 * 搜索动作枚举。
 *
 * 每个动作对应一次状态迁移，orchestrator 的方法必须通过这些动作来变更状态，
 * 不允许直接 setState 操纵任意字段。
 *
 * @typedef {'submitSearch'|'searchSuccess'|'searchError'|'loadMore'
 *   |'applyLabelFilter'|'applyRepoFilter'|'startRag'|'ragDone'|'ragError'
 *   |'resetSearch'|'cancelStaleRequest'} SearchAction
 */

/**
 * 搜索动作 → 状态迁移映射表。
 *
 * 用于测试和文档：给定当前状态 + 动作，可以查到下一状态。
 * 注意：ragLoading 的动作（startRag/ragDone/ragError）不改变 status，只改 ragLoading。
 *
 * @type {Record<string, {from: SearchStatus[], to: SearchStatus, ragLoading?: boolean}>}
 */
export const SEARCH_TRANSITIONS = {
  submitSearch:      { from: ['idle', 'error', 'idle'], to: 'searching' },
  searchSuccess:     { from: ['searching'], to: 'idle' },
  searchError:       { from: ['searching'], to: 'error' },
  loadMore:          { from: ['idle'], to: 'loading_more' },
  applyLabelFilter:  { from: ['idle'], to: 'label_search' },
  applyRepoFilter:   { from: ['idle'], to: 'repo_filter' },
  startExpand:       { from: ['idle'], to: 'expanding' },
  expandDone:        { from: ['expanding'], to: 'idle' },
  expandError:       { from: ['expanding'], to: 'error' },
  // RAG 动作只改 ragLoading，不改 status
  startRag:          { from: ['idle', 'searching', 'loading_more'], to: 'idle', ragLoading: true },
  ragDone:           { from: ['idle', 'searching', 'loading_more'], to: 'idle', ragLoading: false },
  ragError:          { from: ['idle', 'searching', 'loading_more'], to: 'idle', ragLoading: false },
  resetSearch:       { from: ['idle', 'error', 'searching', 'loading_more', 'label_search', 'repo_filter', 'expanding'], to: 'idle' },
  cancelStaleRequest:{ from: ['searching'], to: 'searching' }, // 代次切换，状态不变但旧请求作废
}

/**
 * 判断状态迁移是否合法
 * @param {SearchStatus} current
 * @param {SearchAction} action
 * @returns {boolean}
 */
export function canTransition(current, action) {
  const rule = SEARCH_TRANSITIONS[action]
  if (!rule) return false
  return rule.from.includes(current)
}

/**
 * 初始搜索状态
 * @type {SearchState}
 */
export const INITIAL_SEARCH_STATE = {
  status: 'idle',
  hint: '',
  error: null,
  ragLoading: false,
}

/**
 * 所有合法的搜索状态值（供测试和校验用）
 * @type {SearchStatus[]}
 */
export const SEARCH_STATUSES = ['idle', 'searching', 'label_search', 'loading_more', 'repo_filter', 'expanding', 'error']
