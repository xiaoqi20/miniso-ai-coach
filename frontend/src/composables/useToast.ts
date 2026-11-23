import { readonly, shallowRef } from 'vue'

/**
 * 轻量全局 Toast 状态（无需引入额外状态库），用于反馈操作结果与异常提示。
 */
const toastMessage = shallowRef('')
const toastVisible = shallowRef(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  /** 显示一条轻量提示，默认 2.6 秒后自动隐藏 */
  function showToast(message: string, durationMs = 2600): void {
    toastMessage.value = message
    toastVisible.value = true
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
    }
    hideTimer = setTimeout(() => {
      toastVisible.value = false
      hideTimer = null
    }, durationMs)
  }

  return {
    message: readonly(toastMessage),
    visible: readonly(toastVisible),
    showToast,
  }
}
