<template>
  <div class="analysis">
    <el-card shadow="never" class="bar">
      <div class="bar-left">
        <span class="label">运营项目</span>
        <el-select v-model="store.currentId" placeholder="选择项目" style="width:240px">
          <el-option v-for="c in store.list" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Upload" :disabled="!store.currentId" @click="importDialog=true">导入痛点</el-button>
        <el-button type="danger" :icon="DataAnalysis" :loading="running" :disabled="!store.currentId" @click="run">
          运行分析
        </el-button>
      </div>
    </el-card>

    <el-alert type="info" :closable="false" show-icon style="margin:12px 0"
      title="痛点来源：采集笔记标题词频 + AI推断 + 你导入的客户真实痛点。评论因风控不抓，靠这三者组合做选题。" />

    <!-- 导入痛点 -->
    <el-dialog v-model="importDialog" title="导入客户真实痛点" width="520px">
      <p class="muted" style="margin-top:0">把你了解到的客户真实痛点/常问问题粘进来，每行一条（或用分号隔开）。会变成痛点+选题，和采集/AI 的结合用。</p>
      <el-input v-model="importText" type="textarea" :rows="8" placeholder="例：&#10;喝了会不会上火&#10;经期能不能喝&#10;小孩能喝吗&#10;和阿胶比哪个好&#10;甜不甜、好不好喝" />
      <template #footer>
        <el-button @click="importDialog=false">取消</el-button>
        <el-button type="danger" :loading="importing" @click="doImport">导入</el-button>
      </template>
    </el-dialog>

    <el-empty v-if="!store.currentId" description="请先选择项目（或在总控台新建）" />

    <el-row v-else :gutter="16">
      <!-- 左：评论痛点 -->
      <el-col :span="10">
        <el-card shadow="never">
          <div class="block-title">用户痛点 <span class="muted">（{{ insights.length }}，来源：采集标题/AI推断/客户导入）</span></div>
          <el-empty v-if="!insights.length" description="点右上「运行分析」" :image-size="60" />
          <div v-else class="pains">
            <div v-for="p in insights" :key="p.id" class="pain" @click="showSamples(p)">
              <el-tag size="small" :type="srcTag(p).type" effect="plain" style="margin-right:6px;flex-shrink:0">{{ srcTag(p).label }}</el-tag>
              <span class="pain-word">{{ p.topic }}</span>
              <el-progress :percentage="pct(p.frequency)" :stroke-width="10" :show-text="false" color="#ff2442" style="flex:1;margin:0 10px" />
              <span class="pain-n">{{ p.frequency || '—' }}</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 右：选题候选 -->
      <el-col :span="14">
        <el-card shadow="never">
          <div class="block-title">选题候选 <span class="muted">（点「采纳」进入生成池）</span></div>
          <el-empty v-if="!topics.length" description="运行分析后生成" :image-size="60" />
          <div v-else>
            <div v-for="t in topics" :key="t.id" :class="['topic', t.status]">
              <div class="topic-main">
                <div class="topic-title">
                  {{ t.title }}
                  <el-tag v-if="t.status==='adopted'" type="success" size="small">已采纳</el-tag>
                  <el-tag v-else-if="t.status==='discarded'" type="info" size="small">已弃用</el-tag>
                </div>
                <div class="topic-meta">{{ t.angle }} ｜ {{ t.rationale }}</div>
              </div>
              <div class="topic-ops">
                <el-button size="small" type="success" plain :disabled="t.status==='adopted'" @click="setStatus(t,'adopted')">采纳</el-button>
                <el-button size="small" text :disabled="t.status==='discarded'" @click="setStatus(t,'discarded')">弃用</el-button>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-drawer v-model="drawer" :title="`包含「${activePain?.topic||''}」的评论`" size="36%">
      <el-table :data="samples" size="small" empty-text="无样例">
        <el-table-column prop="content" label="评论" show-overflow-tooltip />
        <el-table-column prop="likes" label="赞" width="64" />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { DataAnalysis, Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const running = ref(false)
const insights = ref([])
const topics = ref([])
const drawer = ref(false)
const activePain = ref(null)
const samples = ref([])
const importDialog = ref(false)
const importText = ref('')
const importing = ref(false)

async function doImport() {
  if (!importText.value.trim()) return ElMessage.warning('请粘贴痛点')
  importing.value = true
  try {
    const r = await apiService.analysis.importPains(store.currentId, importText.value)
    ElMessage.success(`已导入 ${r.imported} 条痛点`)
    importDialog.value = false; importText.value = ''
    await loadData()
  } catch (e) { ElMessage.error('导入失败：' + (e?.message || '')) } finally { importing.value = false }
}

const maxFreq = computed(() => Math.max(1, ...insights.value.map((i) => i.frequency)))
function pct(n) { return Math.round((n / maxFreq.value) * 100) }
function srcTag(p) {
  if (p.source === '客户导入') return { label: '客户', type: 'danger' }
  if (p.source === 'AI推断') return { label: 'AI', type: 'warning' }
  return { label: '采集', type: 'info' }
}

async function loadData() {
  if (!store.currentId) { insights.value = []; topics.value = []; return }
  ;[insights.value, topics.value] = await Promise.all([
    apiService.analysis.insights(store.currentId),
    apiService.analysis.topics(store.currentId),
  ])
}
async function run() {
  running.value = true
  try {
    const r = await apiService.analysis.run(store.currentId)
    if (r.message) ElMessage.warning(r.message)
    else ElMessage.success(`分析完成：${r.insightCount} 个痛点 / ${r.topicCount} 个选题（分析了 ${r.commentsAnalyzed} 条评论）`)
    await loadData()
  } catch (e) {
    ElMessage.error('分析失败：' + (e?.message || ''))
  } finally {
    running.value = false
  }
}
async function setStatus(t, status) {
  await apiService.analysis.updateTopic(t.id, status)
  t.status = status
  ElMessage.success(status === 'adopted' ? '已采纳' : '已弃用')
}
async function showSamples(p) {
  activePain.value = p
  samples.value = await apiService.analysis.samples(p.sampleIds || [])
  drawer.value = true
}

watch(() => store.currentId, loadData)
onMounted(async () => {
  if (!store.list.length) await store.refresh()
  await loadData()
})
</script>

<style scoped>
.analysis { max-width: 1080px; }
.bar :deep(.el-card__body) { display: flex; justify-content: space-between; align-items: center; }
.bar-left { display: flex; align-items: center; gap: 10px; }
.label { color: #666; }
.muted { color: #bbb; font-size: 13px; font-weight: normal; }
.block-title { font-weight: 600; margin-bottom: 14px; }
.pains { display: flex; flex-direction: column; gap: 10px; }
.pain { display: flex; align-items: center; cursor: pointer; }
.pain:hover .pain-word { color: #ff2442; }
.pain-word { width: 90px; font-size: 14px; }
.pain-n { width: 30px; text-align: right; color: #999; font-size: 13px; }
.topic { display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px; }
.topic.adopted { border-color: #b3e19d; background: #f6ffed; }
.topic.discarded { opacity: .5; }
.topic-title { font-weight: 600; font-size: 14px; display: flex; gap: 8px; align-items: center; }
.topic-meta { color: #888; font-size: 12px; margin-top: 6px; }
.topic-ops { display: flex; gap: 6px; flex-shrink: 0; margin-left: 12px; }
</style>
