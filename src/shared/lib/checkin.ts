/* =============================================================================
 * 签到助手的本地数据层
 *
 * 数据只存本机（壳沙箱 / 浏览器 localStorage，经 shared/lib/storage）：
 * 签到记录与设置都是「本机即可用」的数据，不接平台后端——用户没有提同步需求，
 * 按需接入（AGENTS.md §10：用户没提到的功能不做）。
 * ========================================================================== */

import { storage } from './storage'

/** 签到结果：success = 今天签到了；already = 打开发现今天已经签过 */
export type CheckinStatus = 'success' | 'already'

export interface CheckinRecord {
  /** 本地日期 YYYY-MM-DD */
  date: string
  status: CheckinStatus
  /** 本次 A 豆增量；用户没填 = null（未知，不计入累计） */
  beans: number | null
  /** 确认时间戳（毫秒） */
  at: number
}

export interface CheckinSettings {
  /** 每日提醒（系统闹钟） */
  reminderEnabled: boolean
  reminderHour: number
  reminderMinute: number
  /** 确认签到后语音播报 */
  speakEnabled: boolean
  /** 确认签到后震动反馈 */
  hapticEnabled: boolean
  /** 打开方式：name = 按应用名；package = 直达包名 + 页面（Activity） */
  openMode: 'name' | 'package'
  appName: string
  packageName: string
  /** 可选：指定 Activity 全限定类名，直达签到页 */
  className: string
}

const RECORDS_KEY = 'checkin.records'
const SETTINGS_KEY = 'checkin.settings'
const LAUNCH_KEY = 'checkin.pendingLaunchAt'

/** 提醒时间默认 08:05（设计文档的云 cron 主触发点，落到设备本地闹钟） */
export const DEFAULT_SETTINGS: CheckinSettings = {
  reminderEnabled: false,
  reminderHour: 8,
  reminderMinute: 5,
  speakEnabled: true,
  hapticEnabled: true,
  openMode: 'name',
  appName: 'Amoo',
  packageName: '',
  className: '',
}

/** 「去签到」后保留的待确认窗口：超过这个时长回前台不再弹确认（分钟） */
export const CONFIRM_WINDOW_MS = 30 * 60 * 1000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地日期键 YYYY-MM-DD */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function todayKey(now: Date = new Date()): string {
  return dateKey(now)
}

function shiftDays(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day + delta)
  return dateKey(date)
}

/* --------------------------------- 记录 --------------------------------- */

export function loadRecords(): CheckinRecord[] {
  const records = storage.get<CheckinRecord[]>(RECORDS_KEY, [])
  if (!Array.isArray(records)) return []
  return records
    .filter(
      (item): item is CheckinRecord =>
        !!item && typeof item.date === 'string' && (item.status === 'success' || item.status === 'already'),
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function saveRecords(records: CheckinRecord[]): void {
  storage.set(RECORDS_KEY, records)
}

/** 写入 / 覆盖某一天的记录（同一天重复确认以最后一次为准） */
export function upsertRecord(record: CheckinRecord): CheckinRecord[] {
  const records = loadRecords()
  const next = [record, ...records.filter((item) => item.date !== record.date)]
  saveRecords(next)
  return next
}

export function findRecord(records: CheckinRecord[], date: string): CheckinRecord | undefined {
  return records.find((item) => item.date === date)
}

export function clearRecords(): void {
  storage.remove(RECORDS_KEY)
}

/* --------------------------------- 设置 --------------------------------- */

export function loadSettings(): CheckinSettings {
  const saved = storage.get<Partial<CheckinSettings>>(SETTINGS_KEY, {})
  const merged = { ...DEFAULT_SETTINGS, ...saved }
  // 防御：本地数据可能被改坏，字段不合法时回落默认值
  return {
    ...merged,
    reminderHour: clampInt(merged.reminderHour, 0, 23, DEFAULT_SETTINGS.reminderHour),
    reminderMinute: clampInt(merged.reminderMinute, 0, 59, DEFAULT_SETTINGS.reminderMinute),
    openMode: merged.openMode === 'package' ? 'package' : 'name',
    appName: merged.appName.trim() || DEFAULT_SETTINGS.appName,
    packageName: merged.packageName.trim(),
    className: merged.className.trim(),
  }
}

export function saveSettings(settings: CheckinSettings): void {
  storage.set(SETTINGS_KEY, settings)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? Math.round(value) : Number.NaN
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

/* ------------------------------ 去签到的挂起态 ------------------------------ */

/** 记录「刚打开 Amoo」的时间；回前台时据此判断是否弹确认卡 */
export function setPendingLaunchAt(at: number | null): void {
  if (at === null) storage.remove(LAUNCH_KEY)
  else storage.set(LAUNCH_KEY, at)
}

export function getPendingLaunchAt(): number | null {
  const value = storage.get<number | null>(LAUNCH_KEY, null)
  return typeof value === 'number' ? value : null
}

/* --------------------------------- 统计 --------------------------------- */

export interface CheckinStats {
  /** 连续签到天数（今天未签不断档，从昨天往前数） */
  streak: number
  /** 累计 A 豆（仅统计用户填了数量的记录） */
  totalBeans: number
  /** 本月已签天数 */
  monthDone: number
  /** 本月已过天数（含今天） */
  monthTotal: number
  /** 历史签到率 = 有记录的天数 / 从首次签到至今的天数 */
  rate: number
  /** 历史签到总天数 */
  totalDays: number
}

export function computeStats(records: CheckinRecord[], now: Date = new Date()): CheckinStats {
  const doneDates = new Set(records.map((item) => item.date))
  const today = dateKey(now)

  let streak = 0
  // 今天还没签到时不算断档：从昨天开始往前数
  let cursor = doneDates.has(today) ? today : shiftDays(today, -1)
  while (doneDates.has(cursor)) {
    streak += 1
    cursor = shiftDays(cursor, -1)
  }

  const totalBeans = records.reduce((sum, item) => sum + (item.beans ?? 0), 0)

  const monthPrefix = today.slice(0, 7)
  const monthDone = records.filter((item) => item.date.startsWith(monthPrefix)).length
  const monthTotal = now.getDate()

  const first = records.length > 0 ? records[records.length - 1].date : today
  const spanDays = Math.max(1, Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${first}T00:00:00`).getTime()) / 86_400_000) + 1)
  const rate = records.length === 0 ? 0 : Math.min(1, records.length / spanDays)

  return {
    streak,
    totalBeans,
    monthDone,
    monthTotal,
    rate,
    totalDays: records.length,
  }
}

/** 记录按月份分组（新 → 旧），供历史页渲染 */
export function groupByMonth(records: CheckinRecord[]): Array<{ month: string; items: CheckinRecord[] }> {
  const groups = new Map<string, CheckinRecord[]>()
  for (const record of records) {
    const month = record.date.slice(0, 7)
    const list = groups.get(month)
    if (list) list.push(record)
    else groups.set(month, [record])
  }
  return [...groups.entries()].map(([month, items]) => ({ month, items }))
}
