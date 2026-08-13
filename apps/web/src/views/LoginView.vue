<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { KeyRound, RefreshCw, ShieldCheck, UserRound } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const form = reactive({ username: '', password: '', captcha: '' })
const error = ref('')
const loading = ref(false)

async function refreshCaptcha() { try { await auth.refreshCaptcha() } catch { error.value = '验证码服务暂时不可用' } }
async function submit() {
  error.value = ''; loading.value = true
  try { await auth.login(form); await router.push('/') }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '登录失败'; form.captcha = ''; await refreshCaptcha() }
  finally { loading.value = false }
}
onMounted(refreshCaptcha)
</script>

<template>
  <main class="login-view">
    <section class="login-context">
      <div class="brand-mark"><span>LA</span><i /></div>
      <p class="eyebrow">LOW-ALTITUDE OPERATIONS</p>
      <h1>无人机低空<br>指挥调度平台</h1>
      <p class="login-lead">城市级无人机运行态势、任务协同与安全监测入口</p>
      <div class="context-readout"><span>运行域</span><strong>上海市低空试验区</strong><span>安全等级</span><strong>受控访问</strong></div>
    </section>
    <section class="login-form-wrap">
      <form class="login-form" @submit.prevent="submit">
        <header><ShieldCheck /><div><span>身份认证</span><h2>登录运行控制台</h2></div></header>
        <label><span>用户名</span><div class="input-shell"><UserRound /><input v-model.trim="form.username" autocomplete="username" required placeholder="请输入用户名"></div></label>
        <label><span>密码</span><div class="input-shell"><KeyRound /><input v-model="form.password" type="password" autocomplete="current-password" required placeholder="请输入密码"></div></label>
        <label><span>验证码</span><div class="captcha-row"><div class="input-shell"><input v-model.trim="form.captcha" maxlength="4" inputmode="numeric" required placeholder="4位验证码" aria-label="验证码"></div><button class="captcha" type="button" title="刷新验证码" aria-label="刷新验证码" @click="refreshCaptcha"><b aria-hidden="true">{{ auth.captcha?.challenge || '----' }}</b><RefreshCw /></button></div></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="login-submit" type="submit" :disabled="loading">{{ loading ? '正在验证…' : '进入平台' }}</button>
        <footer><span class="status-dot online" />认证链路可用 <em>·</em> 登录行为全程审计</footer>
      </form>
    </section>
  </main>
</template>
