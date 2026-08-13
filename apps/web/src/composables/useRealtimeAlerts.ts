import { computed, ref, watch, type Ref } from 'vue'
import { playAlertSound } from '@/utils/alertSound'
import type { Aircraft, RealtimeAlertEvent } from '@/types'

export type ToastKind = 'aircraft' | 'nofly' | 'conflict' | 'low-battery' | 'info' | 'success'
export type AlertToast = { key: string; title: string; detail: string; kind: ToastKind; aircraftId?: string }

export function eventLabel(event: RealtimeAlertEvent): { title: string; detail: string } {
  if (event.type === 'nofly') return { title: `禁飞区违规 · ${event.zoneName}`, detail: `${event.aircraft.name} 进入${event.zoneName}` }
  if (event.type === 'conflict') return { title: `空域冲突预警 · ${event.severity === 'critical' ? '严重' : '注意'}`, detail: `${event.a.name} 与 ${event.b.name} 水平距离 ${event.horizontalM}m / 高度差 ${event.verticalM}m` }
  return { title: `低电量预警 · ${event.aircraft.name}`, detail: `电量 ${event.aircraft.batteryPercent}% · 预计续航 ${event.remainingMinutes}min` }
}

export function alertEventKey(event: RealtimeAlertEvent) {
  if (event.type === 'conflict') return `conflict-${event.a.id}-${event.b.id}`
  if (event.type === 'nofly') return `nofly-${event.aircraft.id}-${event.zoneId}`
  return `low-battery-${event.aircraft.id}`
}

const CONVERTED_KEY = 'converted_alerts_v1'

function loadConverted(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(CONVERTED_KEY) || '[]') as unknown
    return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function persistConverted(values: Set<string>) {
  try { localStorage.setItem(CONVERTED_KEY, JSON.stringify([...values])) } catch { /* 隐私模式等场景忽略 */ }
}

export function useRealtimeAlerts(aircraft: Ref<Aircraft[]>, options: { notifyAircraftChanges?: boolean } = {}) {
  const notifyAircraftChanges = options.notifyAircraftChanges !== false
  const toasts = ref<AlertToast[]>([])
  const alertEvents = ref<RealtimeAlertEvent[]>([])
  const dismissedAlerts = ref(new Set<string>())
  const convertedAlerts = ref(loadConverted())
  const hasLoadedOnce = ref(false)
  let previousWarningIds = new Set<string>()

  const warningAircraft = computed(() => aircraft.value.filter((item) => item.status === 'warning'))
  const visibleWarningAircraft = computed(() => warningAircraft.value.filter((item) => !dismissedAlerts.value.has(item.id)))

  function pushToast(item: AlertToast, ttl = 8000) {
    if (toasts.value.some((toast) => toast.key === item.key)) return
    toasts.value = [...toasts.value, item]
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((toast) => toast.key !== item.key)
    }, ttl)
  }

  function dismissToast(key: string) {
    toasts.value = toasts.value.filter((toast) => toast.key !== key)
  }

  function handleComplianceEvent(event: RealtimeAlertEvent) {
    const key = alertEventKey(event)
    alertEvents.value = [event, ...alertEvents.value.filter((item) => alertEventKey(item) !== key)].slice(0, 12)
    if (!hasLoadedOnce.value) return
    const { title, detail } = eventLabel(event)
    const aircraftId = event.type === 'conflict' ? event.a.id : event.aircraft.id
    pushToast({ key, title, detail, kind: event.type, aircraftId })
    playAlertSound()
  }

  function detectNewAlerts() {
    const warningIds = new Set(warningAircraft.value.map((item) => item.id))
    const fresh = hasLoadedOnce.value
      ? [...warningIds].filter((id) => !previousWarningIds.has(id) && !dismissedAlerts.value.has(id))
      : []
    previousWarningIds = warningIds
    hasLoadedOnce.value = true
    if (!notifyAircraftChanges || fresh.length === 0) return
    for (const item of warningAircraft.value.filter((entry) => fresh.includes(entry.id))) {
      pushToast({ key: `aircraft-${item.id}`, title: `运行告警 · ${item.name}`, detail: `${item.task} · 电量 ${item.batteryPercent}%`, kind: 'aircraft', aircraftId: item.id })
    }
    playAlertSound()
  }

  function dismissAlert(id: string) {
    dismissedAlerts.value = new Set([...dismissedAlerts.value, id])
    toasts.value = toasts.value.filter((toast) => toast.aircraftId !== id)
  }

  function dismissEvent(index: number) {
    alertEvents.value = alertEvents.value.filter((_, eventIndex) => eventIndex !== index)
  }

  function markConverted(key: string) {
    const next = new Set([...convertedAlerts.value, key])
    convertedAlerts.value = next
    persistConverted(next)
  }

  watch(aircraft, detectNewAlerts, { deep: true })

  return {
    toasts,
    alertEvents,
    dismissedAlerts,
    convertedAlerts,
    visibleWarningAircraft,
    warningAircraft,
    pushToast,
    dismissToast,
    handleComplianceEvent,
    dismissAlert,
    dismissEvent,
    markConverted,
  }
}
