<template>
  <div class="collect">
    <!-- 顶部：项目选择 + 运行 -->
    <el-card shadow="never" class="bar">
      <div class="bar-left">
        <span class="label">运营项目</span>
        <el-select v-model="store.currentId" placeholder="选择项目" style="width:240px" @change="onCampaignChange">
          <el-option v-for="c in store.list" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <span class="label" style="margin-left:8px">采集逻辑</span>
        <el-select v-model="sort" size="small" style="width:110px" @change="saveColCfg">
          <el-option label="综合" value="general" />
          <el-option label="最新" value="time_descending" />
          <el-option label="最热(点赞)" value="popularity_descending" />
        </el-select>
        <el-checkbox v-model="hotExpand" size="small" @change="saveColCfg">AI热点扩展</el-checkbox>
      </div>
      <div style="display:flex;gap:8px">
        <el-popconfirm title="清空该项目采集/分析/草稿数据？" @confirm="clearData">
          <template #reference><el-button :disabled="!store.currentId">清空数据</el-button></template>
        </el-popconfirm>
        <el-button type="danger" :icon="VideoPlay" :loading="running" :disabled="!store.currentId" @click="run">
          运行采集
        </el-button>
      </div>
    </el-card>

    <el-row v-if="cur" :gutter="0" style="margin:6px 2px">
      <el-tag size="small" effect="plain" v-for="kw in (cur.keywords||[])" :key="kw" class="kw">{{ kw }}</el-tag>
      <span class="muted" v-if="!(cur.keywords||[]).length">该项目暂无关键词</span>
    </el-row>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="采集会用「采集号」登录主站抓真实笔记+评论。若采集号未登录主站，会自动用示例数据兜底（去「账号矩阵」对采集号扫码登录主站即可真实采集）。"
      style="margin:12px 0"
    />

    <el-empty v-if="!store.currentId" description="请先在总控台建项目，或在上方选择一个项目" />

    <template v-else>
      <!-- 采集任务历史 -->
      <el-card shadow="never" class="block">
        <div class="block-title">采集任务</div>
        <el-table :data="tasks" size="small" empty-text="还没有采集任务，点右上「运行采集」">
          <el-table-column prop="query" label="目标(关键词/竞品)" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status==='done'?'success':row.status==='failed'?'danger':'warning'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="result" label="结果" width="180" show-overflow-tooltip />
          <el-table-column prop="createdAt" label="时间" width="170">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 采集到的笔记 -->
      <el-card shadow="never" class="block">
        <div class="block-title">采集笔记 <span class="muted">（{{ notes.length }} 篇，按点赞排序）</span></div>
        <el-table :data="notes" size="small" empty-text="暂无数据" @row-click="openComments">
          <el-table-column type="index" width="46" />
          <el-table-column prop="title" label="标题" min-width="260" show-overflow-tooltip />
          <el-table-column prop="authorName" label="作者" width="100" />
          <el-table-column prop="likes" label="点赞" width="80" sortable />
          <el-table-column prop="collects" label="收藏" width="80" sortable />
          <el-table-column prop="comments" label="评论" width="80" sortable />
          <el-table-column prop="source" label="来源词" width="110" />
        </el-table>
      </el-card>
    </template>

    <!-- 评论抽屉 -->
    <el-drawer v-model="drawer" :title="`评论 · ${activeNote?.title || ''}`" size="40%">
      <el-table :data="comments" size="small" empty-text="无评论">
        <el-table-column prop="content" label="评论内容" show-overflow-tooltip />
        <el-table-column prop="likes" label="赞" width="70" sortable />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { VideoPlay } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const running = ref(false)
const tasks = ref([])
const notes = ref([])
const comments = ref([])
const drawer = ref(false)
const activeNote = ref(null)
const sort = ref('general')
const hotExpand = ref(false)

const cur = computed(() => store.current())

function fmt(s) { return s ? new Date(s).toLocaleString('zh-CN') : '' }

function loadColCfg() {
  const c = store.current()
  sort.value = (c && c.cadence && c.cadence.collectSort) || 'general'
  hotExpand.value = !!(c && c.cadence && c.cadence.hotExpand)
}
async function saveColCfg() {
  const c = store.current()
  const cadence = { ...((c && c.cadence) || {}), collectSort: sort.value, hotExpand: hotExpand.value }
  await apiService.campaigns.update(store.currentId, { cadence })
  await store.refresh()
}

async function loadData() {
  if (!store.currentId) { tasks.value = []; notes.value = []; return }
  loadColCfg()
  ;[tasks.value, notes.value] = await Promise.all([
    apiService.collect.tasks(store.currentId),
    apiService.collect.notes(store.currentId),
  ])
}
function onCampaignChange() { loadData() }

async function clearData() {
  await apiService.collect.clear(store.currentId)
  ElMessage.success('已清空')
  await loadData()
}
async function run() {
  running.value = true
  try {
    const r = await apiService.collect.run(store.currentId)
    ElMessage.success(`采集完成：${r.noteCount} 篇笔记 / ${r.commentCount} 条评论`)
    await loadData()
  } catch (e) {
    ElMessage.error('采集失败：' + (e?.message || ''))
  } finally {
    running.value = false
  }
}

async function openComments(row) {
  activeNote.value = row
  comments.value = await apiService.collect.comments(row.id)
  drawer.value = true
}

watch(() => store.currentId, loadData)
onMounted(async () => {
  if (!store.list.length) await store.refresh()
  await loadData()
})
</script>

<style scoped>
.collect { max-width: 1080px; }
.bar :deep(.el-card__body) { display: flex; justify-content: space-between; align-items: center; }
.bar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.label { color: #666; font-size: 14px; }
.kw { margin-left: 2px; }
.muted { color: #bbb; font-size: 13px; }
.block { margin-bottom: 14px; }
.block-title { font-weight: 600; margin-bottom: 12px; }
:deep(.el-table__row) { cursor: pointer; }
</style>
