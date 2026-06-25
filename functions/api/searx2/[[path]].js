/** SearXNG 实例 2 代理：/api/searx2/* → https://search.sapti.me/* */
import { createSearxngProxy, searxngOnRequestOptions } from '../../_lib/searxng-proxy.js'

export const onRequest = createSearxngProxy('https://search.sapti.me')
export const onRequestOptions = searxngOnRequestOptions
