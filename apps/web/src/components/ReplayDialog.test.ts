import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReplayDialog from './ReplayDialog.vue'
import type { FlightReplay } from '@/types'

const replay: FlightReplay = {
  mode: 'replay',
  recordId: '1010',
  aircraftName: '1号方舱无人机',
  routeName: '山区巡检航线',
  startedAt: '2026-08-12 15:40:00',
  durationSeconds: 12,
  demo: true,
  planned: [
    { longitude: 121.46, latitude: 31.22, altitudeM: 78, speedMps: 11, elapsedSeconds: 0 },
    { longitude: 121.47, latitude: 31.23, altitudeM: 78, speedMps: 11, elapsedSeconds: 12 },
  ],
  actual: [
    { longitude: 121.461, latitude: 31.221, altitudeM: 74, speedMps: 10, elapsedSeconds: 0 },
    { longitude: 121.471, latitude: 31.231, altitudeM: 76, speedMps: 12, elapsedSeconds: 12 },
  ],
}

const dialog = () => document.querySelector('.replay-dialog') as HTMLElement | null
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null

beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_AMAP_KEY', '') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); document.body.innerHTML = '' })

describe('ReplayDialog', () => {
  it('renders a detached dialog with track view, playback controls and close emission', async () => {
    const wrapper = mount(ReplayDialog, { props: { replay }, attachTo: document.body })
    expect(dialog()?.textContent).toContain('FLIGHT REPLAY · 轨迹回放')
    expect(dialog()?.textContent).toContain('山区巡检航线')
    expect(dialog()?.querySelector('.track-line.planned')).toBeTruthy()
    expect(dialog()?.querySelector('.track-line.actual')).toBeTruthy()
    expect(byLabel('回放速度')).toBeTruthy()
    byLabel('关闭回放小窗')?.click()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('plays back and advances the progress index on a timer tick', async () => {
    const wrapper = mount(ReplayDialog, { props: { replay }, attachTo: document.body })
    expect(dialog()?.textContent).toContain('0:00')
    byLabel('播放回放')?.click()
    await wrapper.vm.$nextTick()
    expect(byLabel('暂停回放')).toBeTruthy()
    await vi.advanceTimersByTimeAsync(600)
    expect(dialog()?.textContent).toContain('0:12')
    expect(dialog()?.textContent).toContain('100%')
    wrapper.unmount()
  })

  it('renders plan preview with playable planned track and preview note', async () => {
    const wrapper = mount(ReplayDialog, {
      props: { replay: { ...replay, mode: 'preview', aircraftId: 'UAV-01', actual: [] } },
      attachTo: document.body,
    })
    expect(dialog()?.textContent).toContain('ROUTE PREVIEW · 计划回放')
    expect(dialog()?.textContent).toContain('计划航迹 · 不代表实际飞行')
    expect(dialog()?.querySelector('.track-line.planned')).toBeTruthy()
    expect(dialog()?.querySelector('.track-line.actual')).toBeFalsy()
    expect(byLabel('播放回放')).toBeTruthy()
    wrapper.unmount()
  })
})
