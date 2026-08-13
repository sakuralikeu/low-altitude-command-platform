import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OperationsMap from './OperationsMap.vue'

vi.mock('@amap/amap-jsapi-loader', () => ({
  default: { load: vi.fn(() => Promise.reject(new Error('amap disabled in unit tests'))) },
}))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('OperationsMap', () => {
  it('renders demo basemap without AMap key and keeps aircraft markers clickable', async () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    const wrapper = mount(OperationsMap, {
      props: {
        aircraft: [{ id: 'UAV-01', name: '海巡-01', task: '重点道路巡检', status: 'flying', model: 'M350 RTK', longitude: 121.47, latitude: 31.23, altitudeM: 120, speedMps: 8, headingDeg: 45, batteryPercent: 82 }],
        connected: true,
        selectedId: '',
        zones: [],
      },
    })
    expect(wrapper.text()).toContain('演示底图 · 待配置高德 Key')
    expect(wrapper.find('.aircraft-marker').exists()).toBe(true)
    await wrapper.get('.aircraft-marker').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
  })

  it('clears the selected aircraft from the popover close button', async () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    const wrapper = mount(OperationsMap, {
      props: {
        aircraft: [{ id: 'UAV-01', name: '海巡-01', task: '重点道路巡检', status: 'flying', model: 'M350 RTK', longitude: 121.47, latitude: 31.23, altitudeM: 120, speedMps: 8, headingDeg: 45, batteryPercent: 82 }],
        connected: true,
        selectedId: 'UAV-01',
        zones: [],
      },
    })
    expect(wrapper.find('.aircraft-popover').exists()).toBe(true)
    await wrapper.get('[aria-label="关闭飞机详情"]').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('renders basemap mode buttons with aria labels', () => {
    vi.stubEnv('VITE_AMAP_KEY', '')
    const wrapper = mount(OperationsMap, {
      props: { aircraft: [], connected: false, selectedId: '', zones: [] },
    })
    expect(wrapper.get('[title="卫星图"]').attributes('aria-label')).toBe('切换卫星图')
    expect(wrapper.get('[title="暗色地图"]').attributes('aria-label')).toBe('切换暗色地图')
  })
})
