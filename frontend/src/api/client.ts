import axios from 'axios'

/**
 * 统一 HTTP 客户端。
 * - 金额在后端以字符串序列化，前端不做浮点运算
 * - 401 由路由守卫统一处理，这里不跳转
 */
export const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const payload = error.response?.data
    const message = payload?.message || error.message || '请求失败'
    return Promise.reject(Object.assign(new Error(message), { payload }))
  },
)

export default http
