<script setup lang="ts">
import { ref } from 'vue'

const serviceStatus = ref<'unknown' | 'up' | 'down'>('unknown')
</script>

<template>
  <div class="page">
    <h1>CoolPilotX</h1>
    <p class="subtitle">企业融资准备与分析系统 · 工作台</p>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="工程骨架已就绪，业务页面待实现"
      description="当前仅有目录与模块边界。功能按 CPX-01 ~ CPX-06 逐步交付，见 docs/tasks/mvp-scope.md。"
    />

    <el-descriptions class="panel" title="服务状态" :column="2" border>
      <el-descriptions-item label="后端">待接入</el-descriptions-item>
      <el-descriptions-item label="AI 服务">待接入</el-descriptions-item>
      <el-descriptions-item label="状态">{{ serviceStatus }}</el-descriptions-item>
      <el-descriptions-item label="版本">0.1.0-SNAPSHOT</el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
}
h1 {
  font-size: 20px;
  font-weight: 500;
  margin: 0 0 4px;
}
.subtitle {
  font-size: 13px;
  color: #6b7c93;
  margin: 0 0 20px;
}
.panel {
  margin-top: 20px;
}
</style>
