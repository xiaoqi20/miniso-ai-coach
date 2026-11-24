import { createApp } from 'vue'
import App from '@/App.vue'
import '@/assets/main.css'
import { createAppRouter } from '@/router'
import { applyRuntimeDocumentAttributes } from '@/utils/runtime'

/**
 * 前端应用入口：初始化运行时属性（H5 / 企业微信预留）、Vue 3 实例与统一路由守卫。
 */
applyRuntimeDocumentAttributes()
const app = createApp(App)
const router = createAppRouter()

app.use(router)
app.mount('#app')
