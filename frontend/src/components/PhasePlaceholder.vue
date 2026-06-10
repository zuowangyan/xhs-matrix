<template>
  <el-card shadow="never" class="ph">
    <div class="ph-icon"><el-icon :size="40"><component :is="icon" /></el-icon></div>
    <h2>{{ title }}</h2>
    <p class="phase">{{ phase }}</p>
    <p class="desc">{{ desc }}</p>
    <el-tag type="info" effect="plain">P0 脚手架占位 · 待实现</el-tag>
  </el-card>
</template>

<script setup>
defineProps({
  title: String,
  phase: String,
  desc: String,
  icon: { type: String, default: 'Document' },
})
</script>

<style scoped>
.ph { max-width: 640px; margin: 40px auto; text-align: center; padding: 30px; }
.ph-icon { color: #ff2442; margin-bottom: 10px; }
.phase { color: #ff2442; font-weight: 600; margin: 4px 0; }
.desc { color: #666; line-height: 1.7; margin: 12px 0 20px; }
</style>
