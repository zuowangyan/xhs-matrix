<template>
  <div class="autopilot">
    <div class="page-head">
      <div>
        <h2 class="ph-title"><el-icon><Cpu /></el-icon> 总控台</h2>
        <p class="ph-sub">建运营项目 → 看流水线进度 → 在闸门处把关。一个项目串起：抓什么 / 写哪个产品 / 用哪个号 / 怎么发。</p>
      </div>
      <el-button type="danger" :icon="Plus" @click="openCreate">新建运营项目</el-button>
    </div>

    <!-- 空态 -->
    <el-empty v-if="!store.list.length" description="还没有运营项目，先建一个把主线跑起来">
      <el-button type="danger" @click="openCreate">新建运营项目</el-button>
    </el-empty>

    <!-- 项目卡片 -->
    <el-row v-else :gutter="16">
      <el-col v-for="c in store.list" :key="c.id" :span="8" style="margin-bottom:16px">
        <el-card shadow="hover" :class="['camp', { active: c.id === store.currentId }]" @click="store.setCurrent(c.id)">
          <div class="camp-head">
            <span class="camp-name">{{ c.name }}</span>
            <el-tag size="small" :type="modeTag(c.runMode)">{{ modeText(c.runMode) }}</el-tag>
          </div>
          <div class="camp-row"><span class="k">产品</span>{{ c.productName || '—' }}</div>
          <div class="camp-row"><span class="k">关键词</span>
            <el-tag v-for="kw in (c.keywords||[]).slice(0,3)" :key="kw" size="small" effect="plain" class="kw">{{ kw }}</el-tag>
            <span v-if="!(c.keywords||[]).length" class="muted">—</span>
          </div>
          <div class="camp-row"><span class="k">玩法</span>{{ c.playbook || '—' }}</div>

          <!-- 流水线 5 步 -->
          <div class="pipe">
            <div class="pstep" v-for="(s,i) in steps" :key="s">
              <span class="pdot">{{ i+1 }}</span>{{ s }}
            </div>
          </div>

          <!-- 每项目独立自动化（多项目并行）-->
          <div class="camp-auto" @click.stop>
            <div class="ca-line">
              <span class="ca-label">
                模式
                <el-tooltip placement="top">
                  <template #content>
                    手动：跑到「选题」停，你来采纳<br/>
                    半自动：自动采纳选题→生成草稿，停，你来审核发布<br/>
                    全自动：一路跑到自动发布，无人值守
                  </template>
                  <el-icon class="q"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
              <el-radio-group :model-value="c.runMode||'semi'" size="small" @change="(v)=>setMode(c,v)">
                <el-radio-button value="manual">手动</el-radio-button>
                <el-radio-button value="semi">半自动</el-radio-button>
                <el-radio-button value="auto">全自动</el-radio-button>
              </el-radio-group>
            </div>
            <div class="ca-line">
              <span class="ca-label">
                定时自动跑
                <el-tooltip placement="top">
                  <template #content>
                    开：按下方「设置」里的间隔，到点自动跑一轮（按上面的模式决定跑多远）<br/>
                    关：只在你点「立即跑」时运行一次
                  </template>
                  <el-icon class="q"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
              <el-switch size="small" :model-value="c.autopilotEnabled" :loading="toggling===c.id" @change="(v)=>toggleAuto(c.id,v)" />
              <el-button size="small" :icon="Setting" @click.stop="openAutoCfg(c)">设置</el-button>
              <el-tooltip :content="runHint(c.runMode)" placement="top">
                <el-button size="small" type="danger" plain @click.stop="runOnce(c.id)">立即跑</el-button>
              </el-tooltip>
              <el-button size="small" text @click.stop="showLogs(c.id)">日志</el-button>
            </div>
          </div>

          <div class="camp-foot">
            <el-button size="small" type="primary" plain :icon="Search" @click.stop="goCollect(c.id)">去采集</el-button>
            <el-button size="small" text :icon="Edit" @click.stop="openEdit(c)">编辑</el-button>
            <el-button size="small" text :icon="Histogram" @click.stop="openMixFor(c)">配比</el-button>
            <el-popconfirm title="删除该项目？" @confirm="store.remove(c.id)">
              <template #reference>
                <el-button size="small" text :icon="Delete" @click.stop>删除</el-button>
              </template>
            </el-popconfirm>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-alert v-if="store.list.length" type="success" :closable="false" show-icon style="margin-bottom:8px"
      title="两个旋钮：①「模式」决定流水线跑多远——手动停在选题/半自动停在草稿/全自动直接发布；②「定时自动跑」决定是否按间隔无人触发(关掉就只靠「立即跑」)。最常用：半自动+定时开=每天自动堆好草稿等你审。多项目各自独立、并行互不影响。" />

    <!-- 全自动设置：定时节奏 + 内容产量 + 发布节奏 -->
    <el-dialog v-model="autoCfgDialog" title="全自动设置（节奏与产量）" width="560px">
      <el-divider content-position="left">① 定时（多久自动跑一整轮）</el-divider>
      <el-form label-width="130px">
        <el-form-item label="整轮运行间隔(随机)">
          <span>从</span>
          <el-input-number v-model="acfg.minH" :min="0" :max="168" size="small" style="width:72px;margin:0 4px" /> 时
          <el-input-number v-model="acfg.minM" :min="0" :max="59" size="small" style="width:72px;margin:0 4px" /> 分
          <span style="margin:0 6px">到</span>
          <el-input-number v-model="acfg.maxH" :min="0" :max="168" size="small" style="width:72px;margin:0 4px" /> 时
          <el-input-number v-model="acfg.maxM" :min="0" :max="59" size="small" style="width:72px;margin:0 4px" /> 分
        </el-form-item>
        <el-form-item label="采集冷却">
          <el-input-number v-model="acfg.collectCooldownH" :min="0" :max="240" size="small" /> 小时
          <span class="muted" style="margin-left:8px">距上次采集不足此时长则跳过采集复用数据（0=每轮都采）</span>
        </el-form-item>

        <el-divider content-position="left">② 内容产量（每轮生成几篇草稿）</el-divider>
        <el-form-item label="每轮采纳选题">
          <el-input-number v-model="acfg.adoptMin" :min="1" :max="20" size="small" /> 到
          <el-input-number v-model="acfg.adoptMax" :min="1" :max="20" size="small" /> 个(随机)
        </el-form-item>
        <el-form-item label="每个选题生成">
          <el-input-number v-model="acfg.draftsPerTopic" :min="1" :max="5" size="small" /> 篇
        </el-form-item>

        <el-divider content-position="left">③ 发布节奏（仅「全自动」模式自动发布时生效）</el-divider>
        <el-form-item label="发布时段(拟人)">
          <el-switch v-model="acfg.windowOn" />
          <template v-if="acfg.windowOn">
            <span style="margin:0 6px">每天</span>
            <el-input-number v-model="acfg.windowStart" :min="0" :max="23" size="small" style="width:90px" /> 点
            <span style="margin:0 6px">到</span>
            <el-input-number v-model="acfg.windowEnd" :min="1" :max="24" size="small" style="width:90px" /> 点
          </template>
          <span v-else class="muted" style="margin-left:8px">关=全天可发</span>
        </el-form-item>
        <el-form-item label="每轮最多发布">
          <el-input-number v-model="acfg.perRunMax" :min="0" :max="50" size="small" /> 篇
          <span class="muted" style="margin-left:8px">0=不限（仍受各账号「每日上限」约束）</span>
        </el-form-item>
        <el-form-item label="每篇发布间隔(随机)">
          <el-input-number v-model="acfg.pubGapMin" :min="0" :max="600" size="small" style="width:90px" /> 到
          <el-input-number v-model="acfg.pubGapMax" :min="0" :max="600" size="small" style="width:90px" /> 分钟
        </el-form-item>
      </el-form>
      <p class="muted" style="margin:0">说明：整轮间隔=两次完整流水线之间；每篇发布间隔=同一轮连发多篇时每篇之间的等待（更像真人）。实际能发几篇还受每个发文号的「每日上限」限制（在「账号矩阵」里改）。</p>
      <template #footer>
        <el-button @click="autoCfgDialog=false">取消</el-button>
        <el-button type="danger" @click="saveAutoCfg">保存</el-button>
      </template>
    </el-dialog>

    <!-- 内容配比设置 -->
    <el-dialog v-model="mixDialog" title="内容配比设置" width="600px">
      <p class="muted" style="margin-top:0">设定每个主题的出帖占比；「植入比例」= 该主题里夹带产品种草的比例（种草主题=100%硬推）。占比按权重相对计算。</p>
      <el-table :data="mix" size="small">
        <el-table-column label="主题" width="140">
          <template #default="{ row }"><el-input v-model="row.type" size="small" /></template>
        </el-table-column>
        <el-table-column label="占比权重" width="150">
          <template #default="{ row }"><el-input-number v-model="row.weight" :min="0" :max="100" size="small" /></template>
        </el-table-column>
        <el-table-column label="植入比例 %" width="150">
          <template #default="{ row }"><el-input-number v-model="row.embedRate" :min="0" :max="100" size="small" /></template>
        </el-table-column>
        <el-table-column label="实际占比" width="90">
          <template #default="{ row }">{{ pct(row) }}</template>
        </el-table-column>
        <el-table-column width="50">
          <template #default="{ $index }"><el-button text :icon="Delete" @click="mix.splice($index,1)" /></template>
        </el-table-column>
      </el-table>
      <el-button size="small" :icon="Plus" @click="mix.push({type:'新主题',weight:10,embedRate:20})" style="margin-top:10px">加主题</el-button>
      <template #footer>
        <el-button @click="mixDialog=false">取消</el-button>
        <el-button type="danger" @click="saveMix">保存</el-button>
      </template>
    </el-dialog>

    <!-- 运行日志抽屉 -->
    <el-drawer v-model="logsDrawer" title="编排运行日志" size="42%">
      <el-button size="small" @click="loadLogs" style="margin-bottom:10px">刷新</el-button>
      <el-timeline>
        <el-timeline-item v-for="l in logs" :key="l.id" :timestamp="fmt(l.createdAt)"
          :type="l.status==='ok'?'success':l.status==='error'?'danger':'info'">
          <b>{{ stageText(l.stage) }}</b> · {{ l.status }}
          <div class="log-detail">{{ l.detail }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="!logs.length" description="还没有运行记录" :image-size="60" />
    </el-drawer>

    <!-- 新建/编辑项目对话框 -->
    <el-dialog v-model="dialog" :title="editId ? '编辑运营项目' : '新建运营项目'" width="560px">
      <!-- AI 智能生成（仅新建时） -->
      <div v-if="!editId" class="ai-box">
        <div class="ai-title">🤖 AI 智能生成（推荐）：一句话描述，自动生成关键词/玩法/人设</div>
        <el-input v-model="aiDesc" type="textarea" :rows="3" placeholder="例：产品是XX补水面膜，人群20-35岁女性，主打熬夜急救补水的睡眠面膜" />
        <el-button type="primary" size="small" :loading="aiGen" :icon="MagicStick" style="margin-top:8px" @click="aiSuggest">AI 生成配置</el-button>
        <span v-if="aiHint" class="ai-hint">{{ aiHint }}</span>
        <el-divider>或手动填写 ↓</el-divider>
      </div>
      <el-form :model="form" label-width="92px">
        <el-form-item label="项目名称"><el-input v-model="form.name" placeholder="如：面膜-补水种草" /></el-form-item>
        <el-form-item label="目标产品"><el-input v-model="form.productName" placeholder="写哪个产品，如：XX补水面膜" /></el-form-item>
        <el-form-item label="品牌名">
          <el-input v-model="form.brandName" placeholder="品牌名(导流用,如:你的品牌)。种草/植入文会自然提到品牌+产品名" />
        </el-form-item>
        <el-form-item label="绑定人设">
          <el-select v-model="form.personaId" clearable placeholder="选择人设（决定口吻+知识库）" style="width:100%">
            <el-option v-for="p in personas" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="采集关键词">
          <el-select v-model="form.keywords" multiple filterable allow-create default-first-option placeholder="抓什么，回车添加" style="width:100%" />
        </el-form-item>
        <el-form-item label="竞品账号">
          <el-select v-model="form.competitors" multiple filterable allow-create default-first-option placeholder="可选，竞品账号" style="width:100%" />
        </el-form-item>
        <el-form-item label="玩法">
          <el-select v-model="form.playbook" placeholder="选择玩法" style="width:100%">
            <el-option label="种草文" value="种草文" />
            <el-option label="测评文" value="测评文" />
            <el-option label="教程文" value="教程文" />
            <el-option label="对比文" value="对比文" />
          </el-select>
        </el-form-item>
        <el-form-item label="运行模式">
          <el-radio-group v-model="form.runMode">
            <el-radio-button value="manual">手动</el-radio-button>
            <el-radio-button value="semi">半自动</el-radio-button>
            <el-radio-button value="auto">全自动</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog=false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="save">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Search, Delete, MagicStick, Histogram, Edit, Setting, QuestionFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { apiService } from '@/services/ApiService'
import { useCampaignStore } from '@/stores/campaign'

const store = useCampaignStore()
const router = useRouter()
const steps = ['采集', '分析选题', '生成图文', '合规校验', '拟人发布']

// 全自动编排
const toggling = ref('')
const apStatus = ref({})
const logs = ref([])
const logsDrawer = ref(false)
const mixDialog = ref(false)
const mix = ref([])
const autoCfgDialog = ref(false)
const acfg = reactive({ minH: 23, minM: 50, maxH: 24, maxM: 30, adoptMin: 3, adoptMax: 5, draftsPerTopic: 1, collectCooldownH: 20, perRunMax: 0, pubGapMin: 3, pubGapMax: 15, windowOn: false, windowStart: 8, windowEnd: 23 })
const DEFAULT_MIX = [
  { type: '养生', weight: 35, embedRate: 30 },
  { type: '干货', weight: 25, embedRate: 20 },
  { type: '小孩', weight: 20, embedRate: 20 },
  { type: '种草', weight: 20, embedRate: 100 },
]
let pollTimer = null

function fmt(s) { return s ? new Date(s).toLocaleString('zh-CN') : '' }
function stageText(s) { return { collect: '采集', synthesize: '知识沉淀', analysis: '分析', generate: '生成', publish: '发布', done: '完成', error: '错误' }[s] || s }

async function loadStatus() {
  if (!store.currentId) return
  apStatus.value = await apiService.autopilot.status(store.currentId)
}
function pct(row) {
  const total = mix.value.reduce((s, m) => s + (Number(m.weight) || 0), 0) || 1
  return Math.round(((Number(row.weight) || 0) / total) * 100) + '%'
}
function openMix() {
  const c = store.current()
  const cm = c && c.cadence && c.cadence.contentMix
  mix.value = Array.isArray(cm) && cm.length ? JSON.parse(JSON.stringify(cm)) : JSON.parse(JSON.stringify(DEFAULT_MIX))
  mixDialog.value = true
}
async function saveMix() {
  const c = store.current()
  const cadence = { ...((c && c.cadence) || {}), contentMix: mix.value }
  await apiService.campaigns.update(store.currentId, { cadence })
  await store.refresh()
  mixDialog.value = false
  ElMessage.success('内容配比已保存')
}
async function loadLogs() {
  if (!store.currentId) return
  logs.value = await apiService.autopilot.logs(store.currentId)
}
const MODE_HINT = {
  manual: '：自动采集分析后停在选题，等你采纳',
  semi: '：自动到生成草稿后停，等你审核发布',
  auto: '：一路自动发布，无人值守',
}
async function setMode(c, v) {
  try {
    await apiService.campaigns.update(c.id, { runMode: v })
    await store.refresh()
    ElMessage.success('已切换为「' + modeText(v) + '」' + (MODE_HINT[v] || ''))
  } catch (e) { ElMessage.error('切换失败：' + (e?.message || '')) }
}
async function toggleAuto(id, v) {
  toggling.value = id
  try {
    await apiService.autopilot.toggle(id, v)
    await store.refresh()
    ElMessage.success(v ? '已开启全自动（按节奏定时运行）' : '已关闭全自动')
  } catch (e) { ElMessage.error('操作失败') } finally { toggling.value = '' }
}
function openAutoCfg(c) {
  store.setCurrent(c.id)
  const cad = c.cadence || {}
  const minM = cad.intervalMinMinutes ?? 1430
  const maxM = cad.intervalMaxMinutes ?? 1490
  Object.assign(acfg, {
    minH: Math.floor(minM / 60), minM: minM % 60,
    maxH: Math.floor(maxM / 60), maxM: maxM % 60,
    adoptMin: cad.adoptMin || 3, adoptMax: cad.adoptMax || 5,
    draftsPerTopic: cad.draftsPerTopic || 1,
    collectCooldownH: cad.collectCooldownHours ?? 20,
    perRunMax: cad.publishPerRunMax ?? 0,
    pubGapMin: cad.publishGapMinMinutes ?? 3,
    pubGapMax: cad.publishGapMaxMinutes ?? 15,
    windowOn: !!cad.pubWindowOn,
    windowStart: cad.pubWindowStart ?? 8,
    windowEnd: cad.pubWindowEnd ?? 23,
  })
  autoCfgDialog.value = true
}
async function saveAutoCfg() {
  const c = store.current()
  const cadence = {
    ...((c && c.cadence) || {}),
    intervalMinMinutes: acfg.minH * 60 + acfg.minM,
    intervalMaxMinutes: acfg.maxH * 60 + acfg.maxM,
    adoptMin: acfg.adoptMin, adoptMax: Math.max(acfg.adoptMax, acfg.adoptMin),
    draftsPerTopic: acfg.draftsPerTopic,
    collectCooldownHours: acfg.collectCooldownH,
    publishPerRunMax: acfg.perRunMax,
    publishGapMinMinutes: acfg.pubGapMin,
    publishGapMaxMinutes: Math.max(acfg.pubGapMax, acfg.pubGapMin),
    pubWindowOn: acfg.windowOn,
    pubWindowStart: acfg.windowStart,
    pubWindowEnd: Math.max(acfg.windowEnd, acfg.windowStart + 1),
  }
  await apiService.campaigns.update(store.currentId, { cadence })
  await store.refresh()
  autoCfgDialog.value = false
  ElMessage.success('全自动设置已保存')
}
async function runOnce(id) {
  try {
    const r = await apiService.autopilot.runOnce(id)
    ElMessage[r.started ? 'success' : 'warning'](r.message)
    showLogs(id)
  } catch (e) { ElMessage.error('启动失败：' + (e?.message || '')) }
}
async function showLogs(id) {
  store.setCurrent(id)
  await loadLogs()
  logsDrawer.value = true
  startPoll()
}
function openMixFor(c) {
  store.setCurrent(c.id)
  const cm = c.cadence && c.cadence.contentMix
  mix.value = Array.isArray(cm) && cm.length ? JSON.parse(JSON.stringify(cm)) : JSON.parse(JSON.stringify(DEFAULT_MIX))
  mixDialog.value = true
}
function startPoll() {
  stopPoll()
  pollTimer = setInterval(async () => {
    await Promise.all([loadStatus(), loadLogs()])
    if (!apStatus.value.running) stopPoll()
  }, 3000)
}
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

const dialog = ref(false)
const saving = ref(false)
const editId = ref('')
const personas = ref([])
const aiDesc = ref('')
const aiGen = ref(false)
const aiHint = ref('')
const form = reactive({ name: '', productName: '', brandName: '', personaId: '', keywords: [], competitors: [], playbook: '种草文', runMode: 'semi' })

function modeText(m) { return { manual: '手动', semi: '半自动', auto: '全自动' }[m] || m }
function runHint(m) {
  return {
    manual: '立即跑：按【手动】跑到「选题」停，等你采纳',
    semi: '立即跑：按【半自动】跑到「草稿」停，等你审核发布',
    auto: '立即跑：按【全自动】一路跑到自动发布',
  }[m || 'semi']
}
function modeTag(m) { return { manual: 'info', semi: 'warning', auto: 'success' }[m] || 'info' }

async function openCreate() {
  editId.value = ''
  aiDesc.value = ''; aiHint.value = ''
  Object.assign(form, { name: '', productName: '', brandName: '', personaId: '', keywords: [], competitors: [], playbook: '种草文', runMode: 'semi' })
  try { personas.value = await apiService.personas.list() } catch (e) { personas.value = [] }
  dialog.value = true
}
async function aiSuggest() {
  if (!aiDesc.value.trim()) return ElMessage.warning('请先描述你的产品/人群/卖点')
  aiGen.value = true; aiHint.value = ''
  try {
    const s = await apiService.campaigns.aiSuggest(aiDesc.value)
    Object.assign(form, {
      name: s.name, productName: s.productName, keywords: s.keywords || [],
      competitors: s.competitors || [], playbook: s.playbook || '种草文',
      runMode: s.runMode || 'semi', personaId: s.personaId || form.personaId,
    })
    aiHint.value = '✅ 已生成，可在下方微调后创建' + (s.personaReason ? `（人设：${s.personaReason}）` : '')
    ElMessage.success('AI 配置已生成')
  } catch (e) {
    ElMessage.error('生成失败：' + (e?.message || ''))
  } finally { aiGen.value = false }
}
async function openEdit(c) {
  editId.value = c.id
  Object.assign(form, {
    name: c.name || '', productName: c.productName || '', brandName: (c.cadence && c.cadence.brandName) || '',
    personaId: c.personaId || '',
    keywords: c.keywords || [], competitors: c.competitors || [],
    playbook: c.playbook || '种草文', runMode: c.runMode || 'semi',
  })
  try { personas.value = await apiService.personas.list() } catch (e) { personas.value = [] }
  dialog.value = true
}
async function save() {
  if (!form.name) return ElMessage.warning('请填项目名称')
  saving.value = true
  try {
    const { brandName, ...rest } = form
    if (editId.value) {
      const cur = store.list.find((c) => c.id === editId.value)
      const cadence = { ...((cur && cur.cadence) || {}), brandName }
      await apiService.campaigns.update(editId.value, { ...rest, cadence })
      await store.refresh()
      ElMessage.success('项目已更新')
    } else {
      await store.create({ ...rest, cadence: { brandName } })
      ElMessage.success('项目已创建')
    }
    dialog.value = false
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || ''))
  } finally {
    saving.value = false
  }
}
function goCollect(id) {
  store.setCurrent(id)
  router.push('/collect')
}

watch(() => store.currentId, () => { loadStatus(); loadLogs() })
onMounted(async () => { await store.refresh(); await loadStatus(); await loadLogs() })
</script>

<style scoped>
.autopilot { max-width: 1080px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.ph-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 20px; }
.ph-sub { color: #888; margin: 6px 0 0; font-size: 13px; }
.camp { cursor: pointer; transition: all .15s; }
.camp.active { border: 1.5px solid #ff2442; }
.camp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.camp-name { font-weight: 600; font-size: 16px; }
.camp-row { font-size: 13px; color: #555; margin: 6px 0; }
.camp-row .k { display: inline-block; width: 48px; color: #999; }
.kw { margin-right: 4px; }
.muted { color: #bbb; }
.pipe { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 12px 0; padding-top: 10px; border-top: 1px dashed #eee; }
.pstep { font-size: 12px; color: #888; display: flex; align-items: center; gap: 4px; }
.pdot { width: 18px; height: 18px; border-radius: 50%; background: #f0f0f0; color: #999; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
.camp-auto { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; padding: 8px; background: #fafafa; border-radius: 6px; font-size: 12px; color: #666; }
.ca-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ca-label { display: inline-flex; align-items: center; gap: 3px; min-width: 64px; color: #666; }
.ca-line .q { font-size: 13px; color: #bbb; cursor: help; }
.ca-item { display: flex; align-items: center; gap: 4px; }
.camp-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.auto-bar { margin-top: 8px; }
.auto-bar :deep(.el-card__body) { display: flex; justify-content: space-between; align-items: center; }
.auto-left { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.auto-right { display: flex; align-items: center; gap: 18px; }
.ctl { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #666; }
.log-detail { color: #888; font-size: 12px; margin-top: 4px; word-break: break-all; }
.ai-box { background: #fff7f8; border: 1px solid #ffe0e5; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.ai-title { font-size: 13px; color: #ff2442; margin-bottom: 8px; font-weight: 600; }
.ai-hint { font-size: 12px; color: #67c23a; margin-left: 10px; }
</style>
