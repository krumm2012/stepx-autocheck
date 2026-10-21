/* =============================================================================
 * 原子能力（设备侧 MCP）调用封装
 *
 * 与 `src/shared/bridge`（壳 capsule SDK）是两条独立的桥：
 *  - bridge 走 `capsule.invoke(...)`，接口清单见 capsule-native-api；
 *  - 本模块走 `window.mcp.callTool(name, args)`，由壳的 AbilityMcpClient 转交，
 *    能力来自平台连接器（本工程接入了「通用原子能力 ic_atomic_472」与「时钟 ic_atomic_452」）。
 *
 * 约定（与连接器契约一致）：
 *  - 先 `connect()` 探测设备服务；**仅有 window.mcp 对象不代表原生桥可用**；
 *  - Promise 拒绝或结果 `isError === true` 都按失败处理；
 *  - 失败时记脱敏诊断日志（只含连接器 / 能力名，不透传 errorMsg 与异常原文）；
 *  - 普通浏览器（无壳）不可用：UI 侧呈现禁用态与「去真机验证」提示，不做模拟执行。
 * ========================================================================== */

import { nativeLog } from '@/shared/bridge'

/** `callTool` 的返回结构（成功与失败同一形状，用 isError 区分） */
export interface AbilityResult {
  isError?: boolean
  /** Device MCP returns its human-readable result in content. */
  content?: string | null
  text?: string
  errorCode?: number | string
  errorMsg?: string
  structuredContent?: unknown
  [key: string]: unknown
}

interface DeviceMcp {
  connect(): Promise<unknown>
  callTool(name: string, args: Record<string, unknown>): Promise<AbilityResult>
}

declare global {
  interface Window {
    mcp?: DeviceMcp
  }
}

/** 原子能力调用失败。message 是给用户看的安全文案，不含原始错误详情 */
export class AbilityError extends Error {
  readonly ability: string

  constructor(ability: string, message: string) {
    super(message)
    this.name = 'AbilityError'
    this.ability = ability
  }
}

/** 本工程用到的原子能力名（来自已接入连接器的 abilities 清单，不猜名字） */
export type AbilityName =
  // ic_atomic_472 通用原子能力
  | 'open_app_by_package'
  | 'open_app_by_name'
  | 'check_app_installed_by_name'
  | 'check_app_installed_by_package'
  | 'speak_text'
  // ic_atomic_452 时钟
  | 'alarm_clock_add'
  | 'alarm_clock_disable_one'

let bridgeAvailable: boolean | undefined

/**
 * 探测设备侧 MCP 是否可用（真机壳内才可用）。结果缓存，
 * 每次调用前不再重复 connect（连接由壳维护）。
 */
export async function isAbilityBridgeAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.mcp) {
    bridgeAvailable = false
    return false
  }
  if (bridgeAvailable !== undefined) return bridgeAvailable
  try {
    await window.mcp.connect()
    bridgeAvailable = true
  } catch (error) {
    nativeLog.w('ability', 'device mcp connect failed', {
      connector: 'ic_atomic_472/ic_atomic_452',
      stage: 'connect',
    })
    bridgeAvailable = false
  }
  return bridgeAvailable
}

/**
 * 调用一个原子能力。失败抛 AbilityError（用户安全文案 + 能力名），
 * 调用方按「不可用 / 失败」给出提示与重试入口，不要展示原始 errorMsg。
 */
export async function callAbility(
  name: AbilityName,
  args: Record<string, unknown> = {},
): Promise<AbilityResult> {
  if (typeof window === 'undefined' || !window.mcp) {
    throw new AbilityError(name, '当前环境不支持该操作，请在手机 App 里使用')
  }
  let result: AbilityResult
  try {
    result = await window.mcp.callTool(name, args)
  } catch (error) {
    // 脱敏：只记录连接器与能力名、失败阶段，不写异常原文
    nativeLog.w('ability', `callAbility rejected: ${name}`, {
      connector: 'ic_atomic_472/ic_atomic_452',
      ability: name,
      stage: 'callTool',
    })
    throw new AbilityError(name, '操作失败，请稍后重试')
  }
  if (result?.isError) {
    nativeLog.w('ability', `callAbility returned error: ${name}`, {
      connector: 'ic_atomic_472/ic_atomic_452',
      ability: name,
      errorCode: typeof result.errorCode === 'number' ? result.errorCode : undefined,
    })
    throw new AbilityError(name, '操作失败，请稍后重试')
  }
  return result
}
