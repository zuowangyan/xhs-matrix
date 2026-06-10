import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiService } from '@/services/ApiService'

// 全局共享：运营项目列表 + 当前选中项目（总控台/采集等面板共用）
export const useCampaignStore = defineStore('campaign', () => {
  const list = ref([])
  const currentId = ref(localStorage.getItem('currentCampaignId') || '')
  const loading = ref(false)

  async function refresh() {
    loading.value = true
    try {
      list.value = await apiService.campaigns.list()
      if (!currentId.value && list.value.length) setCurrent(list.value[0].id)
      if (currentId.value && !list.value.find((c) => c.id === currentId.value)) {
        setCurrent(list.value[0]?.id || '')
      }
    } finally {
      loading.value = false
    }
  }

  function setCurrent(id) {
    currentId.value = id
    if (id) localStorage.setItem('currentCampaignId', id)
    else localStorage.removeItem('currentCampaignId')
  }

  async function create(data) {
    const c = await apiService.campaigns.create(data)
    await refresh()
    setCurrent(c.id)
    return c
  }

  async function remove(id) {
    await apiService.campaigns.remove(id)
    await refresh()
  }

  function current() {
    return list.value.find((c) => c.id === currentId.value) || null
  }

  return { list, currentId, loading, refresh, setCurrent, create, remove, current }
})
