import axios from 'axios'

// 关键：baseURL 用相对路径 '/api/v1'，浏览器从任意局域网 IP 访问都指向同源后端。
// 切勿写死 http://localhost:xxxx（否则别人从其他 IP 进来会连不上）。
const http = axios.create({
  baseURL: '/api/v1',
  timeout: 60000,
})

export const apiService = {
  health: () => http.get('/health').then((r) => r.data),

  // 运营项目
  campaigns: {
    list: () => http.get('/campaigns').then((r) => r.data),
    get: (id) => http.get(`/campaigns/${id}`).then((r) => r.data),
    create: (data) => http.post('/campaigns', data).then((r) => r.data),
    aiSuggest: (description) => http.post('/campaigns/ai-suggest', { description }, { timeout: 90000 }).then((r) => r.data),
    update: (id, data) => http.patch(`/campaigns/${id}`, data).then((r) => r.data),
    remove: (id) => http.delete(`/campaigns/${id}`).then((r) => r.data),
  },

  // 分析（评论痛点聚类 + 选题候选）
  analysis: {
    run: (campaignId) => http.post('/analysis/run', { campaignId }).then((r) => r.data),
    insights: (campaignId) => http.get('/analysis/insights', { params: { campaignId } }).then((r) => r.data),
    topics: (campaignId) => http.get('/analysis/topics', { params: { campaignId } }).then((r) => r.data),
    updateTopic: (id, status) => http.patch(`/analysis/topics/${id}`, { status }).then((r) => r.data),
    importPains: (campaignId, text) => http.post('/analysis/import-pains', { campaignId, text }).then((r) => r.data),
    samples: (ids) => http.post('/analysis/samples', { ids }).then((r) => r.data),
  },

  // 采集
  collect: {
    run: (campaignId) => http.post('/collect/run', { campaignId }, { timeout: 300000 }).then((r) => r.data),
    clear: (campaignId) => http.post('/collect/clear', { campaignId }).then((r) => r.data),
    tasks: (campaignId) => http.get('/collect/tasks', { params: { campaignId } }).then((r) => r.data),
    notes: (campaignId) => http.get('/collect/notes', { params: { campaignId } }).then((r) => r.data),
    comments: (noteId) => http.get(`/collect/notes/${noteId}/comments`).then((r) => r.data),
  },

  // 账号矩阵
  accounts: {
    list: () => http.get('/accounts').then((r) => r.data),
    create: (data) => http.post('/accounts', data).then((r) => r.data),
    update: (id, data) => http.patch(`/accounts/${id}`, data).then((r) => r.data),
    remove: (id) => http.delete(`/accounts/${id}`).then((r) => r.data),
  },

  // 发布（patchright 隐身浏览器）
  publish: {
    login: (accountId) => http.post(`/publish/login/${accountId}`, {}, { timeout: 150000 }).then((r) => r.data),
    check: (accountId) => http.post(`/publish/check/${accountId}`, {}, { timeout: 60000 }).then((r) => r.data),
    draft: (draftId, accountId, holdForManual) => http.post('/publish/draft', { draftId, accountId, holdForManual }, { timeout: 300000 }).then((r) => r.data),
    markDone: (draftId, accountId) => http.post('/publish/mark-done', { draftId, accountId }).then((r) => r.data),
    release: (accountId) => http.post(`/publish/release/${accountId}`).then((r) => r.data),
    jobs: (campaignId) => http.get('/publish/jobs', { params: { campaignId } }).then((r) => r.data),
  },

  // 图库（上传素材）
  materials: {
    list: (campaignId) => http.get('/materials', { params: { campaignId } }).then((r) => r.data),
    upload: (file, campaignId) => {
      const fd = new FormData()
      fd.append('file', file)
      if (campaignId) fd.append('campaignId', campaignId)
      return http.post('/materials', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
    },
    remove: (id) => http.delete(`/materials/${id}`).then((r) => r.data),
    // 测试/预览局域网文件夹（user/pass 可选，密码不入库）
    testFolder: (dir, user, pass) =>
      http.post('/materials/folder/test', { dir, user, pass }).then((r) => r.data),
  },

  // 人设
  personas: {
    list: () => http.get('/personas').then((r) => r.data),
    create: (data) => http.post('/personas', data).then((r) => r.data),
    update: (id, data) => http.patch(`/personas/${id}`, data).then((r) => r.data),
    remove: (id) => http.delete(`/personas/${id}`).then((r) => r.data),
  },

  // 知识库 Wiki
  wiki: {
    spaces: () => http.get('/wiki/spaces').then((r) => r.data),
    createSpace: (data) => http.post('/wiki/spaces', data).then((r) => r.data),
    removeSpace: (id) => http.delete(`/wiki/spaces/${id}`).then((r) => r.data),
    tree: (spaceId) => http.get(`/wiki/spaces/${spaceId}/tree`).then((r) => r.data),
    page: (id) => http.get(`/wiki/pages/${id}`).then((r) => r.data),
    createPage: (data) => http.post('/wiki/pages', data).then((r) => r.data),
    updatePage: (id, data) => http.patch(`/wiki/pages/${id}`, data).then((r) => r.data),
    removePage: (id) => http.delete(`/wiki/pages/${id}`).then((r) => r.data),
    synthesize: (spaceId, sourceText, sourceLabel) =>
      http.post('/wiki/synthesize', { spaceId, sourceText, sourceLabel }).then((r) => r.data),
    synthFromCampaign: (spaceId, campaignId) =>
      http.post('/wiki/synthesize-from-campaign', { spaceId, campaignId }).then((r) => r.data),
  },

  // 生成（文案草稿）
  generate: {
    fromTopic: (topicId, theme, embedProduct) => http.post('/generate/from-topic', { topicId, theme, embedProduct }).then((r) => r.data),
    drafts: (campaignId) => http.get('/generate/drafts', { params: { campaignId } }).then((r) => r.data),
    repair: (campaignId) => http.post('/generate/repair', { campaignId }).then((r) => r.data),
    update: (id, data) => http.patch(`/generate/drafts/${id}`, data).then((r) => r.data),
    remove: (id) => http.delete(`/generate/drafts/${id}`).then((r) => r.data),
    image: (id, prompt, aspectRatio, count, source) => http.post(`/generate/drafts/${id}/image`, { prompt, aspectRatio, count, source }, { timeout: 240000 }).then((r) => r.data),
    pickImages: (id, picks, aspectRatio) => http.post(`/generate/drafts/${id}/pick-images`, { picks, aspectRatio }, { timeout: 120000 }).then((r) => r.data),
  },

  // 设置 + LLM 多供应商网关
  settings: {
    get: (group) => http.get(`/settings/${group}`).then((r) => r.data),
    put: (group, data) => http.put(`/settings/${group}`, data).then((r) => r.data),
    getLan: () => http.get('/settings/system/lan').then((r) => r.data),
    getAutoLaunch: () => http.get('/settings/system/autolaunch').then((r) => r.data),
    setAutoLaunch: (enabled) => http.put('/settings/system/autolaunch', { enabled }).then((r) => r.data),
  },
  // 模型网关（供应商→协议→地址密钥→模型；文/图统一）
  gateway: {
    templates: () => http.get('/gateway/templates').then((r) => r.data),
    providers: () => http.get('/gateway/providers').then((r) => r.data),
    createProvider: (data) => http.post('/gateway/providers', data).then((r) => r.data),
    updateProvider: (id, data) => http.patch(`/gateway/providers/${id}`, data).then((r) => r.data),
    removeProvider: (id) => http.delete(`/gateway/providers/${id}`).then((r) => r.data),
    addModel: (providerId, modelName, modelType) =>
      http.post('/gateway/models', { providerId, modelName, modelType }).then((r) => r.data),
    removeModel: (id) => http.delete(`/gateway/models/${id}`).then((r) => r.data),
    active: () => http.get('/gateway/active').then((r) => r.data),
    setActive: (field, modelId) => http.put('/gateway/active', { field, modelId }).then((r) => r.data),
    test: (modelId) => http.post('/gateway/test', { modelId }).then((r) => r.data),
    image: (prompt, modelId) => http.post('/gateway/image', { prompt, modelId }).then((r) => r.data),
  },

  // 全自动编排
  autopilot: {
    runOnce: (campaignId) => http.post(`/autopilot/run-once/${campaignId}`).then((r) => r.data),
    toggle: (campaignId, enabled) => http.put(`/autopilot/toggle/${campaignId}`, { enabled }).then((r) => r.data),
    status: (campaignId) => http.get('/autopilot/status', { params: { campaignId } }).then((r) => r.data),
    logs: (campaignId) => http.get('/autopilot/logs', { params: { campaignId } }).then((r) => r.data),
  },

  raw: http,
}
