<template>
  <div class="settings">
    <el-card shadow="never" class="block">
      <div class="block-title">
        模型网关
        <span class="muted">供应商 → 协议 → 地址/密钥 → 模型（文本 & 生图统一）</span>
      </div>

      <div class="active-bar">
        <span>当前文本模型：<b>{{ activeName('text') }}</b></span>
        <span>当前生图模型：<b>{{ activeName('image') }}</b></span>
        <el-button size="small" :icon="Plus" type="primary" @click="openAddProvider">新增供应商</el-button>
      </div>

      <el-empty v-if="!providers.length" description="还没有供应商，点「新增供应商」开始" :image-size="70" />

      <!-- 已配置供应商列表 -->
      <el-collapse v-else v-model="openPanels">
        <el-collapse-item v-for="p in providers" :key="p.id" :name="p.id">
          <template #title>
            <span class="prov-title">
              {{ p.name }}
              <el-tag size="small" effect="plain">{{ p.protocol }}</el-tag>
              <el-tag size="small" :type="p.hasKey ? 'success' : 'danger'">{{ p.hasKey ? 'Key:'+p.apiKeyMask : '无Key' }}</el-tag>
            </span>
          </template>

          <div class="prov-body">
            <div class="prov-url">{{ p.apiUrl }}</div>

            <!-- 模型列表（可加多个） -->
            <el-table :data="p.models" size="small" empty-text="还没有模型，下方添加">
              <el-table-column prop="modelName" label="模型" min-width="180" />
              <el-table-column label="类型" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.modelType==='image'?'warning':'primary'">{{ row.modelType==='image'?'生图':'文本' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="220">
                <template #default="{ row }">
                  <el-button size="small" text type="primary"
                    @click="setActive(row.modelType==='image'?'activeImageModelId':'activeTextModelId', row.id)">
                    设为当前{{ row.modelType==='image'?'生图':'文本' }}
                  </el-button>
                  <el-button size="small" text @click="testModel(row.id)">测试</el-button>
                  <el-button size="small" text @click="delModel(row.id)">删</el-button>
                </template>
              </el-table-column>
            </el-table>

            <div class="add-model">
              <el-input :model-value="newModel[p.id]" @update:model-value="v=>newModel[p.id]=v" placeholder="输入模型名，如 deepseek-chat / dall-e-3" style="width:280px" />
              <el-select v-model="newModelType[p.id]" style="width:100px">
                <el-option label="文本" value="text" />
                <el-option label="生图" value="image" />
              </el-select>
              <el-button :icon="Plus" @click="addModel(p.id)">添加模型</el-button>
              <span class="recommend" v-if="recommendOf(p)">推荐：
                <el-link v-for="m in recommendOf(p)" :key="m" type="primary" @click="quickAdd(p.id, m)">{{ m }}</el-link>
              </span>
            </div>

            <div class="prov-ops">
              <el-button size="small" @click="openEditProvider(p)">编辑地址/密钥</el-button>
              <el-popconfirm title="删除该供应商及其模型？" @confirm="delProvider(p.id)">
                <template #reference><el-button size="small" text type="danger">删除供应商</el-button></template>
              </el-popconfirm>
            </div>

            <div v-if="testResult[p.id]" class="test-res">
              <el-tag :type="testResult[p.id].ok?'success':'danger'">
                {{ testResult[p.id].ok ? '连通：'+testResult[p.id].message : '失败：'+testResult[p.id].message }}
              </el-tag>
              <span v-if="testResult[p.id].ok && testResult[p.id].usage?.cacheReadTokens" class="cache">缓存命中: {{ testResult[p.id].usage.cacheReadTokens }}</span>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-card shadow="never" class="block">
      <div class="block-title">系统</div>
      <div class="sys-row">
        <span>开机自启动</span>
        <el-switch v-model="autoLaunch" :loading="alBusy" @change="toggleAutoLaunch" />
        <span class="muted">开启后，开机自动在后台启动本软件（通过 Windows 启动项）。</span>
      </div>
    </el-card>

    <el-card shadow="never" class="block">
      <div class="block-title">局域网共享访问</div>
      <template v-if="lan.enabled">
        <p class="muted" style="margin-top:0">已开启共享。把下面地址发给同一局域网的小伙伴，浏览器打开即可（与本机界面、数据完全一致）：</p>
        <div v-if="lan.urls && lan.urls.length">
          <div v-for="u in lan.urls" :key="u" class="lan-url">
            <code>{{ u }}</code>
            <el-button size="small" text type="primary" @click="copy(u)">复制</el-button>
          </div>
        </div>
        <p v-else class="muted">未检测到局域网 IP（可能没插网线/连WiFi）。</p>
      </template>
      <p v-else class="muted" style="margin-top:0">
        当前仅本机可用。要共享：编辑 <code>backend-ts/.env</code> 设 <code>LAN_ACCESS=1</code> 并放行防火墙 4180 端口后重启。
        （便携包「一键安装」会自动开启共享 + 放行防火墙。）
      </p>
    </el-card>

    <!-- 新增/编辑供应商对话框 -->
    <el-dialog v-model="dialog" :title="editing ? '编辑供应商' : '新增供应商'" width="520px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="供应商">
          <el-select v-model="form.provider" :disabled="editing" filterable style="width:100%" @change="onTemplateChange">
            <el-option v-for="t in templates" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" placeholder="给这个配置起个名，如 我的DeepSeek" /></el-form-item>
        <el-form-item label="协议">
          <el-select v-model="form.protocol" style="width:100%">
            <el-option v-for="pr in curProtocols" :key="pr" :label="pr" :value="pr" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL"><el-input v-model="form.apiUrl" :placeholder="curTemplate?.defaultApiUrl || 'https://xxx/v1'" /></el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password :placeholder="editing ? '留空不修改' : 'sk-...'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveProvider">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'

const templates = ref([])
const providers = ref([])
const active = ref({ activeTextModelId: '', activeImageModelId: '' })
const openPanels = ref([])
const newModel = reactive({})
const newModelType = reactive({})
const testResult = reactive({})

const dialog = ref(false)
const editing = ref(false)
const editId = ref('')
const saving = ref(false)
const autoLaunch = ref(false)
const alBusy = ref(false)
const lan = ref({ enabled: false, urls: [] })
function copy(t) {
  navigator.clipboard?.writeText(t).then(() => ElMessage.success('已复制：' + t)).catch(() => {})
}
const form = reactive({ provider: '', name: '', protocol: 'openai', apiUrl: '', apiKey: '' })

const curTemplate = computed(() => templates.value.find((t) => t.id === form.provider))
const curProtocols = computed(() => curTemplate.value?.protocols?.length ? curTemplate.value.protocols : ['openai'])

function recommendOf(p) {
  const t = templates.value.find((x) => x.id === p.provider)
  return t?.recommendedModels?.slice(0, 6) || null
}
function allModels() { return providers.value.flatMap((p) => p.models.map((m) => ({ ...m, providerName: p.name }))) }
function activeName(type) {
  const id = type === 'text' ? active.value.activeTextModelId : active.value.activeImageModelId
  const m = allModels().find((x) => x.id === id)
  return m ? `${m.providerName} / ${m.modelName}` : '未设置'
}

async function load() {
  ;[templates.value, providers.value, active.value] = await Promise.all([
    apiService.gateway.templates(),
    apiService.gateway.providers(),
    apiService.gateway.active(),
  ])
  providers.value.forEach((p) => { if (!newModelType[p.id]) newModelType[p.id] = 'text' })
  openPanels.value = providers.value.map((p) => p.id)
  try { autoLaunch.value = (await apiService.settings.getAutoLaunch()).enabled } catch {}
  try { lan.value = await apiService.settings.getLan() } catch {}
}

async function toggleAutoLaunch(v) {
  alBusy.value = true
  try {
    const r = await apiService.settings.setAutoLaunch(v)
    autoLaunch.value = r.enabled
    ElMessage.success(r.message || (v ? '已开启开机自启' : '已关闭开机自启'))
  } catch (e) {
    autoLaunch.value = !v // 回滚
    ElMessage.error('设置失败：' + (e?.message || ''))
  } finally { alBusy.value = false }
}

function openAddProvider() {
  editing.value = false
  Object.assign(form, { provider: templates.value[0]?.id || '', name: '', protocol: 'openai', apiUrl: '', apiKey: '' })
  onTemplateChange()
  dialog.value = true
}
function openEditProvider(p) {
  editing.value = true
  editId.value = p.id
  Object.assign(form, { provider: p.provider, name: p.name, protocol: p.protocol, apiUrl: p.apiUrl, apiKey: '' })
  dialog.value = true
}
function onTemplateChange() {
  const t = curTemplate.value
  if (t) {
    form.name = form.name || t.name
    form.apiUrl = t.defaultApiUrl || ''
    form.protocol = (t.protocols && t.protocols[0]) || 'openai'
  }
}
async function saveProvider() {
  if (!form.name) return ElMessage.warning('请填名称')
  saving.value = true
  try {
    if (editing.value) {
      const payload = { name: form.name, protocol: form.protocol, apiUrl: form.apiUrl }
      if (form.apiKey) payload.apiKey = form.apiKey
      await apiService.gateway.updateProvider(editId.value, payload)
    } else {
      await apiService.gateway.createProvider({ ...form })
    }
    ElMessage.success('已保存')
    dialog.value = false
    await load()
  } catch (e) { ElMessage.error('保存失败：' + (e?.message || '')) } finally { saving.value = false }
}
async function delProvider(id) { await apiService.gateway.removeProvider(id); await load() }

async function addModel(pid) {
  const name = newModel[pid]
  if (!name) return ElMessage.warning('请输入模型名')
  await apiService.gateway.addModel(pid, name, newModelType[pid] || 'text')
  newModel[pid] = ''
  await load()
}
async function quickAdd(pid, name) {
  await apiService.gateway.addModel(pid, name, newModelType[pid] || 'text')
  await load()
}
async function delModel(id) { await apiService.gateway.removeModel(id); await load() }
async function setActive(field, modelId) {
  active.value = await apiService.gateway.setActive(field, modelId)
  ElMessage.success('已设为当前')
}
async function testModel(modelId) {
  const r = await apiService.gateway.test(modelId)
  // 找到该模型所属 provider 面板展示
  const m = allModels().find((x) => x.id === modelId)
  const pid = providers.value.find((p) => p.models.some((mm) => mm.id === modelId))?.id
  if (pid) testResult[pid] = r
  if (r.ok) ElMessage.success('连通：' + r.message); else ElMessage.error('失败：' + r.message)
}

onMounted(load)
</script>

<style scoped>
.settings { max-width: 860px; }
.block { margin-bottom: 16px; }
.block-title { font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; }
.sys-row { display: flex; align-items: center; gap: 12px; font-size: 14px; color: #555; }
.lan-url { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.lan-url code { background: #f2f3f5; padding: 3px 10px; border-radius: 4px; font-size: 14px; }
.muted { color: #999; font-size: 13px; font-weight: normal; }
.active-bar { display: flex; align-items: center; gap: 24px; margin-bottom: 14px; font-size: 13px; color: #555; }
.active-bar .el-button { margin-left: auto; }
.prov-title { display: flex; align-items: center; gap: 8px; }
.prov-body { padding: 4px 2px; }
.prov-url { color: #999; font-size: 12px; margin-bottom: 10px; }
.add-model { display: flex; align-items: center; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
.recommend { font-size: 12px; color: #999; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.prov-ops { display: flex; gap: 10px; margin-top: 6px; }
.test-res { margin-top: 10px; }
.cache { color: #67c23a; margin-left: 8px; font-size: 13px; }
code { background: #f2f3f5; padding: 1px 6px; border-radius: 4px; }
</style>
