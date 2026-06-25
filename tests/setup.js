/**
 * Vitest 全局 setup
 *
 * - 注入 @testing-library/jest-dom 的 DOM 断言匹配器
 * - mock window.matchMedia 等 jsdom 缺失的 API
 */
import '@testing-library/jest-dom/vitest'

// jsdom 缺失 matchMedia，React 组件可能用到
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// jsdom 缺失 scrollTo
if (!window.scrollTo) {
  window.scrollTo = () => {}
}
