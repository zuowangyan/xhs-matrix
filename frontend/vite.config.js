import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// 注意：始终用相对路径 base:'./'，确保 Electron 与 Web 部署都能正常加载
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5273,
    // 开发模式下把 /api 代理到后端，前端用相对路径不需要写死后端地址
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4180',
        changeOrigin: true,
      },
    },
  },
})
