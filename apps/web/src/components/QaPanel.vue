<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Bot, CornerDownLeft, Send, Sparkles, UserRound } from 'lucide-vue-next'
import { api } from '@/services/api'
import type { QaAnswer } from '@/types'

type QaMessage = { role: 'user' | 'bot'; text: string; answer?: QaAnswer }

const SUGGESTIONS = [
  '本月飞行了多少架次？',
  '哪个单位任务最多？',
  '现在有几架无人机在执行任务？',
  '有哪些飞机电量低？',
  '当前有多少张工单？',
  '水务局和公安局谁飞得多？',
]

const messages = ref<QaMessage[]>([{
  role: 'bot',
  text: '你好，我是数据问答助手（规则引擎 · 演示数据）。所有数字来自系统真实聚合，不生成虚构答案。试试下面的快捷问题，或直接输入。',
}])
const question = ref('')
const asking = ref(false)
const listRef = ref<HTMLElement>()

async function send(text?: string) {
  const content = (text ?? question.value).trim()
  if (!content || asking.value) return
  messages.value = [...messages.value, { role: 'user', text: content }]
  question.value = ''
  asking.value = true
  try {
    const response = await api<{ data: QaAnswer }>('/v1/qa/ask', { method: 'POST', body: JSON.stringify({ question: content }) })
    messages.value = [...messages.value, { role: 'bot', text: response.data.reply, answer: response.data }]
  } catch (reason) {
    messages.value = [...messages.value, { role: 'bot', text: `查询失败：${reason instanceof Error ? reason.message : '请稍后重试'}` }]
  } finally {
    asking.value = false
    requestAnimationFrame(() => listRef.value?.scrollTo({ top: listRef.value.scrollHeight }))
  }
}

function askSuggestion(text: string) {
  void send(text)
}

onBeforeUnmount(() => { /* 消息列表会话内保留 */ })
</script>

<template>
  <div class="qa-panel">
    <header class="qa-head">
      <span class="demo-badge">规则引擎 + DeepSeek 增强 · 演示数据</span>
      <small>指标口径与排行榜/大屏一致 · 不生成虚构答案</small>
    </header>

    <div ref="listRef" class="qa-messages" role="log" aria-live="polite" aria-label="问答记录">
      <div v-for="(msg, index) in messages" :key="index" class="qa-msg" :class="msg.role">
        <span class="qa-avatar"><UserRound v-if="msg.role === 'user'" /><Bot v-else /></span>
        <div class="qa-bubble">
          <p>{{ msg.text }}</p>
          <ul v-if="msg.answer?.rows?.length" class="qa-rows">
            <li v-for="(row, rowIndex) in msg.answer!.rows" :key="rowIndex">
              <span>{{ row.label }}</span>
              <i><em :style="{ width: `${Math.max(2, Math.min(100, row.percent ?? 0))}%` }" /></i>
              <strong>{{ row.value }}</strong>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="asking" class="qa-msg bot">
        <span class="qa-avatar"><Bot /></span>
        <div class="qa-bubble"><span class="spinner" />查询中…</div>
      </div>
    </div>

    <div class="qa-suggestions" aria-label="快捷问题">
      <button v-for="suggestion in SUGGESTIONS" :key="suggestion" type="button" :disabled="asking" :aria-label="`问：${suggestion}`" @click="askSuggestion(suggestion)"><Sparkles />{{ suggestion }}</button>
    </div>

    <form class="qa-input" @submit.prevent="send()">
      <input v-model="question" type="text" maxlength="120" placeholder="问点什么，如：本月飞行了多少架次？" aria-label="输入问题" />
      <button type="submit" :disabled="!question.trim() || asking" aria-label="发送问题"><Send />发送</button>
    </form>
    <p class="qa-hint"><CornerDownLeft /> Enter 发送 · 支持：架次/里程/排行/飞机/低电量/告警/工单/方舱/单位对比</p>
  </div>
</template>
