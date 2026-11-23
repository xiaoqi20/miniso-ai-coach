import { createApp } from 'vue'
import App from '@/App.vue'
import '@/assets/main.css'
import { createAppRouter } from '@/router'

/**
 * 前端应用入口：初始化 Vue 3 实例与统一路由守卫。
 */
const app = createApp(App)
const router = createAppRouter()

app.use(router)
app.mount('#app')
