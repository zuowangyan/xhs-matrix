import { createRouter, createWebHashHistory } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'

const routes = [
  {
    path: '/',
    component: AppLayout,
    redirect: '/autopilot',
    children: [
      { path: 'autopilot', name: 'autopilot', meta: { title: '总控台', icon: 'Cpu' }, component: () => import('@/views/AutopilotView.vue') },
      { path: 'collect', name: 'collect', meta: { title: '采集', icon: 'Search' }, component: () => import('@/views/CollectView.vue') },
      { path: 'analysis', name: 'analysis', meta: { title: '选题分析', icon: 'DataAnalysis' }, component: () => import('@/views/AnalysisView.vue') },
      { path: 'knowledge', name: 'knowledge', meta: { title: '人设/产品库', icon: 'Notebook' }, component: () => import('@/views/KnowledgeView.vue') },
      { path: 'materials', name: 'materials', meta: { title: '素材图库', icon: 'PictureFilled' }, component: () => import('@/views/MaterialView.vue') },
      { path: 'generate', name: 'generate', meta: { title: '内容生成', icon: 'MagicStick' }, component: () => import('@/views/GenerateView.vue') },
      { path: 'accounts', name: 'accounts', meta: { title: '账号矩阵', icon: 'User' }, component: () => import('@/views/AccountsView.vue') },
      { path: 'publish', name: 'publish', meta: { title: '发布日历', icon: 'Calendar' }, component: () => import('@/views/PublishView.vue') },
      { path: 'runlogs', name: 'runlogs', meta: { title: '运行记录', icon: 'Tickets' }, component: () => import('@/views/RunLogsView.vue') },
      { path: 'settings', name: 'settings', meta: { title: '设置', icon: 'Setting' }, component: () => import('@/views/SettingsView.vue') },
    ],
  },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
