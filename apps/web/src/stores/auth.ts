import { defineStore } from 'pinia'
import { api } from '@/services/api'

type Captcha = { id: string; challenge: string; expiresInSeconds: number }

export const useAuthStore = defineStore('auth', {
  state: () => ({
    captcha: null as Captcha | null,
    userName: sessionStorage.getItem('user_name') || '',
    roles: JSON.parse(sessionStorage.getItem('user_roles') || '[]') as string[],
  }),
  actions: {
    hasRole(role: string) {
      return this.roles.includes(role)
    },
    async refreshCaptcha() {
      const response = await api<{ data: Captcha }>('/v1/auth/captcha')
      this.captcha = response.data
    },
    async login(payload: { username: string; password: string; captcha: string }) {
      if (!this.captcha) throw new Error('请刷新验证码')
      const response = await api<{ data: { accessToken: string; user: { name: string; orgName: string; roles?: string[] } } }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...payload, captchaId: this.captcha.id }),
      })
      sessionStorage.setItem('access_token', response.data.accessToken)
      sessionStorage.setItem('user_name', response.data.user.name)
      const roles = response.data.user.roles ?? ['dashboard.viewer']
      sessionStorage.setItem('user_roles', JSON.stringify(roles))
      this.userName = response.data.user.name
      this.roles = roles
    },
    logout() {
      sessionStorage.clear()
      this.userName = ''
      this.roles = []
    },
  },
})
