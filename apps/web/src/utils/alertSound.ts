const STORAGE_KEY = 'alert_sound'

export function isSoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setSoundEnabled(enabled: boolean): void {
  if (enabled) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, 'off')
}

/**
 * 用 Web Audio API 合成短促双音蜂鸣（无需音频资源文件）。
 * 浏览器自动播放策略要求先有用户交互，失败时静默降级。
 */
let audioCtx: AudioContext | undefined

export function playAlertSound(): void {
  if (!isSoundEnabled()) return
  try {
    audioCtx ||= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    ;[880, 660].forEach((frequency, index) => {
      const oscillator = audioCtx!.createOscillator()
      const gain = audioCtx!.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const startAt = audioCtx!.currentTime + index * 0.18
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.1, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16)
      oscillator.connect(gain).connect(audioCtx!.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.2)
    })
  } catch {
    /* 音频不可用时静默降级，不打断告警流程 */
  }
}
