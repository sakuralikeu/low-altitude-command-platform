<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; loading?: boolean; error?: string; empty?: string; stale?: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="panel-shell">
    <header class="panel-header">
      <div><span v-if="eyebrow" class="panel-eyebrow">{{ eyebrow }}</span><h2>{{ title }}</h2></div>
      <div class="panel-header-actions">
        <button v-if="stale" class="stale-badge" type="button" title="刷新数据" @click="$emit('retry')">数据陈旧 · 重试</button>
        <slot name="actions" />
      </div>
    </header>
    <div v-if="loading" class="panel-state panel-skeleton" role="status" aria-live="polite">
      <span class="skeleton-line" style="width: 82%" />
      <span class="skeleton-line" style="width: 96%" />
      <span class="skeleton-line" style="width: 88%" />
      <span class="skeleton-line" style="width: 62%" />
    </div>
    <button v-else-if="error && !stale" class="panel-state error-state" type="button" @click="$emit('retry')">{{ error }} · 重试</button>
    <div v-else-if="empty" class="panel-state" role="status">{{ empty }}</div>
    <div v-else class="panel-content"><slot /></div>
  </section>
</template>
