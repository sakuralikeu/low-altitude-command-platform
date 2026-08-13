import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PanelShell from './PanelShell.vue'

describe('PanelShell', () => {
  it('renders title and eyebrow', () => {
    const wrapper = mount(PanelShell, { props: { title: '飞行总览', eyebrow: 'OVERVIEW' } })
    expect(wrapper.find('h2').text()).toBe('飞行总览')
    expect(wrapper.find('.panel-eyebrow').text()).toBe('OVERVIEW')
  })

  it('shows skeleton while loading and hides content', () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'T', loading: true },
      slots: { default: '<div class="payload">内容</div>' },
    })
    expect(wrapper.find('.panel-skeleton').exists()).toBe(true)
    expect(wrapper.find('.payload').exists()).toBe(false)
  })

  it('shows error state with retry emit', async () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'T', error: '数据载入失败' },
      slots: { default: '<div class="payload">内容</div>' },
    })
    const errorButton = wrapper.find('.error-state')
    expect(errorButton.text()).toContain('数据载入失败')
    await errorButton.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('shows empty state when empty text given', () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'T', empty: '暂无飞行记录' },
      slots: { default: '<div class="payload">内容</div>' },
    })
    expect(wrapper.text()).toContain('暂无飞行记录')
    expect(wrapper.find('.payload').exists()).toBe(false)
  })

  it('renders slot content and actions in normal state', () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'T' },
      slots: { default: '<div class="payload">内容</div>', actions: '<button>筛选</button>' },
    })
    expect(wrapper.find('.payload').text()).toBe('内容')
    expect(wrapper.find('.panel-header button').text()).toBe('筛选')
  })

  it('preserves last-good content and exposes retry when data is stale', async () => {
    const wrapper = mount(PanelShell, {
      props: { title: 'T', error: '服务暂时不可用', stale: true },
      slots: { default: '<div class="payload">上次成功数据</div>' },
    })
    expect(wrapper.find('.payload').text()).toBe('上次成功数据')
    expect(wrapper.find('.error-state').exists()).toBe(false)
    expect(wrapper.find('.stale-badge').text()).toContain('数据陈旧')
    await wrapper.find('.stale-badge').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
