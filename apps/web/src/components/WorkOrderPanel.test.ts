import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkOrderPanel from './WorkOrderPanel.vue'

const apiMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('@/services/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock, currentRoute: { value: { query: {} } } }),
}))

const order = {
  id: 'WO-001',
  title: '河道水质巡检',
  lineName: '河道巡检航线',
  orgName: '水务局',
  status: 'pending' as const,
  createdAt: '2026-08-12 08:00:00',
  dueAt: '2026-08-12 18:00:00',
}

describe('WorkOrderPanel', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation((path: string) => {
      if (path === '/v1/work-orders') return Promise.resolve({ data: { rows: [order], totals: { pending: 1, received: 0, executing: 0, completed: 0 } } })
      if (path === '/v1/events/ai-recognition') return Promise.resolve({ data: { rows: [] } })
      if (path === '/v1/work-orders/generate') return Promise.resolve({ data: { generated: 0, skipped: 3, message: '今日计划已齐全，3 条航线无需重复生成' } })
      return Promise.resolve({ data: {} })
    })
  })

  it('expands a work order to show operational details', async () => {
    const wrapper = mount(WorkOrderPanel)
    await flushPromises()
    await wrapper.get('.wo-summary').trigger('click')
    expect(wrapper.find('.wo-detail').text()).toContain('河道巡检航线')
    expect(wrapper.find('.wo-detail').text()).toContain('待调度分配')
    expect(wrapper.get('.wo-summary').attributes('aria-expanded')).toBe('true')
  })

  it('shows feedback when daily plans already exist', async () => {
    const wrapper = mount(WorkOrderPanel)
    await flushPromises()
    await wrapper.get('.workorder-toolbar button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.workorder-feedback').text()).toContain('今日计划已齐全')
  })

  it('emits route context when previewing an expanded work order', async () => {
    const wrapper = mount(WorkOrderPanel)
    await flushPromises()
    await wrapper.get('.wo-summary').trigger('click')
    await wrapper.get('.wo-route-preview').trigger('click')
    expect(wrapper.emitted('previewRoute')).toEqual([['河道巡检航线', undefined]])
  })
})
