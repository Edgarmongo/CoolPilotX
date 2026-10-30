import { createRouter, createWebHistory } from 'vue-router'

/**
 * 路由按业务域分组，与后端模块一一对应。
 * 未实现的页面先不注册，避免构建期引用空文件。
 */
const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/dashboard/DashboardView.vue'),
    meta: { title: '工作台' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
