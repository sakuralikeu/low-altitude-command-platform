import { createRouter, createWebHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import DashboardView from './views/DashboardView.vue'
import OpsWorkbench from './views/OpsWorkbench.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'dashboard', component: DashboardView, meta: { requiresAuth: true, roles: ['dashboard.viewer'] } },
    { path: '/workspace', name: 'workspace', component: OpsWorkbench, meta: { requiresAuth: true, roles: ['operator', 'admin'] } },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !sessionStorage.getItem('access_token')) return { name: 'login' }
  if (to.name === 'login' && sessionStorage.getItem('access_token')) return { name: 'dashboard' }
  const requiredRoles = (to.meta.roles as string[] | undefined) ?? []
  if (requiredRoles.length) {
    const roles = JSON.parse(sessionStorage.getItem('user_roles') || '[]') as string[]
    if (!requiredRoles.some((role) => roles.includes(role))) {
      if (to.name === 'workspace') sessionStorage.setItem('route_notice', '当前账号仅可查看态势，作业工作台需要调度权限')
      return { name: 'dashboard' }
    }
  }
})

export default router
