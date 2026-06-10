<template>
  <div class="runlogs">
    <el-card shadow="never" class="bar">
      <div class="bar-left">
        <span class="label">运营项目</span>
        <el-select v-model="store.currentId" placeholder="选择项目" style="width:260px" @change="load">
          <el-option v-for="c in store.list" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-switch v-model="autoRefresh" active-text="自动刷新" @change="toggleAuto" />
      </div>
    </el-card>

    <el-alert type="info" :closable="false" show-icon style="margin:12px 0"
      title="这里随时查看每个项目的运行流水（采集/分析/生成/发布/完成）。立即跑或定时跑的过程都会记录在这。" />

    <el-empty v-if="!store.currentId" description="请先选择项目" />
    <template v-else>
      <el-card shadow="never">
        <div class="block-title">运行记录 <span class="muted">（最近 {{ logs.length }} 条）</span></div>
        <el-empty v-if="!logs.length" description="还没有运行记录，去总控台点「立即跑」试试" :image-size="60" />
        <el-timeline v-else>
          <el-timeline-item v-for="l in logs" :key="l.id" :timestamp="fmt(l.createdAt)"
            :type="l.status==='ok'?'success':l.status==='error'?'danger':l.status==='skip'?'info':'primary'">
            <b>{{ stageText(l.stage) }}</b>
            <el-tag size="small" :type="l.status==='ok'?'success':l.status==='error'?'danger':'info'" style="margin-left:6px">{{ l.status }}</el-tag>
            <div class="detail" v-if="l.detail">{{ l.detail }}</div>
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const logs = ref([])
const loading = ref(false)
const autoRefresh = ref(false)
let timer = null

function fmt(s) { return s ? new Date(s).toLocaleString('zh-CN') : '' }
function stageText(s) {
  return { collect: '采集', synthesize: '知识沉淀', analysis: '分析', generate: '生成', publish: '发布', done: '完成', error: '错误' }[s] || s
}

async function load() {
  if (!store.currentId) { logs.value = []; return }
  loading.value = true
  try { logs.value = await apiService.autopilot.logs(store.currentId) }
  catch (e) { /* ignore */ } finally { loading.value = false }
}
function toggleAuto(v) {
  if (v) { timer = setInterval(load, 4000) } else if (timer) { clearInterval(timer); timer = null }
}

watch(() => store.currentId, load)
onMounted(async () => { if (!store.list.length) await store.refresh(); await load() })
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<style scoped>
.runlogs { max-width: 1080px; }
.bar :deep(.el-card__body) { display: flex; align-items: center; }
.bar-left { display: flex; align-items: center; gap: 10px; }
.label { color: #666; }
.muted { color: #aaa; font-weight: normal; font-size: 13px; }
.block-title { font-weight: 600; margin-bottom: 14px; }
.detail { color: #888; font-size: 12px; margin-top: 4px; word-break: break-all; }
</style>
