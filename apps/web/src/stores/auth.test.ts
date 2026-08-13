import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'

vi.mock('@/services/api', () => ({
  api: vi.fn(),
}))

import { api } from '@/services/api'

const mockedApi = vi.mocked(api)

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    mockedApi.mockReset()
  })

  it('refreshes captcha challenge', async () => {
    mockedApi.mockResolvedValue({ data: { id: 'cap-1', challenge: '4826', expiresInSeconds: 120 } })
    const store = useAuthStore()
    await store.refreshCaptcha()
    expect(store.captcha).toMatchObject({ id: 'cap-1', challenge: '4826' })
    expect(mockedApi).toHaveBeenCalledWith('/v1/auth/captcha')
  })

  it('login stores token and user name', async () => {
    mockedApi.mockResolvedValue({ data: { accessToken: 'jwt-token', user: { name: '指挥中心管理员', orgName: '市级指挥中心' } } })
    const store = useAuthStore()
    store.captcha = { id: 'cap-1', challenge: '4826', expiresInSeconds: 120 }
    await store.login({ username: 'admin', password: 'x', captcha: '4826' })
    expect(sessionStorage.getItem('access_token')).toBe('jwt-token')
    expect(store.userName).toBe('指挥中心管理员')
    expect(mockedApi).toHaveBeenCalledWith('/v1/auth/login', expect.objectContaining({ method: 'POST' }))
  })

  it('login rejects without captcha', async () => {
    const store = useAuthStore()
    await expect(store.login({ username: 'admin', password: 'x', captcha: '0000' })).rejects.toThrow('请刷新验证码')
  })

  it('logout clears session', async () => {
    sessionStorage.setItem('access_token', 't')
    sessionStorage.setItem('user_name', 'u')
    const store = useAuthStore()
    store.logout()
    expect(sessionStorage.getItem('access_token')).toBeNull()
    expect(store.userName).toBe('')
  })
})
