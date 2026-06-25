/** SearXNG 实例 1 代理：/api/searx1/* → https://searx.be/* */
import { createSearxngProxy, searxngOnRequestOptions } from '../../_lib/searxng-proxy.js'

export const onRequest = createSearxngProxy('https://searx.be')
export const onRequestOptions = searxngOnRequestOptions
