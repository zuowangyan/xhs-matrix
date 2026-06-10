<template>
  <div class="publish">
    <el-card shadow="never" class="bar">
      <div class="bar-left">
        <span class="label">运营项目</span>
        <el-select v-model="store.currentId" placeholder="选择项目" style="width:220px" @change="loadData">
          <el-option v-for="c in store.list" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <span class="label">发文号</span>
        <el-select v-model="accountId" placeholder="选择已登录账号" style="width:200px" @change="saveAccount">
          <el-option v-for="a in publishers" :key="a.id" :label="a.nickname + (a.status==='active'?'':'（未登录）')" :value="a.id" :disabled="a.status!=='active'" />
        </el-select>
        <span class="muted">已绑定，全自动也用这个号</span>
      </div>
    </el-card>

    <el-alert type="warning" :closable="false" show-icon style="margin:12px 0"
      title="两种发布：①「拟人填写·自己发」=隐身浏览器拟人逐字填好图文+话题，停在发布前不点，你自己核对后点「发布」（最稳，推荐半自动用）；②「立即发布」=全自动连发布也点了。发完记得回来点「标记已发布」收尾。首次请先在「账号矩阵」扫码登录，建议先用小号测试。" />

    <el-empty v-if="!store.currentId" description="请先选择项目" />

    <template v-else>
      <el-card shadow="never" class="block">
        <div class="block-title">待发布草稿（status=ready）</div>
        <el-table :data="readyDrafts" size="small" empty-text="没有待发布草稿，去「内容生成」生成">
          <el-table-column prop="title" label="标题" min-width="240" show-overflow-tooltip />
          <el-table-column label="生成时间" width="150">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="配图" width="80">
            <template #default="{ row }">{{ (row.images||[]).length }} 张</template>
          </el-table-column>
          <el-table-column label="操作" width="320">
            <template #default="{ row }">
              <el-button size="small" type="warning" plain :loading="pubId===row.id" :disabled="!accountId" @click="pubHold(row)">拟人填写·自己发</el-button>
              <el-button size="small" text type="success" @click="markDone(row)">标记已发布</el-button>
              <el-button size="small" text type="danger" :loading="autoPubId===row.id" :disabled="!accountId" @click="pub(row)">立即发布(全自动)</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="block-title">已发布笔记 <span class="muted">（{{ publishedDrafts.length }}）</span></div>
        <el-table :data="publishedDrafts" size="small" empty-text="还没有已发布的">
          <el-table-column prop="title" label="标题" min-width="260" show-overflow-tooltip />
          <el-table-column label="配图" width="70">
            <template #default="{ row }">{{ (row.images||[]).length }}图</template>
          </el-table-column>
          <el-table-column prop="playbook" label="类型" width="100" />
          <el-table-column label="生成时间" width="150">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="updatedAt" label="发布时间" width="150">
            <template #default="{ row }">{{ fmt(row.updatedAt) }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="block">
        <div class="block-title">发布记录（含失败）</div>
        <el-table :data="jobs" size="small" empty-text="暂无发布记录">
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status==='published'?'success':row.status==='failed'?'danger':'warning'">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="result" label="结果 / 链接" min-width="280" show-overflow-tooltip />
          <el-table-column prop="createdAt" label="时间" width="170">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const accounts = ref([])
const drafts = ref([])
const jobs = ref([])
const accountId = ref('')
const pubId = ref('')
const autoPubId = ref('')

const publishers = computed(() => accounts.value.filter((a) => a.role === 'publisher'))
const readyDrafts = computed(() => drafts.value.filter((d) => d.status === 'ready'))
const publishedDrafts = computed(() => drafts.value.filter((d) => d.status === 'published'))

function fmt(s) { return s ? new Date(s).toLocaleString('zh-CN') : '' }

async function loadData() {
  accounts.value = await apiService.accounts.list()
  if (!store.currentId) return
  // 带出项目已绑定的发文号
  const c = store.current()
  accountId.value = (c && c.publishAccountIds && c.publishAccountIds[0]) || ''
  ;[drafts.value, jobs.value] = await Promise.all([
    apiService.generate.drafts(store.currentId),
    apiService.publish.jobs(store.currentId),
  ])
}
async function saveAccount(id) {
  // 记住选的号到项目（全自动也用它）
  await apiService.campaigns.update(store.currentId, { publishAccountIds: id ? [id] : [] })
  await store.refresh()
  ElMessage.success('已绑定该发文号')
}
// 拟人填写、停在发布前，留浏览器给用户自己点发布
async function pubHold(row) {
  pubId.value = row.id
  try {
    const r = await apiService.publish.draft(row.id, accountId.value, true)
    if (r.ok) ElMessage.success({ message: r.message, duration: 8000 })
    else ElMessage.error(r.message)
    await loadData()
  } catch (e) { ElMessage.error('操作失败：' + (e?.message || '')) } finally { pubId.value = '' }
}
// 全自动：连发布也点
async function pub(row) {
  autoPubId.value = row.id
  try {
    const r = await apiService.publish.draft(row.id, accountId.value, false)
    ElMessage[r.ok ? 'success' : 'error'](r.message)
    await loadData()
  } catch (e) { ElMessage.error('发布失败：' + (e?.message || '')) } finally { autoPubId.value = '' }
}
// 人工已在浏览器点过发布 → 收尾标记
async function markDone(row) {
  try {
    await apiService.publish.markDone(row.id, accountId.value)
    ElMessage.success('已标记为已发布')
    await loadData()
  } catch (e) { ElMessage.error('标记失败：' + (e?.message || '')) }
}

watch(() => store.currentId, loadData)
onMounted(async () => { if (!store.list.length) await store.refresh(); await loadData() })
</script>

<style scoped>
.publish { max-width: 1080px; }
.bar :deep(.el-card__body) { display: flex; align-items: center; }
.bar-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.label { color: #666; font-size: 14px; }
.muted { color: #aaa; font-size: 12px; }
.block { margin-bottom: 14px; }
.block-title { font-weight: 600; margin-bottom: 12px; }
</style>
