<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError, getApiMode } from '@/api/client'
import * as staffApi from '@/api/staff'
import AppShellMobile from '@/components/AppShellMobile.vue'
import CustomerAvatar from '@/components/CustomerAvatar.vue'
import ScoreResultCard from '@/components/ScoreResultCard.vue'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'
import {
  getMockNextRoundFault,
  setMockNextRoundFault,
  type MockFaultMode,
} from '@/mock/server'
import { M1_SAMPLE_INPUTS } from '@/mock/seed'
import type {
  CustomerPersona,
  QuestionVariant,
  RoleplayFullAttempt,
  RoleplayPreviewResponse,
  RoleplayRoundItem,
  RoleplaySessionRef,
  StaffAssignmentDetailResponse,
} from '@/types/api'
import { createClientUuid, formatDateTimeLabel } from '@/utils/assignment'

/**
 * 员工文字实战对练页（1:1 复刻 static/index.html #screen-roleplay 原型舞台、复盘与雷达布局）。
 * 保持 M1 契约与多课程隔离约束：
 * 1. 页面文案（价格、问法、输入提示、课件参考、示范、结果回应）严格绑定当前 assignmentId 的课程版本，
 *    绝不回退或串用其他商品（如 Chiikawa）的硬编码文本；
 * 2. 从 POST roleplay-sessions + GET roleplay-sessions/{id} 恢复全部已保存轮次；
 * 3. 未学完章节返回 409 CHAPTERS_INCOMPLETE 时引导补学，但允许用户输入话术体验「演示试听（persisted: false）」；
 * 4. 正式提交绑定 client_round_id 并持久化草稿与失败原因，503/502/409 或网络异常刷新后仍保留错误提示、
 *    「用同一轮次重试评分」与「改写为新一轮」两个恢复动作。
 */
const route = useRoute()
const router = useRouter()
const { user } = useSession()
const { showToast } = useToast()

const assignmentId = computed(() => String(route.params.assignmentId ?? ''))
const isMockMode = getApiMode() === 'mock'
const answerTextareaRef = useTemplateRef<HTMLTextAreaElement>('answerTextarea')

const detail = shallowRef<StaffAssignmentDetailResponse | null>(null)
const sessionRef = shallowRef<RoleplaySessionRef | null>(null)
const persona = shallowRef<CustomerPersona | null>(null)
const rounds = shallowRef<readonly RoleplayRoundItem[]>([])

const loading = shallowRef(true)
const loadError = shallowRef('')
const loadErrorCode = shallowRef('')
const loadErrorRequestId = shallowRef('')

const chaptersIncomplete = shallowRef(false)
const missingChapters = shallowRef<readonly string[]>([])

const questionVariant = shallowRef<QuestionVariant>('default')
const answerText = shallowRef('')
const pendingClientRoundId = shallowRef<string>(createClientUuid())
const retryLocked = shallowRef(false)

const submittingFormal = shallowRef(false)
const submittingPreview = shallowRef(false)
const retryingRoundNo = shallowRef<number | null>(null)

const submitError = shallowRef('')
const submitErrorCode = shallowRef('')
const submitErrorRequestId = shallowRef('')
const retryAfterSeconds = shallowRef<number | null>(null)

/** 仅缓存当前任务本次页面交互中服务端返回过的绑定版本示范，切换任务即清空 */
const boundDemoPitch = shallowRef<string | null>(null)

const activeFormalResult = shallowRef<{
  roundNo: number
  answerText: string
  attempt: RoleplayFullAttempt
  replayed: boolean
} | null>(null)
const activePreviewResult = shallowRef<{
  answerText: string
  response: RoleplayPreviewResponse
} | null>(null)

const showUserTranscript = shallowRef(false)
const showSamplesBar = shallowRef(false)
const selectedMockFault = shallowRef<MockFaultMode>(getMockNextRoundFault())

const draftStorageKey = computed(() => {
  const uid = user.value?.id ?? 'anon'
  return `shouke_rp_draft:${uid}:${assignmentId.value}`
})

const productInfo = computed(() => detail.value?.course_version.content.product)
const courseChapters = computed(() => detail.value?.course_version.content.chapters ?? [])
const showMockChiikawaSamples = computed(
  () => isMockMode && detail.value?.course_version.id === 'crv_chiikawa_v1',
)

const personaName = computed(() => persona.value?.name || '门店虚拟顾客')

const hasAltQuestion = computed(() =>
  Boolean(persona.value?.alt_question) || chaptersIncomplete.value,
)

const currentCustomerQuestion = computed(() => {
  if (persona.value) {
    return questionVariant.value === 'alt' && persona.value.alt_question
      ? persona.value.alt_question
      : persona.value.question
  }
  const productTitle = productInfo.value?.name ? `「${productInfo.value.name}」` : '当前课程'
  if (questionVariant.value === 'alt') {
    return `完成全部课程章节后，将加载${productTitle}绑定的换问法顾客提问；您现在可先输入导购话术进行演示试听评分。`
  }
  return `完成全部课程章节后，将加载${productTitle}绑定的专属顾客提问；您现在可先输入导购话术进行演示试听评分。`
})

const answerInputLabel = computed(() =>
  productInfo.value
    ? `导购应答话术（${productInfo.value.name} · ${productInfo.value.price}）`
    : '导购应答话术',
)

const answerPlaceholder = computed(() =>
  productInfo.value
    ? `请输入针对「${productInfo.value.name}」（${productInfo.value.price}）的导购应答话术，建议结合本课核心卖点与合规要求作答...`
    : '请输入您对当前商品的导购应答话术...',
)

const hasEvaluationCard = computed(
  () => activeFormalResult.value !== null || activePreviewResult.value !== null,
)

const avatarMood = computed<'concern' | 'listening' | 'happy'>(() => {
  if (submittingFormal.value || submittingPreview.value) return 'listening'
  if (
    activeFormalResult.value?.attempt.passed ||
    activePreviewResult.value?.response.passed
  ) {
    return 'happy'
  }
  return 'concern'
})

/** 契约未在角色会话接口返回商品特定满意/顾虑口语，统一使用绑定当前商品名的通用回应 */
const compactReplyText = computed(() => {
  const productTitle = productInfo.value?.name ? `「${productInfo.value.name}」` : '当前商品'
  const passed =
    activeFormalResult.value?.attempt.passed ??
    activePreviewResult.value?.response.passed ??
    false
  return passed
    ? `顾客对${productTitle}的卖点与价格讲解表示认可，本轮表达已达标。`
    : `顾客对${productTitle}仍有顾虑，请参考下方评分提示补齐必考事实与合规表达后重试。`
})

const lastSubmittedAnswer = computed(
  () =>
    activeFormalResult.value?.answerText ??
    activePreviewResult.value?.answerText ??
    '',
)

const orderedRoundsDesc = computed(() =>
  [...rounds.value].sort((a, b) => b.round_no - a.round_no),
)

const retrainBanner = computed(() => {
  const rt = detail.value?.open_retrain
  if (!rt) return null
  if (rt.status === 'pending') {
    return {
      tone: 'warn',
      text: `店长指派补训考点：${rt.focus.label}（请补齐考点且整轮达标 >=85 分）`,
    }
  }
  if (rt.status === 'submitted_unfixed') {
    return {
      tone: 'warn',
      text: `上次复练目标考点仍未改正或未达标 · 请继续围绕「${rt.focus.label}」补练`,
    }
  }
  if (rt.status === 'fixed_pending_review') {
    return {
      tone: 'ok',
      text: `补训考点「${rt.focus.label}」已达标，等待店长复查（继续练习不覆盖待复查证据）`,
    }
  }
  return null
})

interface StoredRoleplayDraft {
  client_round_id?: string
  answer_text?: string
  question_variant?: QuestionVariant
  retry_locked?: boolean
  submit_error?: string
  submit_error_code?: string
  submit_error_request_id?: string
  retry_after_seconds?: number | null
}

function saveDraft(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const payload: StoredRoleplayDraft = {
      client_round_id: pendingClientRoundId.value,
      answer_text: answerText.value,
      question_variant: questionVariant.value,
      retry_locked: retryLocked.value,
      submit_error: retryLocked.value ? submitError.value : '',
      submit_error_code: retryLocked.value ? submitErrorCode.value : '',
      submit_error_request_id: retryLocked.value ? submitErrorRequestId.value : '',
      retry_after_seconds: retryLocked.value ? retryAfterSeconds.value : null,
    }
    window.localStorage.setItem(draftStorageKey.value, JSON.stringify(payload))
  } catch {
    // 忽略本地存储写入失败
  }
}

function restoreDraft(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const raw = window.localStorage.getItem(draftStorageKey.value)
    if (!raw) return
    const parsed = JSON.parse(raw) as StoredRoleplayDraft
    if (parsed.client_round_id) {
      pendingClientRoundId.value = parsed.client_round_id
    }
    if (typeof parsed.answer_text === 'string') {
      answerText.value = parsed.answer_text
    }
    if (parsed.question_variant === 'default' || parsed.question_variant === 'alt') {
      questionVariant.value = parsed.question_variant
    }
    retryLocked.value = Boolean(parsed.retry_locked)
    if (retryLocked.value) {
      submitError.value = parsed.submit_error ?? ''
      submitErrorCode.value = parsed.submit_error_code ?? ''
      submitErrorRequestId.value = parsed.submit_error_request_id ?? ''
      retryAfterSeconds.value =
        typeof parsed.retry_after_seconds === 'number' ? parsed.retry_after_seconds : null
    }
  } catch {
    // 忽略损坏草稿
  }
}

function clearDraftAndRotateId(): void {
  pendingClientRoundId.value = createClientUuid()
  retryLocked.value = false
  submitError.value = ''
  submitErrorCode.value = ''
  submitErrorRequestId.value = ''
  retryAfterSeconds.value = null
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(draftStorageKey.value)
    }
  } catch {
    // 忽略
  }
}

function resetViewStateForAssignmentSwitch(): void {
  detail.value = null
  sessionRef.value = null
  persona.value = null
  rounds.value = []
  chaptersIncomplete.value = false
  missingChapters.value = []
  questionVariant.value = 'default'
  answerText.value = ''
  pendingClientRoundId.value = createClientUuid()
  retryLocked.value = false
  submitError.value = ''
  submitErrorCode.value = ''
  submitErrorRequestId.value = ''
  retryAfterSeconds.value = null
  boundDemoPitch.value = null
  activeFormalResult.value = null
  activePreviewResult.value = null
  showUserTranscript.value = false
  showSamplesBar.value = false
}

async function refreshRoundsIfReady(): Promise<void> {
  if (!sessionRef.value) return
  const sessionData = await staffApi.getRoleplaySession(sessionRef.value.id)
  sessionRef.value = sessionData.session
  rounds.value = sessionData.rounds
}

/**
 * 将本地恢复的草稿与服务端真实已保存轮次对账：
 * - 若该 client_round_id 已评分完成，自动解除锁定并轮换新键；
 * - 若对应轮次仍为 failed/scoring 或处于锁定态，保证同时展示失败原因、原轮重试与改写新一轮两个入口。
 */
function reconcileDraftWithRounds(): void {
  const matchedRound = rounds.value.find(
    (r) => r.client_round_id === pendingClientRoundId.value,
  )

  if (matchedRound?.status === 'scored') {
    clearDraftAndRotateId()
    answerText.value = ''
    return
  }

  if (matchedRound && (matchedRound.status === 'failed' || matchedRound.status === 'scoring')) {
    retryLocked.value = true
    answerText.value = matchedRound.answer_text
    questionVariant.value = matchedRound.question_variant
    if (!submitError.value) {
      submitErrorCode.value = matchedRound.failure_code ?? matchedRound.status.toUpperCase()
      submitError.value =
        matchedRound.status === 'scoring'
          ? `第 ${matchedRound.round_no} 轮仍在评分或尚未落库（SCORING_IN_PROGRESS），可用原轮次键重试或改写为新一轮`
          : `第 ${matchedRound.round_no} 轮评分失败（${matchedRound.failure_code ?? 'FAILED'}），可用原轮次键重试或改写为新一轮`
    }
    return
  }

  if (retryLocked.value && !submitError.value) {
    submitError.value = '上次正式提交未收到评分结果，可保留原轮次键重试或改写为新一轮'
  }
}

async function loadRoleplayWorkspace(): Promise<void> {
  if (!assignmentId.value) return
  loading.value = true
  loadError.value = ''
  loadErrorCode.value = ''
  loadErrorRequestId.value = ''
  chaptersIncomplete.value = false
  missingChapters.value = []

  try {
    const asgDetail = await staffApi.getStaffAssignment(assignmentId.value)
    detail.value = asgDetail

    try {
      const created = await staffApi.createOrGetRoleplaySession(assignmentId.value)
      sessionRef.value = created.session
      persona.value = created.persona
      await refreshRoundsIfReady()
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'CHAPTERS_INCOMPLETE') {
        chaptersIncomplete.value = true
        const missing = err.details?.missing_chapters
        missingChapters.value = Array.isArray(missing) ? missing.map(String) : []
        sessionRef.value = null
        persona.value = null
        rounds.value = []
      } else {
        throw err
      }
    }

    restoreDraft()
    reconcileDraftWithRounds()
  } catch (err) {
    if (err instanceof ApiClientError) {
      loadErrorCode.value = err.code
      loadErrorRequestId.value = err.requestId
      loadError.value =
        err.status === 404
          ? '未找到该对练任务或无权访问'
          : `${err.message}（${err.code}）`
    } else {
      loadError.value = '加载对练会话失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

function handleStartFreshDraft(): void {
  clearDraftAndRotateId()
  // 保留当前文本框内容供用户在此基础上改写，同时同步清理本地草稿锁定标记
  saveDraft()
  answerTextareaRef.value?.focus()
}

function handleClearForNextRound(): void {
  activeFormalResult.value = null
  activePreviewResult.value = null
  showUserTranscript.value = false
  answerText.value = ''
  clearDraftAndRotateId()
}

function handleFillCourseSpeech(): void {
  if (retryLocked.value) {
    showToast('当前轮次处于待重试锁定态，请先点击「改写为新一轮」后再替换内容')
    return
  }
  const speech = courseChapters.value
    .map((ch) => ch.speech.trim())
    .filter(Boolean)
    .join(' ')
  if (!speech) {
    showToast('当前课程暂无可填入的课件参考话术')
    return
  }
  answerText.value = speech
  saveDraft()
  showToast('已填入当前绑定课程版本的课件参考话术')
}

function handleFillBoundDemoPitch(): void {
  if (retryLocked.value) {
    showToast('当前轮次处于待重试锁定态，请先点击「改写为新一轮」后再替换内容')
    return
  }
  if (!boundDemoPitch.value) return
  answerText.value = boundDemoPitch.value
  saveDraft()
  showToast('已填入本课绑定版本的金牌示范')
}

function handleApplySample(key: keyof typeof M1_SAMPLE_INPUTS): void {
  if (!showMockChiikawaSamples.value) return
  if (retryLocked.value) {
    clearDraftAndRotateId()
  }
  answerText.value = M1_SAMPLE_INPUTS[key]
  saveDraft()
  showSamplesBar.value = false
}

function handleToggleQuestionVariant(): void {
  if (retryLocked.value) {
    showToast('当前轮次待重试，切换问法将开启新轮次')
    clearDraftAndRotateId()
  }
  questionVariant.value = questionVariant.value === 'default' ? 'alt' : 'default'
  activeFormalResult.value = null
  activePreviewResult.value = null
  showUserTranscript.value = false
  saveDraft()
  showToast(
    questionVariant.value === 'alt'
      ? '已切换为「换问法复练」视角'
      : '已切回「原问法」视角',
  )
}

function handleMockFaultChange(mode: MockFaultMode): void {
  selectedMockFault.value = mode
  setMockNextRoundFault(mode)
  showToast(mode ? `已设定下次正式提交触发模拟故障：${mode}` : '已恢复正常 Mock 评分')
}

async function submitWithClientRound(params: {
  clientRoundId: string
  text: string
  variant: QuestionVariant
  roundNoHint?: number
}): Promise<void> {
  if (!sessionRef.value) return
  submitError.value = ''
  submitErrorCode.value = ''
  submitErrorRequestId.value = ''
  retryAfterSeconds.value = null
  submittingFormal.value = true
  retryingRoundNo.value = params.roundNoHint ?? null

  try {
    const res = await staffApi.submitRoleplayRound(sessionRef.value.id, {
      client_round_id: params.clientRoundId,
      answer_text: params.text,
      question_variant: params.variant,
    })

    boundDemoPitch.value = res.attempt.demo_pitch || boundDemoPitch.value
    activePreviewResult.value = null
    activeFormalResult.value = {
      roundNo: res.round.round_no,
      answerText: res.round.answer_text,
      attempt: res.attempt,
      replayed: res.replayed,
    }
    showUserTranscript.value = false

    await Promise.all([
      refreshRoundsIfReady(),
      staffApi.getStaffAssignment(assignmentId.value).then((fresh) => {
        detail.value = fresh
      }),
    ])

    if (params.clientRoundId === pendingClientRoundId.value) {
      clearDraftAndRotateId()
      answerText.value = ''
    }

    if (res.replayed) {
      showToast(`已重放第 ${res.round.round_no} 轮成绩，未重复计分`)
    } else if (res.open_retrain?.status === 'fixed_pending_review') {
      showToast('目标考点已改正且整轮达标，已进入待店长复查')
    } else if (res.open_retrain?.status === 'submitted_unfixed') {
      showToast('已提交复练，但补训考点或必考项仍未达标')
    } else if (res.attempt.passed) {
      showToast(`正式通关！第 ${res.round.round_no} 轮得分 ${res.attempt.total} 分`)
    } else if (res.attempt.redline_hits.length > 0) {
      showToast(`触发话术红线「${res.attempt.redline_hits[0].term}」，未通关`)
    } else if (res.attempt.missed_required_facts.length > 0) {
      showToast('漏讲必考事实被一票否决，请补齐后复练')
    } else {
      showToast(`第 ${res.round.round_no} 轮得分 ${res.attempt.total} 分，建议继续冲刺`)
    }
  } catch (err) {
    retryLocked.value = true
    if (err instanceof ApiClientError) {
      submitErrorCode.value = err.code
      submitErrorRequestId.value = err.requestId
      submitError.value = `${err.message}（${err.code}）`
      const retrySec = err.details?.retry_after_seconds
      retryAfterSeconds.value = typeof retrySec === 'number' ? retrySec : null
    } else {
      submitError.value = '提交评分失败，请保持同一轮次重试'
    }
    saveDraft()
    try {
      await refreshRoundsIfReady()
    } catch {
      // 忽略刷新失败，保留已持久化的报错信息
    }
  } finally {
    submittingFormal.value = false
    retryingRoundNo.value = null
    selectedMockFault.value = getMockNextRoundFault()
  }
}

async function handleSubmitFormal(): Promise<void> {
  if (submittingFormal.value || chaptersIncomplete.value || !sessionRef.value) return
  const text = answerText.value.trim()
  if (!text) {
    showToast('请先输入导购话术内容')
    answerTextareaRef.value?.focus()
    return
  }
  saveDraft()
  await submitWithClientRound({
    clientRoundId: pendingClientRoundId.value,
    text,
    variant: questionVariant.value,
  })
}

async function handleRetrySavedRound(round: RoleplayRoundItem): Promise<void> {
  if (submittingFormal.value) return
  await submitWithClientRound({
    clientRoundId: round.client_round_id,
    text: round.answer_text,
    variant: round.question_variant,
    roundNoHint: round.round_no,
  })
}

async function handleSubmitPreview(): Promise<void> {
  if (submittingPreview.value) return
  const text = answerText.value.trim()
  if (!text) {
    // 空白点击演示试听绝不注入其他商品默认文本，避免串用他品话术
    showToast('请先输入导购话术，或先点「填入本课课件话术」再试听')
    answerTextareaRef.value?.focus()
    return
  }
  submittingPreview.value = true
  submitError.value = ''
  try {
    const previewRes = await staffApi.previewRoleplay(assignmentId.value, {
      answer_text: text,
      question_variant: questionVariant.value,
    })
    boundDemoPitch.value = previewRes.demo_pitch || boundDemoPitch.value
    activeFormalResult.value = null
    activePreviewResult.value = {
      answerText: text,
      response: previewRes,
    }
    showUserTranscript.value = false
    showToast('演示话术试听评分，不计入正式成绩')
  } catch (err) {
    if (err instanceof ApiClientError) {
      submitErrorCode.value = err.code
      submitErrorRequestId.value = err.requestId
      submitError.value = `${err.message}（${err.code}）`
    } else {
      submitError.value = '演示试听评分失败，请稍后重试'
    }
  } finally {
    submittingPreview.value = false
  }
}

function goHome(): void {
  void router.push('/staff')
}

function goCourse(): void {
  void router.push(`/staff/assignments/${encodeURIComponent(assignmentId.value)}`)
}

watch(assignmentId, () => {
  resetViewStateForAssignmentSwitch()
  void loadRoleplayWorkspace()
})

onMounted(() => {
  void loadRoleplayWorkspace()
})
</script>

<template>
  <AppShellMobile
    status-theme="light"
    :show-bottom-nav="true"
    :roleplay-assignment-id="assignmentId"
  >
    <!-- 顶部导航（显示当前任务绑定课程价格，不设他品默认值） -->
    <header class="tutor-nav">
      <button type="button" class="icon-btn" aria-label="返回课程学习" @click="goCourse">
        <svg
          width="20"
          height="20"
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
      </button>
      <div class="tutor-nav-title">AI 情景文字对练</div>
      <div class="tutor-price" data-testid="roleplay-nav-price">
        {{ productInfo?.price || '—' }}
      </div>
    </header>

    <!-- 当前绑定商品标签条 -->
    <div v-if="productInfo" class="sku-switch-strip">
      <button type="button" class="sku-pill-btn active" @click="goCourse">
        {{ productInfo.name }}
      </button>
    </div>

    <div class="avatar-pane">
      <div v-if="loading" class="card state-card" data-testid="roleplay-loading">
        正在恢复对练会话与已保存轮次...
      </div>

      <div v-else-if="loadError" class="card error-state-card" data-testid="roleplay-load-error">
        <div class="error-banner" role="alert">
          <div class="error-banner-head">{{ loadError }}</div>
          <div v-if="loadErrorRequestId" class="error-request-id">
            request_id: {{ loadErrorRequestId }}
          </div>
        </div>
        <div class="error-actions">
          <button type="button" class="btn-secondary-soft" @click="goHome">返回首页</button>
          <button
            v-if="loadErrorCode !== 'NOT_FOUND'"
            type="button"
            class="btn-pill-red"
            @click="loadRoleplayWorkspace"
          >
            重试
          </button>
        </div>
      </div>

      <template v-else-if="detail">
        <!-- 1. 补训状态横幅 -->
        <div
          v-if="retrainBanner"
          class="retrain-focus-banner"
          :class="retrainBanner.tone"
          data-testid="roleplay-retrain-banner"
        >
          {{ retrainBanner.text }}
        </div>

        <!-- 2. 409 未学完章节引导卡 -->
        <div
          v-if="chaptersIncomplete"
          class="incomplete-card"
          data-testid="chapters-incomplete-card"
        >
          <div class="incomplete-title">请先完成全部课程章节再开始正式对练</div>
          <p class="incomplete-desc">
            待学章节：{{ missingChapters.join('、') || '尚有未完成章节' }}。学完前可使用下方「演示试听」体验评分效果（不计入正式成绩）。
          </p>
          <button type="button" class="btn-pill-red" @click="goCourse">
            返回课程补学章节
          </button>
        </div>

        <!-- 3. 评分复盘态（顾客通用反馈 + 可展开我的回答 + 雷达卡） -->
        <template v-if="hasEvaluationCard">
          <div class="rp-compact-stage">
            <div class="rp-mini-avatar">
              <CustomerAvatar
                :persona-style="persona?.style ?? 'student'"
                :mood="avatarMood"
                :size="40"
              />
            </div>
            <div class="rp-mini-info">
              <div class="rp-mini-head">
                <span class="persona-pill">{{ personaName }}</span>
                <span
                  class="status-badge"
                  :class="avatarMood === 'happy' ? 'status-ok' : 'status-warn'"
                >
                  {{ avatarMood === 'happy' ? '认可满意' : '犹豫顾虑中' }}
                </span>
              </div>
              <div class="rp-mini-reply" data-testid="compact-customer-reply">
                {{ compactReplyText }}
              </div>
            </div>
            <button
              type="button"
              class="mini-icon-pill"
              @click="showUserTranscript = !showUserTranscript"
            >
              {{ showUserTranscript ? '收起原话' : '我的回答' }}
            </button>
          </div>

          <div
            v-if="showUserTranscript && lastSubmittedAnswer"
            class="user-transcript-box compact"
          >
            {{ lastSubmittedAnswer }}
          </div>

          <ScoreResultCard
            v-if="activeFormalResult"
            :result="activeFormalResult.attempt"
            :round-no="activeFormalResult.roundNo"
            :replayed="activeFormalResult.replayed"
            @switch-variant="handleToggleQuestionVariant"
            @start-next-round="handleClearForNextRound"
          />
          <ScoreResultCard
            v-else-if="activePreviewResult"
            :result="activePreviewResult.response"
            :is-preview="true"
            @switch-variant="handleToggleQuestionVariant"
            @start-next-round="handleClearForNextRound"
          />
        </template>

        <!-- 4. 虚拟顾客拟人舞台 -->
        <section class="avatar-stage">
          <div class="avatar-top-row">
            <div class="persona-pill">
              <span data-testid="customer-persona-name">{{ personaName }}</span>
              <span
                class="status-badge"
                :class="avatarMood === 'listening' ? 'status-ok' : 'status-warn'"
              >
                {{
                  avatarMood === 'listening'
                    ? '评分核验中'
                    : avatarMood === 'happy'
                      ? '认可满意'
                      : '犹豫顾虑中'
                }}
              </span>
            </div>
            <div class="audio-ctrl-group">
              <button
                v-if="hasAltQuestion"
                type="button"
                class="mini-icon-pill"
                data-testid="toggle-variant-btn"
                @click="handleToggleQuestionVariant"
              >
                {{ questionVariant === 'default' ? '换个问法' : '切回原问法' }}
              </button>
            </div>
          </div>

          <div class="avatar-center">
            <div
              class="avatar-orbit"
              :class="{ listening: submittingFormal || submittingPreview }"
            >
              <div class="avatar-pulse" />
              <div class="avatar-pulse p2" />
              <div class="avatar-portrait">
                <CustomerAvatar
                  :persona-style="persona?.style ?? 'student'"
                  :mood="avatarMood"
                  :size="92"
                />
              </div>
            </div>
          </div>

          <div class="avatar-subtitle">
            <div class="avatar-reply-tag">
              {{
                chaptersIncomplete
                  ? '对练预览说明（待解锁顾客场景）'
                  : questionVariant === 'alt'
                    ? '换问法复练 · 同一考点不同问法'
                    : '虚拟顾客提问'
              }}
            </div>
            <div data-testid="customer-question-text">{{ currentCustomerQuestion }}</div>
          </div>
        </section>

        <!-- 5. 底部对练输入与操作面板 -->
        <section class="voice-dock">
          <label for="roleplay-answer-input" class="dock-label">
            {{ answerInputLabel }}
          </label>
          <textarea
            id="roleplay-answer-input"
            ref="answerTextarea"
            v-model="answerText"
            class="dock-textarea"
            rows="3"
            :disabled="submittingFormal || retryLocked"
            :placeholder="answerPlaceholder"
            data-testid="roleplay-answer-input"
            @input="saveDraft"
          />

          <!-- 失败/锁定恢复横幅：刷新后亦同时展示失败说明、「用同一轮次重试评分」与「改写为新一轮」 -->
          <div
            v-if="submitError || retryLocked"
            class="error-banner"
            role="alert"
            data-testid="roleplay-submit-error"
          >
            <div class="error-banner-head">
              {{ submitError || '上次提交尚未完成评分，可继续用原轮次重试或改写为新一轮' }}
            </div>
            <div v-if="retryAfterSeconds" class="error-sub-hint">
              建议等待 {{ retryAfterSeconds }} 秒后重试或刷新恢复会话
            </div>
            <div class="error-request-id">
              <template v-if="submitErrorRequestId">
                request_id: {{ submitErrorRequestId }} ·
              </template>
              client_round_id: {{ pendingClientRoundId }}
            </div>
            <div v-if="retryLocked" class="retry-actions">
              <button
                type="button"
                class="btn-pill-red"
                :disabled="submittingFormal || chaptersIncomplete"
                data-testid="retry-same-round-btn"
                @click="handleSubmitFormal"
              >
                {{ submittingFormal ? '正在重试...' : '用同一轮次重试评分' }}
              </button>
              <button
                type="button"
                class="btn-pill-soft"
                :disabled="submittingFormal"
                data-testid="rewrite-new-round-btn"
                @click="handleStartFreshDraft"
              >
                改写为新一轮
              </button>
            </div>
          </div>

          <button
            type="button"
            class="mic-main-btn"
            :disabled="chaptersIncomplete || submittingFormal || submittingPreview"
            data-testid="formal-submit-btn"
            @click="handleSubmitFormal"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>
              {{
                submittingFormal
                  ? 'AI 核验评分中...'
                  : retryLocked
                    ? '用当前原轮次重试评分'
                    : '提交正式话术评分'
              }}
            </span>
          </button>

          <div class="voice-quick-row">
            <button
              type="button"
              class="voice-chip-btn"
              :disabled="submittingPreview || submittingFormal"
              data-testid="preview-submit-btn"
              @click="handleSubmitPreview"
            >
              {{ submittingPreview ? '试听评分中...' : '演示试听（不计分）' }}
            </button>
            <button
              v-if="courseChapters.length > 0"
              type="button"
              class="voice-chip-btn"
              :disabled="retryLocked"
              data-testid="fill-course-speech-btn"
              @click="handleFillCourseSpeech"
            >
              填入本课课件话术
            </button>
            <button
              v-if="boundDemoPitch"
              type="button"
              class="voice-chip-btn"
              :disabled="retryLocked"
              data-testid="fill-bound-demo-btn"
              @click="handleFillBoundDemoPitch"
            >
              填入本课金牌示范
            </button>
            <button
              v-if="showMockChiikawaSamples"
              type="button"
              class="voice-chip-btn"
              data-testid="toggle-samples-btn"
              @click="showSamplesBar = !showSamplesBar"
            >
              {{ showSamplesBar ? '收起样例' : '测试样例 ▾' }}
            </button>
          </div>

          <div
            v-if="showMockChiikawaSamples && showSamplesBar"
            class="samples-bar"
            data-testid="samples-bar"
          >
            <button type="button" class="sample-chip" @click="handleApplySample('correct')">
              高分示范（99分）
            </button>
            <button type="button" class="sample-chip" @click="handleApplySample('synonym')">
              同义表达（91分）
            </button>
            <button type="button" class="sample-chip" @click="handleApplySample('missing')">
              漏讲端盒（一票否决）
            </button>
            <button
              type="button"
              class="sample-chip"
              @click="handleApplySample('factual_error')"
            >
              事实错误+红线（69分）
            </button>
          </div>

          <!-- Mock 模式下展示故障注入调试条 -->
          <div v-if="isMockMode" class="mock-fault-bar" data-testid="mock-fault-bar">
            <span>Mock 故障测试：</span>
            <button
              type="button"
              class="fault-chip"
              :class="{ active: selectedMockFault === null }"
              @click="handleMockFaultChange(null)"
            >
              正常
            </button>
            <button
              type="button"
              class="fault-chip"
              :class="{ active: selectedMockFault === 'SCORING_UNAVAILABLE' }"
              data-testid="mock-fault-503"
              @click="handleMockFaultChange('SCORING_UNAVAILABLE')"
            >
              下次 503
            </button>
            <button
              type="button"
              class="fault-chip"
              :class="{ active: selectedMockFault === 'SCORING_INVALID_OUTPUT' }"
              data-testid="mock-fault-502"
              @click="handleMockFaultChange('SCORING_INVALID_OUTPUT')"
            >
              下次 502
            </button>
            <button
              type="button"
              class="fault-chip"
              :class="{ active: selectedMockFault === 'SCORING_IN_PROGRESS' }"
              data-testid="mock-fault-409"
              @click="handleMockFaultChange('SCORING_IN_PROGRESS')"
            >
              下次 409
            </button>
          </div>
        </section>

        <!-- 6. 已保存训练轮次恢复列表 -->
        <section v-if="sessionRef" class="card" data-testid="saved-rounds-card">
          <div class="card-head">
            <div class="card-title">已保存训练轮次（刷新可恢复）</div>
            <span class="card-sub">共 {{ orderedRoundsDesc.length }} 轮</span>
          </div>

          <div v-if="orderedRoundsDesc.length === 0" class="card-sub">
            暂无正式轮次记录。提交正式话术后将持久化并支持刷新恢复。
          </div>

          <div v-else class="history-list">
            <div
              v-for="round in orderedRoundsDesc"
              :key="round.client_round_id"
              class="history-row-card"
              :data-testid="`saved-round-${round.round_no}`"
            >
              <div class="history-top">
                <div class="history-title">
                  <strong>第 {{ round.round_no }} 轮</strong>
                  <span class="round-variant-pill">
                    {{ round.question_variant === 'alt' ? '换问法' : '原问法' }}
                  </span>
                </div>
                <span
                  v-if="round.status === 'scored' && round.attempt"
                  class="status-badge"
                  :class="round.attempt.passed ? 'status-ok' : 'status-warn'"
                >
                  {{ round.attempt.total }} 分 · {{ round.attempt.passed ? '已通关' : '未通关' }}
                </span>
                <span v-else-if="round.status === 'failed'" class="status-badge status-warn">
                  评分失败（{{ round.failure_code ?? 'FAILED' }}）
                </span>
                <span v-else class="status-badge status-info">评分中</span>
              </div>

              <div class="history-answer">{{ round.answer_text }}</div>

              <div
                v-if="round.attempt && round.attempt.missed_required_facts.length > 0"
                class="history-missed"
              >
                漏讲必考：{{ round.attempt.missed_required_facts.map((f) => f.label).join('、') }}
              </div>

              <div class="history-footer">
                <span>{{ formatDateTimeLabel(round.submitted_at) }}</span>
                <button
                  v-if="round.status === 'failed' || round.status === 'scoring'"
                  type="button"
                  class="btn-pill-soft"
                  :disabled="submittingFormal"
                  :data-testid="`retry-round-${round.round_no}`"
                  @click="handleRetrySavedRound(round)"
                >
                  {{
                    retryingRoundNo === round.round_no ? '重试中...' : '用原轮次键重试'
                  }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.tutor-nav {
  background: var(--card);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.tutor-nav-title {
  flex: 1;
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tutor-price {
  font-size: 16px;
  font-weight: 800;
  color: var(--red);
  flex-shrink: 0;
}

.sku-switch-strip {
  display: flex;
  gap: 8px;
  padding: 10px 14px 4px;
  overflow-x: auto;
  background: var(--bg);
  flex-shrink: 0;
}

.sku-pill-btn {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.sku-pill-btn.active {
  background: var(--red);
  border-color: var(--red);
  color: #ffffff;
}

.avatar-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px calc(88px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.state-card {
  text-align: center;
  color: var(--text-secondary);
  padding: 24px 16px;
}

.error-state-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.error-actions {
  display: flex;
  gap: 8px;
}

.retrain-focus-banner {
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
}

.retrain-focus-banner.warn {
  background: #fff1f2;
  border: 1px solid var(--red-border);
  color: var(--red);
}

.retrain-focus-banner.ok {
  background: var(--green-soft);
  border: 1px solid #b7eb8f;
  color: #135200;
}

.incomplete-card {
  background: var(--amber-soft);
  border: 1px solid #ffd591;
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.incomplete-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--amber);
}

.incomplete-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.rp-compact-stage {
  display: flex;
  align-items: center;
  gap: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fff7f8 100%);
  border: 1px solid var(--red-border);
  border-radius: 16px;
  padding: 10px 12px;
  box-shadow: var(--shadow-sm);
}

.rp-mini-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #ffffff;
  border: 1.5px solid var(--red-border);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rp-mini-info {
  flex: 1;
  min-width: 0;
}

.rp-mini-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 3px;
}

.rp-mini-reply {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}

.user-transcript-box.compact {
  background: var(--red-soft);
  color: var(--text);
  border: 1px solid var(--red-border);
  border-radius: 14px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
}

.avatar-stage {
  background: linear-gradient(180deg, #ffffff 0%, #fff5f6 100%);
  border: 1px solid var(--red-border);
  border-radius: 18px;
  padding: 14px;
  box-shadow: var(--shadow-sm);
}

.avatar-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.persona-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.audio-ctrl-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini-icon-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}

.avatar-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 4px 0 10px;
}

.avatar-orbit {
  position: relative;
  width: 106px;
  height: 106px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--green);
  opacity: 0;
  pointer-events: none;
}

.avatar-orbit.listening .avatar-pulse {
  animation: avatarWave 1.3s ease-out infinite;
}

.avatar-orbit.listening .avatar-pulse.p2 {
  animation-delay: 0.6s;
}

@keyframes avatarWave {
  0% {
    transform: scale(0.88);
    opacity: 0.65;
  }
  100% {
    transform: scale(1.26);
    opacity: 0;
  }
}

.avatar-portrait {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: #ffffff;
  border: 3px solid #ffffff;
  box-shadow: 0 8px 20px rgba(237, 28, 36, 0.16);
  overflow: hidden;
  position: relative;
  z-index: 2;
}

.avatar-subtitle {
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text);
}

.avatar-reply-tag {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: var(--red);
  margin-bottom: 4px;
}

.voice-dock {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow-sm);
}

.dock-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.dock-textarea {
  width: 100%;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  resize: vertical;
  outline: none;
}

.dock-textarea:focus {
  border-color: var(--red);
  background: #ffffff;
}

.dock-textarea:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.mic-main-btn {
  width: 100%;
  height: 48px;
  border-radius: 999px;
  border: none;
  background: var(--red);
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(237, 28, 36, 0.24);
}

.mic-main-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.voice-quick-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.voice-chip-btn {
  flex: 1;
  min-width: 96px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 10px;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}

.voice-chip-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.samples-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sample-chip {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.error-sub-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.retry-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.mock-fault-bar {
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
}

.fault-chip {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.fault-chip.active {
  background: var(--red-soft);
  border-color: var(--red);
  color: var(--red);
  font-weight: 700;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-row-card {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.history-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.history-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.round-variant-pill {
  font-size: 11px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1px 6px;
  color: var(--text-secondary);
}

.history-answer {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.history-missed {
  font-size: 11px;
  font-weight: 700;
  color: var(--amber);
}

.history-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--muted);
}
</style>
