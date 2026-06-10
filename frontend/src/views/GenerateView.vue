<template>
  <div class="generate">
    <el-card shadow="never" class="bar">
      <div class="bar-left">
        <span class="label">运营项目</span>
        <el-select v-model="store.currentId" placeholder="选择项目" style="width:240px">
          <el-option v-for="c in store.list" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </div>
    </el-card>

    <el-alert type="info" :closable="false" show-icon style="margin:12px 0"
      title="从「已采纳的选题」生成文案。配图三种方式：「AI配图」按文章自动生图；来源选「图库/混合」点AI配图会按主题智能匹配你的素材；「选图」可自己从素材库/局域网文件夹手动挑。每张图右上角×可删。" />

    <el-empty v-if="!store.currentId" description="请先选择项目" />

    <el-row v-else :gutter="16">
      <!-- 左：已采纳选题 -->
      <el-col :span="9">
        <el-card shadow="never">
          <div class="block-title">已采纳选题 <span class="muted">（在「选题分析」里采纳）</span></div>
          <el-empty v-if="!adopted.length" description="还没有采纳的选题" :image-size="60" />
          <div class="gen-opts">
            <el-select v-model="theme" size="small" style="width:96px">
              <el-option label="养生" value="养生" />
              <el-option label="干货" value="干货" />
              <el-option label="小孩" value="小孩" />
              <el-option label="种草" value="种草" />
              <el-option label="测评" value="测评" />
            </el-select>
            <el-checkbox v-model="embedProduct" size="small" :disabled="theme==='种草'||theme==='测评'">夹带产品</el-checkbox>
          </div>
          <div v-for="t in adopted" :key="t.id" class="topic">
            <div class="topic-title">{{ t.title }}</div>
            <div class="topic-meta">{{ t.rationale }}</div>
            <el-button size="small" type="danger" :loading="genId===t.id" @click="gen(t)">生成（{{ theme }}）</el-button>
          </div>
        </el-card>
      </el-col>

      <!-- 右：草稿 -->
      <el-col :span="15">
        <el-card shadow="never">
          <div class="block-title">
            图文草稿 <span class="muted">（{{ drafts.length }}）</span>
            <span style="float:right">
              <el-button size="small" text type="primary" @click="openImgPrompt">配图设置</el-button>
              <el-button size="small" text type="primary" @click="repair">修复旧稿</el-button>
            </span>
          </div>
          <el-empty v-if="!drafts.length" description="点左侧「生成文案」" :image-size="60" />
          <div v-for="d in drafts" :key="d.id" class="draft">
            <el-input v-model="d.title" class="d-title" @blur="autoSave(d)" />
            <el-input v-model="d.body" type="textarea" :rows="7" class="d-body" @blur="autoSave(d)" />
            <div class="d-tags">
              <el-tag v-for="h in d.hashtags" :key="h" size="small" effect="plain">#{{ h }}</el-tag>
            </div>
            <!-- 配图 -->
            <div v-if="d.images && d.images.length" class="d-imgs">
              <div v-for="(img,i) in d.images" :key="i" class="d-img-cell">
                <el-image :src="img" :preview-src-list="d.images" :initial-index="i" fit="cover" class="d-img" />
                <el-button class="d-img-del" size="small" circle :icon="Close" @click="removeImg(d,i)" />
              </div>
            </div>
            <el-input v-model="imgPromptMap[d.id]" size="small" class="d-imgprompt"
              placeholder="可选：这条的生图提示词（填了就用你的；留空＝按全局设置/AI自动生成画面）" clearable />
            <div class="d-foot">
              <span class="d-foot-left">
                <el-tag size="small" :type="d.status==='published'?'success':'warning'">{{ d.status }}</el-tag>
                <span class="d-time">生成于 {{ fmtTime(d.createdAt) }}</span>
              </span>
              <div>
                <el-select v-model="cfg(d).ratio" size="small" style="width:90px;margin-right:6px">
                  <el-option label="竖版 3:4" value="3:4" />
                  <el-option label="竖版 9:16" value="9:16" />
                  <el-option label="方形 1:1" value="1:1" />
                  <el-option label="横版 4:3" value="4:3" />
                </el-select>
                <el-select v-model="cfg(d).count" size="small" style="width:64px;margin-right:6px">
                  <el-option v-for="n in 4" :key="n" :label="n+'张'" :value="n" />
                </el-select>
                <el-select v-model="cfg(d).source" size="small" style="width:88px;margin-right:6px">
                  <el-option label="AI生成" value="ai" />
                  <el-option label="图库" value="library" />
                  <el-option label="混合" value="mix" />
                </el-select>
                <el-button size="small" type="warning" plain :icon="Picture" :loading="imgId===d.id" @click="genImage(d)">AI配图</el-button>
                <el-button size="small" plain :icon="FolderOpened" @click="openPicker(d)">选图</el-button>
                <span class="save-tip" :class="saveState[d.id]" @click="saveState[d.id]==='error' && autoSave(d)">{{ saveLabel(d.id) }}</span>
                <el-popconfirm title="删除该草稿？" @confirm="del(d)">
                  <template #reference><el-button size="small" text>删除</el-button></template>
                </el-popconfirm>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 配图设置（项目级全局默认 + 提示词） -->
    <el-dialog v-model="imgPromptDialog" title="配图设置（全局默认）" width="560px">
      <p class="muted" style="margin-top:0">这里是<b>全局默认</b>：新草稿和全自动都按它来。每条草稿旁的选项可<b>单独覆盖</b>，互不影响。</p>
      <el-form label-width="90px">
        <el-form-item label="默认来源">
          <el-radio-group v-model="defSource"><el-radio-button value="ai">AI生成</el-radio-button><el-radio-button value="library">图库</el-radio-button><el-radio-button value="mix">混合</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item label="默认比例">
          <el-select v-model="defRatio" style="width:140px"><el-option label="竖版 3:4" value="3:4" /><el-option label="竖版 9:16" value="9:16" /><el-option label="方形 1:1" value="1:1" /><el-option label="横版 4:3" value="4:3" /></el-select>
        </el-form-item>
        <el-form-item label="默认张数"><el-input-number v-model="defCount" :min="1" :max="4" /></el-form-item>
        <el-form-item label="AI智能扩写">
          <el-switch v-model="aiExpand" />
          <span class="muted" style="margin-left:8px">开：先用AI把整篇文章转成具体画面再生图（图文最贴，推荐）；关：用下方模板填空</span>
        </el-form-item>
        <el-form-item label="模板提示词">
          <el-input v-model="imgPrompt" type="textarea" :rows="3" :disabled="aiExpand"
            placeholder="小红书风格配图，主题：{标题}。{正文}。干净清新、真实质感、暖色调、无文字水印。" />
        </el-form-item>
      </el-form>
      <p class="muted" style="margin:0">开了「AI智能扩写」时用 AI 自动生成画面，模板不生效；关掉时用模板，占位符 <code>{标题}</code> <code>{正文}</code> 自动替换。每条草稿还可单独手填提示词（优先级最高）。</p>
      <template #footer>
        <el-button @click="imgPromptDialog=false">取消</el-button>
        <el-button type="primary" @click="saveImgPrompt">保存</el-button>
      </template>
    </el-dialog>

    <!-- 手动选图：从上传素材 + 局域网文件夹里自己挑 -->
    <el-dialog v-model="pickerDialog" title="手动选图" width="720px" top="6vh">
      <div class="picker-bar">
        <span class="muted">点图选中(可多选)，确认后按该草稿比例({{ pickRatio }})裁好加入。</span>
        <el-button size="small" :loading="pickerLoading" @click="loadPickPool">刷新</el-button>
      </div>

      <el-tabs v-model="pickTab">
        <el-tab-pane :label="`上传素材 (${uploadPool.length})`" name="upload">
          <el-empty v-if="!uploadPool.length" description="还没有上传素材，去「素材图库」上传" :image-size="60" />
          <div class="pick-grid">
            <div v-for="m in uploadPool" :key="m.key" :class="['pick-cell',{sel:isSel(m)}]" @click="toggle(m)">
              <el-image :src="m.url" fit="cover" class="pick-thumb" lazy />
              <span class="pick-check" v-if="isSel(m)">✓</span>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane :label="`局域网文件夹 (${folderPool.length})`" name="folder">
          <el-alert v-if="folderErr" type="error" :closable="false" show-icon :title="folderErr" style="margin-bottom:10px" />
          <el-empty v-else-if="!folderPool.length" description="未配置或没读到图，去「素材图库」设置局域网文件夹" :image-size="60" />
          <div class="pick-grid">
            <div v-for="m in folderPool" :key="m.key" :class="['pick-cell',{sel:isSel(m)}]" @click="toggle(m)">
              <el-image :src="m.url" fit="cover" class="pick-thumb" lazy />
              <span class="pick-check" v-if="isSel(m)">✓</span>
              <span class="pick-name">{{ m.name }}</span>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <span class="muted" style="float:left;line-height:32px">已选 {{ selected.length }} 张</span>
        <el-button @click="pickerDialog=false">取消</el-button>
        <el-button type="primary" :loading="picking" :disabled="!selected.length" @click="confirmPick">加入草稿（{{ selected.length }}）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { Picture, FolderOpened, Close } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const imgPromptDialog = ref(false)
const imgPrompt = ref('')
const aiExpand = ref(true)
const topics = ref([])
const drafts = ref([])
const genId = ref('')
const imgId = ref('')
// 每条草稿独立配图设置
const imgCfg = reactive({})
// 每条草稿手填生图提示词
const imgPromptMap = reactive({})
// 项目级全局默认
const defSource = ref('ai')
const defRatio = ref('3:4')
const defCount = ref(1)
const theme = ref('养生')
const embedProduct = ref(false)

const adopted = computed(() => topics.value.filter((t) => t.status === 'adopted'))

function loadDefaults() {
  const cad = (store.current() && store.current().cadence) || {}
  defSource.value = cad.imageSource || 'ai'
  defRatio.value = cad.imageRatio || '3:4'
  defCount.value = cad.imageCount || 1
}
// 每条草稿的配图设置（首次取全局默认，之后可单独改）
function cfg(d) {
  if (!imgCfg[d.id]) imgCfg[d.id] = { ratio: defRatio.value, count: defCount.value, source: defSource.value }
  return imgCfg[d.id]
}
function fmtTime(s) {
  if (!s) return '—'
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
async function loadData() {
  if (!store.currentId) { topics.value = []; drafts.value = []; return }
  loadDefaults()
  ;[topics.value, drafts.value] = await Promise.all([
    apiService.analysis.topics(store.currentId),
    apiService.generate.drafts(store.currentId),
  ])
  // 记录已存快照，供自动保存判断是否有改动
  for (const d of drafts.value) lastSaved[d.id] = (d.title || '') + '' + (d.body || '')
}
async function gen(t) {
  genId.value = t.id
  try {
    await apiService.generate.fromTopic(t.id, theme.value, embedProduct.value)
    ElMessage.success('已生成草稿')
    await loadData()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '生成失败')
  } finally {
    genId.value = ''
  }
}
function openImgPrompt() {
  const c = store.current()
  imgPrompt.value = (c && c.cadence && c.cadence.imagePrompt) || '小红书风格配图，主题：{标题}。{正文}。干净清新、真实质感、暖色调、无文字水印。'
  aiExpand.value = !(c && c.cadence && c.cadence.imageAiExpand === false) // 默认开
  loadDefaults()
  imgPromptDialog.value = true
}
async function saveImgPrompt() {
  const c = store.current()
  const cadence = { ...((c && c.cadence) || {}), imagePrompt: imgPrompt.value, imageAiExpand: aiExpand.value, imageSource: defSource.value, imageRatio: defRatio.value, imageCount: defCount.value }
  await apiService.campaigns.update(store.currentId, { cadence })
  await store.refresh()
  imgPromptDialog.value = false
  ElMessage.success('配图设置已保存（全局默认）')
}
async function repair() {
  const r = await apiService.generate.repair(store.currentId)
  ElMessage.success(`修复 ${r.fixed} 篇旧草稿`)
  await loadData()
}
async function genImage(d) {
  imgId.value = d.id
  try {
    const cc = cfg(d)
    const myPrompt = (imgPromptMap[d.id] || '').trim() || undefined
    const updated = await apiService.generate.image(d.id, myPrompt, cc.ratio, cc.count, cc.source)
    d.images = updated.images
    ElMessage.success('配图已生成')
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '生成配图失败')
  } finally {
    imgId.value = ''
  }
}
// 文案失焦自动保存（标题/正文即改即存，无需手动按钮）
const saveState = reactive({})   // d.id -> 'saving' | 'saved' | 'error'
const lastSaved = reactive({})   // d.id -> 上次已存内容快照，避免无变化重复存
function saveLabel(id) {
  return { saving: '保存中…', saved: '✓ 已自动保存', error: '⚠ 保存失败，点此重试' }[saveState[id]] || ''
}
async function autoSave(d) {
  const snap = (d.title || '') + '' + (d.body || '')
  if (lastSaved[d.id] === snap) return // 没改动，跳过
  saveState[d.id] = 'saving'
  try {
    await apiService.generate.update(d.id, { title: d.title, body: d.body })
    lastSaved[d.id] = snap
    saveState[d.id] = 'saved'
    setTimeout(() => { if (saveState[d.id] === 'saved') saveState[d.id] = '' }, 2000)
  } catch (e) {
    saveState[d.id] = 'error'
  }
}
// 删除草稿里的单张图（直接落库）
async function removeImg(d, i) {
  const imgs = [...(d.images || [])]
  imgs.splice(i, 1)
  try {
    const updated = await apiService.generate.update(d.id, { images: imgs })
    d.images = updated.images
    ElMessage.success('已删除该图')
  } catch (e) { ElMessage.error('删除失败') }
}

// ===== 手动选图 =====
const pickerDialog = ref(false)
const pickerLoading = ref(false)
const picking = ref(false)
const pickTab = ref('upload')
const uploadPool = ref([])
const folderPool = ref([])
const folderErr = ref('')
const selected = ref([])
const pickTarget = ref(null)
const pickRatio = ref('3:4')

function selKey(m) { return m.key }
function isSel(m) { return selected.value.some((x) => x.key === m.key) }
function toggle(m) {
  const i = selected.value.findIndex((x) => x.key === m.key)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(m)
}
async function openPicker(d) {
  pickTarget.value = d
  pickRatio.value = cfg(d).ratio || '3:4'
  selected.value = []
  pickerDialog.value = true
  await loadPickPool()
}
async function loadPickPool() {
  pickerLoading.value = true
  folderErr.value = ''
  try {
    // 上传素材
    const ups = await apiService.materials.list(store.currentId)
    uploadPool.value = ups.map((m) => ({ key: 'u:' + m.id, url: m.url, name: m.name, source: 'upload', ref: m.url }))
    // 局域网文件夹
    const c = store.current()
    const dir = (c && c.cadence && c.cadence.materialDir) || ''
    if (dir) {
      const r = await apiService.materials.testFolder(dir)
      if (r.ok) folderPool.value = (r.images || []).map((m) => ({ key: 'f:' + m.name, url: m.url, name: m.name, source: 'folder', ref: m.name }))
      else { folderPool.value = []; folderErr.value = r.error || '读取失败' }
    } else { folderPool.value = [] }
  } catch (e) {
    ElMessage.error('加载素材失败：' + (e?.message || ''))
  } finally { pickerLoading.value = false }
}
async function confirmPick() {
  if (!selected.value.length || !pickTarget.value) return
  picking.value = true
  try {
    const picks = selected.value.map((m) => ({ source: m.source, ref: m.ref }))
    const updated = await apiService.generate.pickImages(pickTarget.value.id, picks, pickRatio.value)
    pickTarget.value.images = updated.images
    ElMessage.success(`已加入 ${selected.value.length} 张`)
    pickerDialog.value = false
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加入失败')
  } finally { picking.value = false }
}
async function del(d) {
  await apiService.generate.remove(d.id)
  await loadData()
}

watch(() => store.currentId, loadData)
onMounted(async () => {
  if (!store.list.length) await store.refresh()
  await loadData()
})
</script>

<style scoped>
.generate { max-width: 1080px; }
.bar :deep(.el-card__body) { display: flex; align-items: center; }
.bar-left { display: flex; align-items: center; gap: 10px; }
.label { color: #666; }
.muted { color: #bbb; font-size: 13px; font-weight: normal; }
.block-title { font-weight: 600; margin-bottom: 14px; }
.gen-opts { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.topic { border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
.topic-title { font-weight: 600; font-size: 14px; }
.topic-meta { color: #888; font-size: 12px; margin: 6px 0 10px; }
.draft { border: 1px solid #eee; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
.d-title { margin-bottom: 8px; font-weight: 600; }
.d-title :deep(input) { font-weight: 600; }
.d-body { margin-bottom: 8px; }
.d-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.d-imgs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.d-img-cell { position: relative; }
.d-img { width: 110px; height: 110px; border-radius: 8px; border: 1px solid #eee; display: block; }
.d-img-del { position: absolute; top: -6px; right: -6px; opacity: .9; padding: 4px; height: 22px; width: 22px; }
.d-imgprompt { margin: 8px 0 6px; }
.d-foot { display: flex; justify-content: space-between; align-items: center; }
.d-foot-left { display: inline-flex; align-items: center; gap: 8px; }
.d-time { font-size: 12px; color: #aaa; }
.save-tip { font-size: 12px; margin: 0 4px; min-width: 64px; display: inline-block; text-align: right; }
.save-tip.saving { color: #999; }
.save-tip.saved { color: #67c23a; }
.save-tip.error { color: #f56c6c; cursor: pointer; }
/* 选图弹窗 */
.picker-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.pick-grid { display: flex; flex-wrap: wrap; gap: 10px; max-height: 52vh; overflow-y: auto; }
.pick-cell { position: relative; width: 104px; cursor: pointer; border: 2px solid transparent; border-radius: 8px; padding: 2px; }
.pick-cell.sel { border-color: #ff2442; background: #fff3f5; }
.pick-thumb { width: 100px; height: 130px; border-radius: 6px; border: 1px solid #eee; }
.pick-check { position: absolute; top: 6px; right: 6px; background: #ff2442; color: #fff; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.pick-name { display: block; font-size: 11px; color: #999; width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
