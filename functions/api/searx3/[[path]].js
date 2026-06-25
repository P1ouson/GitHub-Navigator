/** SearXNG 实例 3 代理：/api/searx3/* → https://search.ononoki.org/* */
import { createSearxngProxy, searxngOnRequestOptions } from '../../_lib/searxng-proxy.js'

export const onRequest = createSearxngProxy('https://search.ononoki.org')
export const onRequestOptions = searxngOnRequestOptions
