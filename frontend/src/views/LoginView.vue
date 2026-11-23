<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError, getApiMode } from '@/api/client'
import AppShellMobile from '@/components/AppShellMobile.vue'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'
import { resetMockState } from '@/mock/server'
import { DEV_USERS, type MockUserSeed } from '@/mock/seed'
import type { UserRole } from '@/types/api'
import { homeRouteForRole, roleDisplayName } from '@/utils/assignment'

/**
 * 引导与开发身份选择页（1:1 复刻 static/index.html #screen-onboarding 原型视觉与交互）。
 * 包含 MINISO 品牌漂浮动画背景、三页价值轮播、横向 3D 角色卡片轮播、开发用户胶囊选择，
 * 登录仍严格通过 POST /api/v1/auth/dev-login 换取服务端 HttpOnly 会话 Cookie。
 */

interface RoleWheelGroup {
  id: string
  role: UserRole
  wheelTitle: string
  wheelDesc: string
  wheelCaps: string[]
  users: MockUserSeed[]
}

const SLIDES = [
  {
    tag: '01 渐进微课',
    title: '3 分钟吃透爆款卖点',
    desc: '核心卖点、黄金陈列与收银连带拆解为渐进章节，早会碎片时间高效学完。',
  },
  {
    tag: '02 情景对练',
    title: '拟人顾客实战对练陪跑',
    desc: '围绕价格顾虑与换问法复练，提交文字应答即刻核验必考事实与话术红线。',
  },
  {
    tag: '03 四维雷达评估',
    title: '量化短板与补训闭环',
    desc: '从卖点、异议、连带、亲和四维精准评分，店长靶向补训与复查形成培训闭环。',
  },
] as const

const ROLE_GROUPS: RoleWheelGroup[] = [
  {
    id: 'staff_beijing',
    role: 'staff',
    wheelTitle: '门店员工 · 北京路',
    wheelDesc: '目标门店导购：接收总部品类任务并学练',
    wheelCaps: ['目标门店', '学练打卡'],
    users: DEV_USERS.filter(
      (u) => u.role === 'staff' && u.stores[0]?.id === 'store_bj',
    ),
  },
  {
    id: 'staff_foshan',
    role: 'staff',
    wheelTitle: '门店员工 · 佛山祖庙',
    wheelDesc: '对照门店导购：校验草稿与未下发品隔离',
    wheelCaps: ['对照门店', '隔离校验'],
    users: DEV_USERS.filter(
      (u) => u.role === 'staff' && u.stores[0]?.id === 'store_fs',
    ),
  },
  {
    id: 'store_mgr',
    role: 'store_manager',
    wheelTitle: '门店店长 · 北京路',
    wheelDesc: '看员工卡点，发起补训并复查结果',
    wheelCaps: ['卡点追踪', '补训复查'],
    users: DEV_USERS.filter((u) => u.role === 'store_manager'),
  },
  {
    id: 'hq_ops',
    role: 'hq_ops',
    wheelTitle: '总部培训运营',
    wheelDesc: '录入审校新品，指定门店与截止时间',
    wheelCaps: ['审校发布', 'PC 工作台'],
    users: DEV_USERS.filter((u) => u.role === 'hq_ops'),
  },
]

const route = useRoute()
const router = useRouter()
const { user, loginWithDevUser, logoutSession, loading } = useSession()
const { showToast } = useToast()

const apiMode = getApiMode()
const currentSlide = shallowRef(0)
const roleWheelIndex = shallowRef(0)
const selectedUserIdByGroup = shallowRef<Record<string, string>>({
  staff_beijing: 'usr_linxiaomei',
  staff_foshan: 'usr_zhoulin',
  store_mgr: 'usr_liming',
  hq_ops: 'usr_linmin',
})
const errorText = shallowRef('')

/** 拖拽滑动辅助状态（非视图响应式状态，避免无谓重渲染） */
let slideTimer: ReturnType<typeof setInterval> | null = null
let dragStartX: number | null = null
let suppressClick = false
let wheelLockMs = 0

const activeSlide = computed(() => SLIDES[currentSlide.value] ?? SLIDES[0])
const activeGroup = computed(() => ROLE_GROUPS[roleWheelIndex.value] ?? ROLE_GROUPS[0])
const activeUserId = computed(
  () =>
    selectedUserIdByGroup.value[activeGroup.value.id] ??
    activeGroup.value.users[0]?.id ??
    '',
)
const activeUserSeed = computed(() =>
  activeGroup.value.users.find((u) => u.id === activeUserId.value) ??
  activeGroup.value.users[0],
)

const wheelCardPositions = computed(() => {
  const n = ROLE_GROUPS.length
  const leftIdx = (roleWheelIndex.value - 1 + n) % n
  const rightIdx = (roleWheelIndex.value + 1) % n
  return ROLE_GROUPS.map((_, idx) => {
    if (idx === roleWheelIndex.value) return 'pos-center'
    if (idx === leftIdx) return 'pos-left'
    if (idx === rightIdx) return 'pos-right'
    return 'pos-back'
  })
})

function startSlideAutoPlay(): void {
  if (slideTimer !== null) clearInterval(slideTimer)
  slideTimer = setInterval(() => {
    currentSlide.value = (currentSlide.value + 1) % SLIDES.length
  }, 4200)
}

function setSlide(idx: number): void {
  currentSlide.value = idx
  startSlideAutoPlay()
}

function setRoleWheelIndex(idx: number): void {
  if (idx === roleWheelIndex.value) return
  roleWheelIndex.value = idx
  errorText.value = ''
}

function stepRoleWheel(delta: number): void {
  const n = ROLE_GROUPS.length
  roleWheelIndex.value = (roleWheelIndex.value + (delta > 0 ? 1 : -1) + n) % n
  errorText.value = ''
}

function onWheelCardClick(idx: number): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  setRoleWheelIndex(idx)
}

function selectUserInGroup(userId: string): void {
  selectedUserIdByGroup.value = {
    ...selectedUserIdByGroup.value,
    [activeGroup.value.id]: userId,
  }
}

function onWheelScroll(e: WheelEvent): void {
  const now = Date.now()
  if (now - wheelLockMs < 200) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (Math.abs(delta) < 4) return
  wheelLockMs = now
  stepRoleWheel(delta > 0 ? 1 : -1)
}

function onPointerStart(clientX: number): void {
  dragStartX = clientX
}

function onPointerMove(clientX: number): void {
  if (dragStartX === null) return
  const dx = dragStartX - clientX
  if (Math.abs(dx) >= 34) {
    suppressClick = true
    stepRoleWheel(dx > 0 ? 1 : -1)
    dragStartX = clientX
  }
}

function onPointerEnd(): void {
  dragStartX = null
  setTimeout(() => {
    suppressClick = false
  }, 40)
}

async function handleLogin(): Promise<void> {
  const uid = activeUserId.value
  if (!uid) return
  errorText.value = ''
  try {
    const loggedInUser = await loginWithDevUser(uid)
    showToast(`已登录为「${loggedInUser.name}」`)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    const targetHome = homeRouteForRole(loggedInUser.role)
    if (redirect && redirect.startsWith(targetHome)) {
      await router.replace(redirect)
      return
    }
    await router.replace(targetHome)
  } catch (err) {
    if (err instanceof ApiClientError) {
      errorText.value = `${err.message}（${err.code}）`
    } else {
      errorText.value = '登录失败，请检查服务端连接状态'
    }
  }
}

async function handleContinueCurrent(): Promise<void> {
  if (!user.value) return
  await router.push(homeRouteForRole(user.value.role))
}

async function handleLogoutOnly(): Promise<void> {
  await logoutSession()
  showToast('已退出当前服务端会话')
}

function handleResetMock(): void {
  resetMockState()
  showToast('已重置本地 Mock 测试数据到初始状态')
}

onMounted(() => {
  startSlideAutoPlay()
})

onUnmounted(() => {
  if (slideTimer !== null) {
    clearInterval(slideTimer)
    slideTimer = null
  }
})
</script>

<template>
  <AppShellMobile status-theme="dark">
    <div class="onboarding-screen">
      <!-- MINISO 品牌背景动画层（与原型完全一致） -->
      <div class="miniso-bg-motion" aria-hidden="true">
        <div class="glow-ring r1" />
        <div class="glow-ring r2" />

        <svg class="float-el float-bag-1" viewBox="0 0 100 110" fill="none">
          <path
            d="M33 32V24C33 14.6112 40.6112 7 50 7C59.3888 7 67 14.6112 67 24V32"
            stroke="white"
            stroke-width="6"
            stroke-linecap="round"
          />
          <rect x="14" y="30" width="72" height="72" rx="14" fill="white" />
          <text
            x="50"
            y="61"
            text-anchor="middle"
            fill="#ED1C24"
            font-size="16"
            font-weight="900"
            font-family="sans-serif"
          >
            MINI
          </text>
          <text
            x="50"
            y="81"
            text-anchor="middle"
            fill="#ED1C24"
            font-size="18"
            font-weight="900"
            font-family="sans-serif"
          >
            SO
          </text>
        </svg>

        <svg class="float-el float-wink-1" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="44" stroke="white" stroke-width="5" />
          <circle cx="35" cy="40" r="5.5" fill="white" class="wink-eye-anim" />
          <rect x="57" y="38" width="14" height="5" rx="2.5" fill="white" />
          <path
            d="M32 60C37 70 63 70 68 60"
            stroke="white"
            stroke-width="5.5"
            stroke-linecap="round"
          />
        </svg>

        <svg class="float-el float-box-1" viewBox="0 0 80 80" fill="none">
          <rect x="12" y="26" width="56" height="44" rx="10" stroke="white" stroke-width="4.5" />
          <rect x="8" y="18" width="64" height="14" rx="5" fill="white" />
          <path d="M40 18V70" stroke="white" stroke-width="4" />
          <circle cx="32" cy="12" r="5" stroke="white" stroke-width="3.5" />
          <circle cx="48" cy="12" r="5" stroke="white" stroke-width="3.5" />
        </svg>

        <svg class="float-el float-bag-2" viewBox="0 0 100 110" fill="none">
          <path
            d="M33 32V24C33 14.6112 40.6112 7 50 7C59.3888 7 67 14.6112 67 24V32"
            stroke="white"
            stroke-width="6"
            stroke-linecap="round"
          />
          <rect x="14" y="30" width="72" height="72" rx="14" stroke="white" stroke-width="5" />
        </svg>
      </div>

      <!-- 上半部分：品牌标语与价值轮播 -->
      <div class="ob-hero-wrap">
        <div class="ob-brand-row">
          <div class="miniso-bag-badge">
            <div class="miniso-mark" aria-hidden="true">
              <span>MINI</span>
              <span>SO</span>
            </div>
            <span class="ob-brand-text">名创优品 AI 授课教练</span>
          </div>
          <div class="ob-top-right">
            <span class="ob-mode-badge" data-testid="api-mode-pill">
              {{ apiMode === 'mock' ? 'Mock 模拟' : '真实 API' }}
            </span>
            <svg width="26" height="26" viewBox="0 0 100 100" fill="none" aria-label="MINISO Wink">
              <circle cx="50" cy="50" r="44" stroke="white" stroke-width="6" />
              <circle cx="35" cy="40" r="6" fill="white" />
              <rect x="57" y="37" width="15" height="6" rx="3" fill="white" />
              <path
                d="M32 60C37 70 63 70 68 60"
                stroke="white"
                stroke-width="6"
                stroke-linecap="round"
              />
            </svg>
          </div>
        </div>

        <!-- 若已有活动会话，悬浮展示快捷回到工作台条 -->
        <div v-if="user" class="active-session-bar" data-testid="active-session-banner">
          <span>
            当前会话：<strong>{{ user.name }}</strong>（{{ roleDisplayName(user.role) }}）
          </span>
          <div class="active-session-btns">
            <button type="button" class="mini-white-btn" @click="handleContinueCurrent">
              进入
            </button>
            <button type="button" class="mini-ghost-btn" @click="handleLogoutOnly">
              退出
            </button>
          </div>
        </div>

        <div class="ob-showcase">
          <div class="ob-slide-card">
            <div class="ob-slide-tag">{{ activeSlide.tag }}</div>
            <div class="ob-slide-title">{{ activeSlide.title }}</div>
            <div class="ob-slide-desc">{{ activeSlide.desc }}</div>
          </div>
          <div class="ob-progress-bars">
            <button
              v-for="(slide, idx) in SLIDES"
              :key="slide.tag"
              type="button"
              class="ob-bar-btn"
              :class="{ active: currentSlide === idx }"
              :aria-label="`引导第${idx + 1}页`"
              @click="setSlide(idx)"
            >
              <span class="ob-bar-fill" />
            </button>
          </div>
        </div>
      </div>

      <!-- 正下方：横向 3D 卡片角色选择器（Thumb-Zone） -->
      <div class="ob-role-sheet">
        <div class="ob-sheet-head">
          <div class="ob-sheet-title">选择您的门店角色</div>
          <div class="wheel-tip-pill">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>左右滑动或点击</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>

        <div
          class="wheel-picker-wrap"
          aria-label="门店角色横向卡片轮播"
          @wheel.prevent="onWheelScroll"
          @touchstart.passive="(e) => onPointerStart(e.touches[0].clientX)"
          @touchmove.passive="(e) => onPointerMove(e.touches[0].clientX)"
          @touchend="onPointerEnd"
          @mousedown="(e) => onPointerStart(e.clientX)"
          @mousemove="(e) => onPointerMove(e.clientX)"
          @mouseup="onPointerEnd"
          @mouseleave="onPointerEnd"
        >
          <div
            v-for="(group, idx) in ROLE_GROUPS"
            :key="group.id"
            class="wheel-card"
            :class="wheelCardPositions[idx]"
            :data-testid="`role-card-${group.id}`"
            @click="onWheelCardClick(idx)"
          >
            <div class="wheel-card-inner">
              <div class="wheel-card-top">
                <div class="role-icon-box" aria-hidden="true">
                  <svg
                    v-if="group.role === 'staff'"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <svg
                    v-else-if="group.role === 'store_manager'"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  <svg
                    v-else
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M8 10h8" />
                    <path d="M8 14h5" />
                  </svg>
                </div>
                <span v-if="idx === roleWheelIndex" class="status-badge status-ok">
                  已选身份
                </span>
              </div>

              <div>
                <div class="role-title">{{ group.wheelTitle }}</div>
                <div class="role-desc">{{ group.wheelDesc }}</div>
              </div>

              <div class="role-caps">
                <span v-for="cap in group.wheelCaps" :key="cap" class="role-cap-pill">
                  {{ cap }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="wheel-dots">
          <button
            v-for="(group, idx) in ROLE_GROUPS"
            :key="group.id"
            type="button"
            class="wheel-dot-btn"
            :class="{ active: idx === roleWheelIndex }"
            :aria-label="`选择${group.wheelTitle}`"
            :data-testid="`role-tab-${group.role}-${idx}`"
            @click="setRoleWheelIndex(idx)"
          />
        </div>

        <!-- 角色下的测试用户横向胶囊选择器 -->
        <div class="ob-user-picker" aria-label="选择登录用户">
          <span class="ob-user-lbl">选择用户：</span>
          <div class="ob-user-pills">
            <button
              v-for="u in activeGroup.users"
              :key="u.id"
              type="button"
              class="ob-user-pill"
              :class="{ active: u.id === activeUserId }"
              :data-testid="`user-option-${u.id}`"
              @click="selectUserInGroup(u.id)"
            >
              {{ u.name }}{{ activeGroup.users.length <= 2 ? ` · ${u.title}` : '' }}
            </button>
          </div>
        </div>

        <div v-if="errorText" class="ob-error-tip" role="alert" data-testid="login-error">
          {{ errorText }}
        </div>

        <button
          type="button"
          class="btn-cta ob-enter-btn"
          :disabled="loading || !activeUserId"
          data-testid="login-submit-btn"
          @click="handleLogin"
        >
          <span>
            {{
              loading
                ? '正在建立服务端会话...'
                : `以「${activeUserSeed?.name ?? ''} · ${activeGroup.wheelTitle}」进入`
            }}
          </span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>

        <div v-if="apiMode === 'mock'" class="ob-mock-tools">
          <span>Mock 测试基线（可切换北京/佛山员工、店长与总部）</span>
          <button
            type="button"
            class="ob-reset-link"
            data-testid="reset-mock-btn"
            @click="handleResetMock"
          >
            重置 Mock 数据
          </button>
        </div>
      </div>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.onboarding-screen {
  flex: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, #ed1c24 0%, #d41118 52%, #a60a10 100%);
  position: relative;
  overflow: hidden;
}

.miniso-bg-motion {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
}

.float-el {
  position: absolute;
  opacity: 0.14;
  will-change: transform;
}

.float-bag-1 {
  top: 18px;
  right: -12px;
  width: 112px;
  animation: floatDriftA 9s ease-in-out infinite;
}

.float-wink-1 {
  top: 86px;
  left: -18px;
  width: 92px;
  opacity: 0.16;
  animation: floatWink 7.5s ease-in-out infinite;
}

.float-box-1 {
  top: 340px;
  right: 18px;
  width: 68px;
  opacity: 0.15;
  animation: floatDriftB 8s ease-in-out infinite;
}

.float-bag-2 {
  top: 445px;
  left: 16px;
  width: 64px;
  opacity: 0.12;
  animation: floatDriftA 11s ease-in-out infinite reverse;
}

.glow-ring {
  position: absolute;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  animation: pulseRing 6s ease-in-out infinite;
}

.glow-ring.r1 {
  width: 240px;
  height: 240px;
  top: -60px;
  right: -70px;
}

.glow-ring.r2 {
  width: 180px;
  height: 180px;
  top: 150px;
  left: -65px;
  animation-delay: 2.5s;
}

@keyframes floatDriftA {
  0%,
  100% {
    transform: translate3d(0, 0, 0) rotate(-6deg);
  }
  50% {
    transform: translate3d(-8px, 14px, 0) rotate(5deg);
  }
}

@keyframes floatDriftB {
  0%,
  100% {
    transform: translate3d(0, 0, 0) rotate(8deg) scale(1);
  }
  50% {
    transform: translate3d(8px, -12px, 0) rotate(-4deg) scale(1.06);
  }
}

@keyframes floatWink {
  0%,
  100% {
    transform: translate3d(0, 0, 0) rotate(-4deg) scale(1);
  }
  50% {
    transform: translate3d(10px, -10px, 0) rotate(6deg) scale(1.05);
  }
}

@keyframes pulseRing {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.18;
  }
  50% {
    transform: scale(1.08);
    opacity: 0.32;
  }
}

@keyframes winkBlink {
  0%,
  42%,
  48%,
  100% {
    transform: scaleY(1);
  }
  45% {
    transform: scaleY(0.15);
  }
}

.wink-eye-anim {
  transform-origin: center;
  animation: winkBlink 4.2s ease-in-out infinite;
}

.ob-hero-wrap {
  position: relative;
  z-index: 2;
  flex: 1;
  padding: 14px 20px 8px;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 14px;
}

.ob-brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ob-top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ob-mode-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #ffffff;
  white-space: nowrap;
}

.miniso-bag-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.miniso-mark {
  width: 38px;
  height: 38px;
  background: #ffffff;
  color: var(--red);
  border-radius: 11px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 12px;
  line-height: 1.02;
  letter-spacing: 0.4px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
}

.ob-brand-text {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.active-session-bar {
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 12px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.active-session-btns {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.mini-white-btn {
  border: none;
  background: #ffffff;
  color: var(--red);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.mini-ghost-btn {
  border: 1px solid rgba(255, 255, 255, 0.45);
  background: transparent;
  color: #ffffff;
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.ob-showcase {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: auto 0;
}

.ob-slide-card {
  padding: 2px;
  min-height: 118px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.ob-slide-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.26);
  padding: 4px 12px;
  border-radius: 999px;
  width: fit-content;
}

.ob-slide-title {
  font-size: 26px;
  font-weight: 800;
  line-height: 1.24;
  letter-spacing: -0.3px;
}

.ob-slide-desc {
  font-size: 14px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.92);
}

.ob-progress-bars {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.ob-bar-btn {
  height: 16px;
  background: transparent;
  border: none;
  padding: 6px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.ob-bar-fill {
  width: 100%;
  height: 3.5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  transition: background 0.25s ease;
}

.ob-bar-btn.active .ob-bar-fill {
  background: #ffffff;
}

/* 正下方：Thumb-Zone 横向轮播角色选择器 */
.ob-role-sheet {
  position: relative;
  z-index: 3;
  background: transparent;
  padding: 4px 20px calc(18px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ob-sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ob-sheet-title {
  font-size: 16px;
  font-weight: 800;
  color: #ffffff;
}

.wheel-tip-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.24);
  padding: 4px 10px;
  border-radius: 999px;
}

.wheel-picker-wrap {
  position: relative;
  height: 174px;
  margin: 0 -20px;
  overflow: hidden;
  perspective: 1000px;
  user-select: none;
  touch-action: pan-y;
  cursor: grab;
}

.wheel-picker-wrap:active {
  cursor: grabbing;
}

.wheel-card {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 248px;
  height: 166px;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 22px;
  padding: 15px 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.28s ease,
    background 0.28s ease, border-color 0.25s ease, box-shadow 0.28s ease;
}

.wheel-card.pos-center {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
  z-index: 3;
  background: #ffffff;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: 2px solid #ffffff;
  box-shadow: 0 18px 36px rgba(96, 0, 8, 0.28);
}

.wheel-card.pos-left {
  transform: translate(calc(-50% - 247px), -50%) scale(0.88);
  opacity: 0.45;
  z-index: 2;
}

.wheel-card.pos-right {
  transform: translate(calc(-50% + 247px), -50%) scale(0.88);
  opacity: 0.45;
  z-index: 2;
}

.wheel-card.pos-back {
  transform: translate(-50%, -50%) scale(0.75);
  opacity: 0;
  pointer-events: none;
  z-index: 0;
}

.wheel-card:not(.pos-center) .wheel-card-inner {
  opacity: 0.35;
}

.wheel-card-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.wheel-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.role-icon-box {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.24);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wheel-card.pos-center .role-icon-box {
  background: var(--red-soft);
  color: var(--red);
}

.role-title {
  font-size: 18px;
  font-weight: 800;
  color: #ffffff;
  line-height: 1.25;
  margin-bottom: 3px;
}

.wheel-card.pos-center .role-title {
  color: var(--text);
}

.role-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.4;
}

.wheel-card.pos-center .role-desc {
  color: var(--text-secondary);
}

.role-caps {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.role-cap-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--text-secondary);
}

.wheel-dots {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.wheel-dot-btn {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.38);
  cursor: pointer;
  transition: all 0.22s ease;
}

.wheel-dot-btn.active {
  width: 24px;
  background: #ffffff;
}

.ob-user-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.ob-user-lbl {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.88);
  white-space: nowrap;
  flex-shrink: 0;
}

.ob-user-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  flex: 1;
  min-width: 0;
}

.ob-user-pills::-webkit-scrollbar {
  display: none;
}

.ob-user-pill {
  border: 1px solid rgba(255, 255, 255, 0.36);
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.16s ease;
}

.ob-user-pill.active {
  background: #ffffff;
  border-color: #ffffff;
  color: var(--red);
  box-shadow: 0 3px 10px rgba(96, 0, 8, 0.22);
}

.ob-error-tip {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.45);
  color: #ffffff;
  border-radius: 10px;
  padding: 7px 11px;
  font-size: 12px;
}

.ob-enter-btn {
  height: 48px;
  background: #ffffff;
  color: var(--red);
  box-shadow: 0 10px 26px rgba(96, 0, 8, 0.26);
}

.ob-enter-btn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ob-mock-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
}

.ob-reset-link {
  border: none;
  background: transparent;
  color: #ffffff;
  text-decoration: underline;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
</style>
