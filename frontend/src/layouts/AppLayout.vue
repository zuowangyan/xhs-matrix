<template>
  <el-container class="layout">
    <el-aside width="210px" class="aside">
      <div class="logo">
        <img :src="logoUrl" class="logo-img" alt="logo" /> 小红书矩阵
      </div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item v-for="r in menuRoutes" :key="r.name" :index="'/' + r.path">
          <el-icon><component :is="r.meta.icon" /></el-icon>
          <span>{{ r.meta.title }}</span>
        </el-menu-item>
      </el-menu>
      <div class="status">
        <el-tag :type="health.ok ? 'success' : 'danger'" size="small" effect="dark">
          {{ health.ok ? '后端已连接' : '后端未连接' }}
        </el-tag>
        <div class="status-detail" v-if="health.ok">DB: {{ health.db }}</div>
      </div>
    </el-aside>

    <el-container>
      <el-header class="header">
        <span class="title">{{ currentTitle }}</span>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onMounted, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiService } from '@/services/ApiService'
import logoUrl from '@/assets/logo.svg'

const route = useRoute()
const router = useRouter()

const menuRoutes = computed(() =>
  router.options.routes[0].children.filter((r) => r.meta?.title),
)
const activeMenu = computed(() => route.path)
const currentTitle = computed(() => route.meta?.title || '')

const health = reactive({ ok: false, db: '' })

onMounted(async () => {
  try {
    const r = await apiService.health()
    health.ok = r.status === 'ok'
    health.db = r.db
  } catch (e) {
    health.ok = false
  }
})
</script>

<style scoped>
.layout { height: 100vh; }
.aside {
  background: #1f1f28;
  color: #ddd;
  display: flex;
  flex-direction: column;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  font-size: 17px;
  font-weight: 600;
  color: #fff;
}
.logo-img {
  width: 26px; height: 26px; border-radius: 7px;
}
.menu { flex: 1; border-right: none; background: transparent; }
.menu :deep(.el-menu-item) { color: #bbb; }
.menu :deep(.el-menu-item.is-active) { color: #fff; background: #ff2442; }
.status { padding: 14px 18px; }
.status-detail { color: #888; font-size: 12px; margin-top: 6px; }
.header {
  display: flex; align-items: center;
  border-bottom: 1px solid #eee;
  font-size: 16px; font-weight: 600;
}
.main { background: #f5f6f8; }
</style>
