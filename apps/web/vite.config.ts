/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // 与 docker compose 共用项目根目录 .env（VITE_AMAP_KEY / VITE_WEATHER_LABEL 等）
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
          charts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
          icons: ['lucide-vue-next'],
        },
      },
    },
  },
})
