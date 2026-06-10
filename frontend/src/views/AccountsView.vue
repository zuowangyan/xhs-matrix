<template>
  <div class="accounts">
    <div class="head">
      <span class="muted">发文号在这里管理：添加 → 扫码登录 → 绑定到项目发布。直连方案建议单 IP ≤ 2-3 个发文号。</span>
      <el-button type="danger" :icon="Plus" @click="openAdd">添加账号</el-button>
    </div>

    <el-empty v-if="!accounts.length" description="还没有账号，点「添加账号」" />

    <el-row :gutter="16">
      <el-col v-for="a in accounts" :key="a.id" :span="8" style="margin-bottom:16px">
        <el-card shadow="hover">
          <div class="a-head">
            <span class="a-name">{{ a.nickname }}</span>
            <el-tag size="small" :type="statusTag(a.status)">{{ statusText(a.status) }}</el-tag>
          </div>
          <div class="a-row">角色：{{ a.role === 'publisher' ? '发文号' : '采集号' }}</div>
          <div class="a-row">今日已发：{{ a.publishedToday }} / {{ a.dailyQuota }} 篇</div>
          <div class="a-row">养号度：{{ a.warmupLevel }}/100</div>
          <div class="a-foot">
            <el-button size="small" type="primary" plain :loading="busyId===a.id" @click="login(a)">
              {{ a.hasCookie ? '重新登录' : '扫码登录' }}
            </el-button>
            <el-button size="small" :icon="Edit" @click="openEdit(a)">编辑</el-button>
            <el-button size="small" :loading="checkId===a.id" @click="check(a)">校验</el-button>
            <el-popconfirm title="删除该账号？" @confirm="del(a.id)">
              <template #reference><el-button size="small" text>删</el-button></template>
            </el-popconfirm>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dialog" :title="editId ? '编辑账号（养号设置）' : '添加账号'" width="480px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="昵称/备注"><el-input v-model="form.nickname" placeholder="如 发文号1" /></el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role" :disabled="!!editId">
            <el-radio-button value="publisher">发文号</el-radio-button>
            <el-radio-button value="collector">采集号</el-radio-button>
          </el-radio-group>
          <span v-if="editId" class="muted" style="margin-left:8px">角色不可改</span>
        </el-form-item>
        <el-form-item label="每日发布上限">
          <el-input-number v-model="form.dailyQuota" :min="1" :max="30" />
          <span class="muted" style="margin-left:8px">该号一天最多发几篇（全自动按它约束）</span>
        </el-form-item>
        <el-form-item v-if="editId" label="养号度">
          <el-input-number v-model="form.warmupLevel" :min="0" :max="100" />
          <span class="muted" style="margin-left:8px">0-100，新号建议先低量养，成熟了再加上限</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog=false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="save">{{ editId ? '保存' : '创建（自动生成独立指纹）' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { Plus, Edit } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiService } from '@/services/ApiService'

const accounts = ref([])
const dialog = ref(false)
const saving = ref(false)
const busyId = ref('')
const checkId = ref('')
const editId = ref('')
const form = reactive({ nickname: '', role: 'publisher', dailyQuota: 2, warmupLevel: 0 })

function statusText(s) { return { active: '已登录', login_required: '待登录', cooldown: '冷却中', banned: '已封禁' }[s] || s }
function statusTag(s) { return { active: 'success', login_required: 'info', cooldown: 'warning', banned: 'danger' }[s] || 'info' }

async function load() { accounts.value = await apiService.accounts.list() }
function openAdd() { editId.value = ''; Object.assign(form, { nickname: '', role: 'publisher', dailyQuota: 2, warmupLevel: 0 }); dialog.value = true }
function openEdit(a) {
  editId.value = a.id
  Object.assign(form, { nickname: a.nickname, role: a.role, dailyQuota: a.dailyQuota, warmupLevel: a.warmupLevel })
  dialog.value = true
}
async function save() {
  if (!form.nickname) return ElMessage.warning('请填昵称')
  saving.value = true
  try {
    if (editId.value) {
      await apiService.accounts.update(editId.value, { nickname: form.nickname, dailyQuota: form.dailyQuota, warmupLevel: form.warmupLevel })
      ElMessage.success('已保存')
    } else {
      await apiService.accounts.create({ ...form })
      ElMessage.success('已创建')
    }
    dialog.value = false; await load()
  }
  catch (e) { ElMessage.error((editId.value ? '保存' : '创建') + '失败') } finally { saving.value = false }
}
async function login(a) {
  busyId.value = a.id
  ElMessageBox.alert('即将弹出隐身浏览器，请用小红书 App 扫码登录（120秒内）。登录成功后窗口自动关闭。', '扫码登录', { confirmButtonText: '我知道了' })
  try {
    const r = await apiService.publish.login(a.id)
    if (r.ok) ElMessage.success(r.message); else ElMessage.warning(r.message)
    await load()
  } catch (e) { ElMessage.error('登录失败：' + (e?.message || '')) } finally { busyId.value = '' }
}
async function check(a) {
  checkId.value = a.id
  try { const r = await apiService.publish.check(a.id); ElMessage[r.ok ? 'success' : 'warning'](r.ok ? '登录态有效' : '登录态失效，请重新登录'); await load() }
  catch (e) { ElMessage.error('校验失败') } finally { checkId.value = '' }
}
async function del(id) { await apiService.accounts.remove(id); await load() }

onMounted(load)
</script>

<style scoped>
.accounts { max-width: 1080px; }
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.head .el-button { margin-left: auto; }
.muted { color: #999; font-size: 13px; }
.a-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.a-name { font-weight: 600; font-size: 16px; }
.a-row { font-size: 13px; color: #555; margin: 4px 0; }
.a-foot { display: flex; gap: 6px; align-items: center; margin-top: 10px; }
</style>
