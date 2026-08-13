import { onBeforeUnmount, ref } from 'vue'

const DEFAULT_INTERVAL_MS = 30_000

/** 30s 静默轮询：失败保留 last-good，供大屏/作业台共用 */
export function usePolledResource(load: (silent: boolean) => Promise<void>, intervalMs = DEFAULT_INTERVAL_MS) {
  const syncing = ref(false)
  let timer: number | undefined
  let unmounted = false

  async function refresh(silent = true) {
    if (unmounted) return
    if (silent) syncing.value = true
    try {
      await load(silent)
    } finally {
      syncing.value = false
    }
  }

  function start() {
    window.clearInterval(timer)
    timer = window.setInterval(() => { void refresh(true) }, intervalMs)
  }

  function stop() {
    unmounted = true
    window.clearInterval(timer)
  }

  onBeforeUnmount(stop)
  return { syncing, refresh, start, stop }
}
