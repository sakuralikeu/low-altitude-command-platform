import { onBeforeUnmount, ref } from 'vue'
import type { Aircraft, RealtimeAlertEvent } from '@/types'

const RECONNECT_MAX_MS = 30_000

type StreamHandlers = {
  onAircraft: (rows: Aircraft[]) => void
  onCompliance?: (event: RealtimeAlertEvent) => void
}

/** SSE 遥测流：指数退避重连，401/离线时停，供大屏与作业台共用 */
export function useAircraftStream() {
  const connected = ref(false)
  let stream: EventSource | undefined
  let reconnectTimer: number | undefined
  let reconnectAttempts = 0
  let unmounted = false
  let handlers: StreamHandlers | undefined

  function connect(next?: StreamHandlers) {
    if (next) handlers = next
    window.clearTimeout(reconnectTimer)
    stream?.close()
    const token = sessionStorage.getItem('access_token')
    if (!token || unmounted || !navigator.onLine || !handlers) return
    stream = new EventSource(`/api/v1/realtime/aircraft?token=${encodeURIComponent(token)}`)
    stream.addEventListener('aircraft', (event) => {
      handlers?.onAircraft(JSON.parse((event as MessageEvent).data).rows)
      connected.value = true
    })
    stream.addEventListener('nofly', (event) => handlers?.onCompliance?.(JSON.parse((event as MessageEvent).data)))
    stream.addEventListener('conflict', (event) => handlers?.onCompliance?.(JSON.parse((event as MessageEvent).data)))
    stream.addEventListener('low-battery', (event) => handlers?.onCompliance?.(JSON.parse((event as MessageEvent).data)))
    stream.onopen = () => { connected.value = true; reconnectAttempts = 0 }
    stream.onerror = () => {
      connected.value = false
      stream?.close()
      if (unmounted || !navigator.onLine) return
      const baseDelay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** reconnectAttempts)
      reconnectAttempts += 1
      reconnectTimer = window.setTimeout(() => connect(), baseDelay + Math.random() * 500)
    }
  }

  function disconnect() {
    unmounted = true
    connected.value = false
    stream?.close()
    window.clearTimeout(reconnectTimer)
  }

  function recover() {
    if (document.visibilityState === 'hidden' || unmounted) return
    if (!connected.value) connect()
  }

  onBeforeUnmount(disconnect)
  return { connected, connect, disconnect, recover }
}
