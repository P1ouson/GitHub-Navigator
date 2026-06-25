/**
 * 页面状态缓存 + usePersistState hook
 *
 * usePersistState 用法跟 useState 一模一样，但会自动存 sessionStorage。
 * 页面切走再回来，状态自动恢复，不用手动 save/load。
 *
 * 不持久化的类型（Set, Date, Function 等）会降级为普通 useState。
 */
import { useState, useEffect, useRef } from 'react'

const PREFIX = 'gn_page_'

function serialize(v) {
  // Set → 数组
  if (v instanceof Set) return { __t: 'Set', v: [...v] }
  return v
}

function deserialize(v) {
  if (v && typeof v === 'object' && v.__t === 'Set') return new Set(v.v)
  return v
}

export function usePersistState(pageId, key, defaultValue) {
  const storageKey = `${PREFIX}${pageId}_${key}`
  const isFirstRender = useRef(true)

  const [value, setValue] = useState(() => {
    try {
      const cached = sessionStorage.getItem(storageKey)
      if (cached !== null) {
        const parsed = JSON.parse(cached)
        return deserialize(parsed)
      }
    } catch { /* 解析失败，用默认值 */ }
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue
  })

  // 值变化时自动写 sessionStorage
  useEffect(() => {
    // 跳过首次渲染（避免覆盖已有缓存）
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(serialize(value)))
    } catch { /* 存储满 */ }
  }, [storageKey, value])

  return [value, setValue]
}