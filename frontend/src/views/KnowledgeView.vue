<template>
  <div class="kb">
    <el-tabs v-model="tab">
      <!-- ============ 人设 ============ -->
      <el-tab-pane label="人设" name="persona">
        <div class="head">
          <span class="muted">人设的结构化旋钮（语气/定位/禁忌…）+ 绑定知识库空间，生成时自动注入。</span>
          <el-button type="danger" :icon="Plus" @click="openPersona()">新建人设</el-button>
        </div>
        <el-empty v-if="!personas.length" description="还没有人设" :image-size="60" />
        <el-row :gutter="16">
          <el-col v-for="p in personas" :key="p.id" :span="8" style="margin-bottom:16px">
            <el-card shadow="hover">
              <div class="p-head">
                <span class="p-name">{{ p.name }}</span>
                <div>
                  <el-button text size="small" @click="openPersona(p)">编辑</el-button>
                  <el-popconfirm title="删除？" @confirm="delPersona(p.id)">
                    <template #reference><el-button text size="small">删</el-button></template>
                  </el-popconfirm>
                </div>
              </div>
              <div class="p-row">语气：{{ p.tone || '—' }}</div>
              <div class="p-row">定位：{{ p.positioning || '—' }}</div>
              <div class="p-row">人群：{{ p.audience || '—' }}</div>
              <div class="p-row">禁忌：{{ p.taboo || '—' }}</div>
              <div class="p-row">绑定知识库：
                <el-tag v-for="sid in p.wikiSpaceIds" :key="sid" size="small" effect="plain">{{ spaceName(sid) }}</el-tag>
                <span v-if="!p.wikiSpaceIds?.length" class="muted">未绑定</span>
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- ============ 知识库 Wiki ============ -->
      <el-tab-pane label="知识库（Wiki）" name="wiki">
        <el-row :gutter="16">
          <!-- 空间 + 页面树 -->
          <el-col :span="8">
            <el-card shadow="never">
              <div class="head">
                <el-select v-model="curSpaceId" placeholder="选择空间" style="flex:1" @change="loadTree">
                  <el-option v-for="s in spaces" :key="s.id" :label="s.name" :value="s.id" />
                </el-select>
                <el-button :icon="Plus" @click="spaceDialog=true" />
              </div>
              <div v-if="curSpaceId" class="tree-ops">
                <el-button size="small" text @click="addPage(null)">+ 顶级页面</el-button>
                <el-popconfirm title="删除整个空间？" @confirm="delSpace">
                  <template #reference><el-button size="small" text type="danger">删除空间</el-button></template>
                </el-popconfirm>
              </div>
              <!-- 自动更新（LLM 综合写回） -->
              <div v-if="curSpaceId" class="auto-ops">
                <el-button size="small" type="warning" plain :icon="MagicStick" @click="aiDialog=true">AI 整理入库</el-button>
                <el-button size="small" type="warning" plain @click="campDialog=true">从采集沉淀</el-button>
              </div>
              <el-tree v-if="curSpaceId" :data="tree" node-key="id" :props="{ label: 'title', children: 'children' }"
                @node-click="openPage" default-expand-all highlight-current style="margin-top:8px">
                <template #default="{ data }">
                  <span class="tnode">
                    <span class="tnode-title">
                      <el-tag v-if="data.pageType && data.pageType!=='category'" size="small" :type="typeTag(data.pageType)" effect="plain">{{ typeLabel(data.pageType) }}</el-tag>
                      {{ data.title }}
                    </span>
                    <span class="tnode-ops">
                      <el-icon @click.stop="addPage(data.id)"><Plus /></el-icon>
                      <el-icon @click.stop="delPage(data.id)"><Delete /></el-icon>
                    </span>
                  </span>
                </template>
              </el-tree>
            </el-card>
          </el-col>

          <!-- 页面编辑 -->
          <el-col :span="16">
            <el-card shadow="never">
              <el-empty v-if="!curPage" description="选择左侧页面编辑，或新建页面" :image-size="60" />
              <template v-else>
                <div class="pg-meta">
                  <el-tag v-if="curPage.pageType && curPage.pageType!=='category'" size="small" :type="typeTag(curPage.pageType)">{{ typeLabel(curPage.pageType) }}</el-tag>
                  <el-tag v-if="curPage.confidence" size="small" effect="plain" :type="confTag(curPage.confidence)">{{ curPage.confidence }}</el-tag>
                  <span v-if="curPage.tags" class="muted">标签：{{ curPage.tags }}</span>
                </div>
                <el-input v-model="curPage.title" class="pg-title" />
                <el-input v-model="curPage.content" type="textarea" :rows="15" placeholder="Markdown 内容：写产品卖点/成分/FAQ/合规话术等" />
                <div class="pg-foot">
                  <span class="muted">支持 Markdown；生成文案时会被检索注入</span>
                  <el-button type="primary" :loading="savingPage" @click="savePage">保存</el-button>
                </div>
              </template>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>

    <!-- 人设对话框 -->
    <el-dialog v-model="personaDialog" :title="form.id ? '编辑人设' : '新建人设'" width="560px">
      <el-form :model="form" label-width="92px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="语气"><el-input v-model="form.tone" placeholder="如 亲切真诚、像朋友" /></el-form-item>
        <el-form-item label="定位"><el-input v-model="form.positioning" placeholder="如 食养知识博主" /></el-form-item>
        <el-form-item label="目标人群"><el-input v-model="form.audience" placeholder="如 25-40 岁女性" /></el-form-item>
        <el-form-item label="禁忌"><el-input v-model="form.taboo" placeholder="如 不夸大功效、不承诺疗效" /></el-form-item>
        <el-form-item label="固定话术"><el-input v-model="form.signature" placeholder="口头禅/固定开场" /></el-form-item>
        <el-form-item label="常用话题">
          <el-select v-model="form.hashtags" multiple filterable allow-create default-first-option style="width:100%" placeholder="回车添加" />
        </el-form-item>
        <el-form-item label="绑定知识库">
          <el-select v-model="form.wikiSpaceIds" multiple style="width:100%" placeholder="选择产品库/人设空间">
            <el-option v-for="s in spaces" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="personaDialog=false">取消</el-button>
        <el-button type="danger" :loading="savingPersona" @click="savePersona">保存</el-button>
      </template>
    </el-dialog>

    <!-- AI 整理入库对话框 -->
    <el-dialog v-model="aiDialog" title="AI 整理入库（自动综合写回）" width="600px">
      <p class="muted" style="margin-top:0">粘贴产品说明 / 竞品笔记 / 任意素材，AI 自动拆成分层知识页（实体/主题/综合）写入当前空间，同名自动更新。</p>
      <el-input v-model="aiText" type="textarea" :rows="10" placeholder="粘贴原始素材…" />
      <template #footer>
        <el-button @click="aiDialog=false">取消</el-button>
        <el-button type="warning" :loading="synthing" @click="runSynth">开始整理</el-button>
      </template>
    </el-dialog>

    <!-- 从采集沉淀对话框 -->
    <el-dialog v-model="campDialog" title="从采集自动沉淀" width="440px">
      <p class="muted" style="margin-top:0">把某个项目已采集的笔记，自动综合成知识写入当前空间。</p>
      <el-select v-model="campId" placeholder="选择项目" style="width:100%">
        <el-option v-for="c in campaigns" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <template #footer>
        <el-button @click="campDialog=false">取消</el-button>
        <el-button type="warning" :loading="synthing" :disabled="!campId" @click="runSynthCampaign">开始沉淀</el-button>
      </template>
    </el-dialog>

    <!-- 新建空间对话框 -->
    <el-dialog v-model="spaceDialog" title="新建知识库空间" width="440px">
      <el-form label-width="80px">
        <el-form-item label="名称"><el-input v-model="spaceForm.name" placeholder="如 面膜产品库" /></el-form-item>
        <el-form-item label="模板">
          <el-select v-model="spaceForm.template" style="width:100%">
            <el-option label="产品库（卖点/成分/适用/FAQ/合规话术）" value="product" />
            <el-option label="人设（品牌故事/口吻范文/风格样例）" value="persona" />
            <el-option label="空白" value="general" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="spaceDialog=false">取消</el-button>
        <el-button type="primary" @click="createSpace">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { Plus, Delete, MagicStick } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'

const tab = ref('persona')
const personas = ref([])
const spaces = ref([])
const curSpaceId = ref('')
const tree = ref([])
const curPage = ref(null)
const savingPage = ref(false)

const personaDialog = ref(false)
const savingPersona = ref(false)
const form = reactive({ id: '', name: '', tone: '', positioning: '', audience: '', taboo: '', signature: '', hashtags: [], wikiSpaceIds: [] })

const spaceDialog = ref(false)
const spaceForm = reactive({ name: '', template: 'product' })

// 自动更新
const aiDialog = ref(false)
const aiText = ref('')
const campDialog = ref(false)
const campId = ref('')
const campaigns = ref([])
const synthing = ref(false)

function spaceName(id) { return spaces.value.find((s) => s.id === id)?.name || id }
function typeLabel(t) { return { source: '素材', entity: '实体', topic: '主题', synthesis: '综合', category: '分类' }[t] || t }
function typeTag(t) { return { source: 'info', entity: 'primary', topic: 'success', synthesis: 'warning' }[t] || 'info' }
function confTag(c) { return { EXTRACTED: 'success', INFERRED: 'warning', AMBIGUOUS: 'danger', UNVERIFIED: 'info' }[c] || 'info' }

async function runSynth() {
  if (!aiText.value.trim()) return ElMessage.warning('请粘贴素材')
  synthing.value = true
  try {
    const r = await apiService.wiki.synthesize(curSpaceId.value, aiText.value)
    ElMessage.success(`已写入 ${r.written} 页`)
    aiDialog.value = false; aiText.value = ''
    await loadTree()
  } catch (e) { ElMessage.error('整理失败：' + (e?.response?.data?.message || e?.message || '')) } finally { synthing.value = false }
}
async function runSynthCampaign() {
  synthing.value = true
  try {
    const r = await apiService.wiki.synthFromCampaign(curSpaceId.value, campId.value)
    if (r.message) ElMessage.warning(r.message)
    else ElMessage.success(`已沉淀 ${r.written} 页`)
    campDialog.value = false
    await loadTree()
  } catch (e) { ElMessage.error('沉淀失败：' + (e?.response?.data?.message || e?.message || '')) } finally { synthing.value = false }
}

async function loadAll() {
  ;[personas.value, spaces.value, campaigns.value] = await Promise.all([
    apiService.personas.list(),
    apiService.wiki.spaces(),
    apiService.campaigns.list().catch(() => []),
  ])
  if (!curSpaceId.value && spaces.value.length) { curSpaceId.value = spaces.value[0].id; await loadTree() }
}
async function loadTree() {
  curPage.value = null
  tree.value = curSpaceId.value ? await apiService.wiki.tree(curSpaceId.value) : []
}

// 人设
function openPersona(p) {
  if (p) Object.assign(form, { ...p, hashtags: p.hashtags || [], wikiSpaceIds: p.wikiSpaceIds || [] })
  else Object.assign(form, { id: '', name: '', tone: '', positioning: '', audience: '', taboo: '', signature: '', hashtags: [], wikiSpaceIds: [] })
  personaDialog.value = true
}
async function savePersona() {
  if (!form.name) return ElMessage.warning('请填名称')
  savingPersona.value = true
  try {
    const { id, ...data } = form
    if (id) await apiService.personas.update(id, data)
    else await apiService.personas.create(data)
    ElMessage.success('已保存'); personaDialog.value = false; await loadAll()
  } catch (e) { ElMessage.error('保存失败：' + (e?.message || '')) } finally { savingPersona.value = false }
}
async function delPersona(id) { await apiService.personas.remove(id); await loadAll() }

// 空间
async function createSpace() {
  if (!spaceForm.name) return ElMessage.warning('请填名称')
  const s = await apiService.wiki.createSpace({ ...spaceForm })
  spaceDialog.value = false; spaceForm.name = ''
  await loadAll(); curSpaceId.value = s.id; await loadTree()
  ElMessage.success('空间已创建')
}
async function delSpace() { await apiService.wiki.removeSpace(curSpaceId.value); curSpaceId.value = ''; await loadAll() }

// 页面
async function openPage(node) { curPage.value = await apiService.wiki.page(node.id) }
async function addPage(parentId) {
  const title = parentId ? '新子页面' : '新页面'
  await apiService.wiki.createPage({ spaceId: curSpaceId.value, parentId: parentId || undefined, title })
  await loadTree()
}
async function delPage(id) { await apiService.wiki.removePage(id); if (curPage.value?.id === id) curPage.value = null; await loadTree() }
async function savePage() {
  savingPage.value = true
  try {
    await apiService.wiki.updatePage(curPage.value.id, { title: curPage.value.title, content: curPage.value.content })
    ElMessage.success('已保存'); await loadTree()
  } catch (e) { ElMessage.error('保存失败') } finally { savingPage.value = false }
}

onMounted(loadAll)
</script>

<style scoped>
.kb { max-width: 1100px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.head .el-button:last-child { margin-left: auto; }
.muted { color: #999; font-size: 13px; }
.p-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.p-name { font-weight: 600; font-size: 16px; }
.p-row { font-size: 13px; color: #555; margin: 4px 0; }
.tree-ops { display: flex; justify-content: space-between; margin-top: 8px; }
.auto-ops { display: flex; gap: 8px; margin-top: 8px; }
.pg-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tnode-title { display: flex; align-items: center; gap: 6px; }
.tnode { display: flex; justify-content: space-between; align-items: center; width: 100%; padding-right: 8px; }
.tnode-ops { display: none; gap: 8px; color: #999; }
.tnode:hover .tnode-ops { display: flex; }
.tnode-ops .el-icon:hover { color: #ff2442; }
.pg-title { margin-bottom: 8px; font-weight: 600; }
.pg-title :deep(input) { font-weight: 600; font-size: 15px; }
.pg-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
</style>
