import { onScopeDispose, ref, watch } from 'vue'

/**
 * 数字补间动画：目标值变化时从当前显示值平滑过渡，避免大屏数字生硬跳变。
 * 尊重 prefers-reduced-motion，减少动态时直接跳到目标值。
 */
export function useCountUp(source: () => number, duration = 500) {
  const display = ref(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let raf = 0
  let from = 0
  let startTime = 0

  function tick(now: number) {
    const progress = Math.min(1, (now - startTime) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    display.value = Math.round(from + (source() - from) * eased)
    if (progress < 1) raf = requestAnimationFrame(tick)
  }

  function animate() {
    cancelAnimationFrame(raf)
    if (reduced || typeof source() !== 'number' || Number.isNaN(source())) {
      display.value = source()
      return
    }
    from = display.value
    startTime = performance.now()
    raf = requestAnimationFrame(tick)
  }

  watch(source, animate, { immediate: true })
  onScopeDispose(() => cancelAnimationFrame(raf))
  return display
}
