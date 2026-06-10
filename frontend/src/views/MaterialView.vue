<template>
  <div class="mat">
    <el-card shadow="never" class="bar">
      <div class="bar-left">
        <span class="label">运营项目</span>
        <el-select v-model="store.currentId" placeholder="选择项目" style="width:240px" @change="load">
          <el-option v-for="c in store.list" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-upload :show-file-list="false" :http-request="doUpload" accept="image/*" multiple>
          <el-button type="danger" :icon="Upload">上传素材图</el-button>
        </el-upload>
        <el-button :icon="FolderOpened" @click="openFolderCfg">局域网文件夹</el-button>
      </div>
    </el-card>

    <el-alert type="info" :closable="false" show-icon style="margin:12px 0"
      title="素材池 = 上传的图 + 局域网文件夹里的图。配图时在「内容生成」选「图库/混合」，会自动裁成所选比例(cover居中)。配了局域网文件夹就不用上传，按需自动读取。" />

    <el-empty v-if="!store.currentId" description="请先选择项目" />
    <template v-else>
      <el-card shadow="never">
        <div class="block-title">上传素材（{{ materials.length }}）<span class="muted">含本项目 + 全局通用</span></div>
        <el-empty v-if="!materials.length" description="还没有上传素材，点「上传素材图」" :image-size="60" />
        <div class="grid">
          <div v-for="m in materials" :key="m.id" class="cell">
            <el-image :src="m.url" :preview-src-list="materials.map(x=>x.url)" fit="cover" class="thumb" />
            <el-button class="del" size="small" circle :icon="Delete" @click="del(m.id)" />
          </div>
        </div>
      </el-card>

      <!-- 局域网文件夹里的图（只读预览，按需自动读取，不入库） -->
      <el-card shadow="never" style="margin-top:14px">
        <div class="block-title">
          局域网文件夹素材
          <span class="muted" v-if="folderInfo.dir">{{ folderInfo.dir }}</span>
          <span class="muted" v-else>未配置，点上方「局域网文件夹」设置</span>
          <el-button v-if="folderInfo.dir" size="small" text type="primary" :loading="folderLoading" @click="loadFolder" style="margin-left:8px">刷新读取</el-button>
        </div>
        <el-alert v-if="folderInfo.dir && folderInfo.error" type="error" :closable="false" show-icon :title="folderInfo.error" style="margin-bottom:10px" />
        <div v-if="folderInfo.dir && folderInfo.ok" class="muted" style="margin-bottom:10px">
          共读取到 {{ folderInfo.count }} 张{{ folderInfo.count > folderInfo.images.length ? `（仅预览前 ${folderInfo.images.length} 张）` : '' }}，配图选「图库/混合」时会从这里随机取并裁成所选比例。
        </div>
        <div class="grid" v-if="folderInfo.images.length">
          <div v-for="(m,i) in folderInfo.images" :key="i" class="cell">
            <el-image :src="m.url" :preview-src-list="folderInfo.images.map(x=>x.url)" :initial-index="i" fit="cover" class="thumb" lazy />
            <span class="fname">{{ m.name }}</span>
          </div>
        </div>
        <el-empty v-else-if="folderInfo.dir && folderInfo.ok" description="该文件夹里没找到图片(jpg/png/webp)" :image-size="60" />
      </el-card>
    </template>

    <!-- 局域网文件夹配置 -->
    <el-dialog v-model="folderDialog" title="局域网素材文件夹" width="600px">
      <p class="muted" style="margin-top:0">填一个本机/局域网可访问的图片文件夹路径，配图时按需自动读取里面的图(不用上传、本地不另存)。如 <code>\\\\192.168.0.93\\shijue\\素材</code> 或 <code>D:\\素材图</code>。<b>建议用 UNC 路径(\\\\开头)，比映射盘符(Z:)更稳。</b></p>
      <el-input v-model="folderPath" placeholder="\\192.168.0.93\shijue\素材  或  D:\素材图" />

      <el-divider content-position="left">NAS 需要登录?（已在本机映射并记住凭据可不填）</el-divider>
      <div class="cred">
        <el-input v-model="folderUser" placeholder="用户名(可选)" style="width:200px" />
        <el-input v-model="folderPass" type="password" show-password placeholder="密码(可选，不会保存)" style="width:200px" />
      </div>
      <p class="muted" style="margin:6px 0 0">填了账号会用 <code>net use</code> 建立连接(密码交给 Windows 记住，<b>不存进本软件</b>)。</p>

      <el-button :icon="View" :loading="testing" @click="testFolder" style="margin-top:12px">测试 / 预览</el-button>
      <span v-if="testResult" :class="['test-tip', testResult.ok ? 'ok' : 'err']">{{ testResult.msg }}</span>

      <div v-if="testResult && testResult.ok && testResult.images.length" class="grid preview" style="margin-top:12px">
        <div v-for="(m,i) in testResult.images.slice(0,18)" :key="i" class="cell sm">
          <el-image :src="m.url" fit="cover" class="thumb sm" lazy />
        </div>
      </div>

      <el-checkbox v-model="saveAi" style="margin-top:14px">把 AI 生成的图也另存到该文件夹（可复用为素材）</el-checkbox>
      <template #footer>
        <el-button @click="folderDialog=false">取消</el-button>
        <el-button type="primary" @click="saveFolder">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { Upload, Delete, FolderOpened, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const materials = ref([])
const folderDialog = ref(false)
const folderPath = ref('')
const folderUser = ref('')
const folderPass = ref('')
const saveAi = ref(false)
const testing = ref(false)
const testResult = ref(null)
// 主界面：局域网文件夹只读预览
const folderInfo = ref({ dir: '', ok: false, count: 0, images: [], error: '' })
const folderLoading = ref(false)

async function load() {
  if (!store.currentId) { materials.value = []; return }
  materials.value = await apiService.materials.list(store.currentId)
  await loadFolder()
}
async function loadFolder() {
  const c = store.current()
  const dir = (c && c.cadence && c.cadence.materialDir) || ''
  if (!dir) { folderInfo.value = { dir: '', ok: false, count: 0, images: [], error: '' }; return }
  folderLoading.value = true
  try {
    const r = await apiService.materials.testFolder(dir)
    folderInfo.value = { dir, ok: r.ok, count: r.count, images: r.images || [], error: r.error || '' }
  } catch (e) {
    folderInfo.value = { dir, ok: false, count: 0, images: [], error: '读取失败：' + (e?.message || '') }
  } finally { folderLoading.value = false }
}
async function testFolder() {
  if (!folderPath.value.trim()) return ElMessage.warning('请先填文件夹路径')
  testing.value = true; testResult.value = null
  try {
    const r = await apiService.materials.testFolder(folderPath.value.trim(), folderUser.value || undefined, folderPass.value || undefined)
    testResult.value = {
      ok: r.ok,
      images: r.images || [],
      msg: r.ok ? `✅ 连通，找到 ${r.count} 张图片` : `❌ ${r.error || '读取失败'}`,
    }
  } catch (e) {
    testResult.value = { ok: false, images: [], msg: '❌ 测试失败：' + (e?.message || '') }
  } finally { testing.value = false }
}
async function doUpload(opt) {
  try {
    await apiService.materials.upload(opt.file, store.currentId)
    ElMessage.success('已上传')
    await load()
  } catch (e) { ElMessage.error('上传失败：' + (e?.message || '')) }
}
async function del(id) { await apiService.materials.remove(id); await load() }

function openFolderCfg() {
  const c = store.current()
  folderPath.value = (c && c.cadence && c.cadence.materialDir) || ''
  saveAi.value = !!(c && c.cadence && c.cadence.saveAiToFolder)
  folderUser.value = ''; folderPass.value = ''; testResult.value = null
  folderDialog.value = true
}
async function saveFolder() {
  const c = store.current()
  // 注意：只保存路径与开关，账号密码不入库（已交给 Windows 凭据）
  const cadence = { ...((c && c.cadence) || {}), materialDir: folderPath.value.trim(), saveAiToFolder: saveAi.value }
  await apiService.campaigns.update(store.currentId, { cadence })
  await store.refresh()
  folderDialog.value = false
  ElMessage.success('已保存局域网文件夹')
  await loadFolder()
}

watch(() => store.currentId, load)
onMounted(async () => { if (!store.list.length) await store.refresh(); await load() })
</script>

<style scoped>
.mat { max-width: 1080px; }
.bar :deep(.el-card__body) { display: flex; align-items: center; }
.bar-left { display: flex; align-items: center; gap: 10px; }
.label { color: #666; }
.muted { color: #bbb; font-size: 13px; font-weight: normal; }
.block-title { font-weight: 600; margin-bottom: 14px; }
.grid { display: flex; flex-wrap: wrap; gap: 12px; }
.cell { position: relative; width: 132px; }
.thumb { width: 132px; height: 176px; border-radius: 8px; border: 1px solid #eee; }
.thumb.sm { width: 84px; height: 112px; }
.cell.sm { width: 84px; }
.del { position: absolute; top: 4px; right: 4px; opacity: .85; }
.fname { display: block; font-size: 11px; color: #999; width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.cred { display: flex; gap: 10px; }
.test-tip { margin-left: 10px; font-size: 13px; }
.test-tip.ok { color: #67c23a; }
.test-tip.err { color: #f56c6c; }
code { background: #f2f3f5; padding: 1px 6px; border-radius: 4px; }
</style>
