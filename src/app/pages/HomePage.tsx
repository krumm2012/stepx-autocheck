import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCircle2, ChevronRight, CircleHelp, LogIn } from 'lucide-react'

import { onNativeEvent, invokeNative } from '@/shared/bridge'
import { callAbility, isAbilityBridgeAvailable } from '@/shared/native/abilities'
import {
  CONFIRM_WINDOW_MS,
  computeStats,
  findRecord,
  getPendingLaunchAt,
  loadRecords,
  loadSettings,
  setPendingLaunchAt,
  todayKey,
  upsertRecord,
  type CheckinRecord,
  type CheckinStatus,
} from '@/shared/lib/checkin'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { useToast } from '@/shared/ui/Toast'
import { usePageTitle } from '../layout/PageTitle'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function formatToday(now: Date): string {
  return `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}`
}

function formatClock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function parseBeans(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return null
  return Math.round(value)
}

/**
 * 「今天」页：今日签到状态 + 一键打开 Amoo + 回前台确认 + 统计概览。
 *
 * 交互主线（对应设计文档的「唤醒 → 校验 → 回执」）：
 *  点「打开 Amoo 签到」→ 拉起目标 App（可直达签到页）→ 用户手动点签到 →
 *  回到本页时（appShow）出现确认卡 → 选结果，记录 + 播报 + 震动。
 */
export function HomePage() {
  usePageTitle('今天')
  const navigate = useNavigate()
  const { toast } = useToast()

  const [records, setRecords] = useState<CheckinRecord[]>(loadRecords)
  // 设置由设置页维护；Tab 切回本页会重新挂载、重新读取，首页只消费
  const [settings] = useState(loadSettings)
  const [pendingLaunchAt, setPending] = useState(getPendingLaunchAt)
  const [abilityReady, setAbilityReady] = useState<boolean | undefined>(undefined)
  const [opening, setOpening] = useState(false)
  const [beansInput, setBeansInput] = useState('')

  const now = new Date()
  const today = todayKey(now)
  const todayRecord = findRecord(records, today)
  const stats = computeStats(records, now)

  // 超过确认窗口的挂起态直接清掉，避免残留
  useEffect(() => {
    const launchedAt = getPendingLaunchAt()
    if (launchedAt !== null && Date.now() - launchedAt >= CONFIRM_WINDOW_MS) {
      setPendingLaunchAt(null)
      setPending(null)
    }
  }, [])

  useEffect(() => {
    void isAbilityBridgeAvailable().then(setAbilityReady)
  }, [])

  // 从 Amoo 回前台（appShow 在每次页面加载完成 / 回前台时都会推）：
  // 有挂起态就亮出确认卡。挂起态只保留 30 分钟窗口，超时不再打扰。
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void onNativeEvent('appShow', () => {
      const launchedAt = getPendingLaunchAt()
      if (launchedAt !== null && Date.now() - launchedAt < CONFIRM_WINDOW_MS) {
        setPending(launchedAt)
      }
    }).then((off) => {
      unsubscribe = off
    })
    return () => unsubscribe?.()
  }, [])

  const showConfirm = pendingLaunchAt !== null && !todayRecord && Date.now() - pendingLaunchAt < CONFIRM_WINDOW_MS

  const openTarget = useCallback(async () => {
    const ready = await isAbilityBridgeAvailable()
    if (!ready) {
      toast({
        title: '需要在手机 App 里使用',
        description: '浏览器预览打不开其他应用，请到真机验证',
        tone: 'warning',
      })
      return
    }
    setOpening(true)
    try {
      const launchedAt = Date.now()
      setPendingLaunchAt(launchedAt)
      setPending(launchedAt)
      setBeansInput('')
      if (settings.openMode === 'package' && settings.packageName) {
        await callAbility('open_app_by_package', {
          packageName: settings.packageName,
          ...(settings.className ? { className: settings.className } : {}),
        })
      } else {
        await callAbility('open_app_by_name', { appName: settings.appName })
      }
      toast({ title: `已打开${settings.appName}`, description: '点完签到后回到这里确认一下' })
    } catch (error) {
      setPendingLaunchAt(null)
      setPending(null)
      toast({
        title: '打开失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        tone: 'danger',
      })
    } finally {
      setOpening(false)
    }
  }, [settings, toast])

  const cancelConfirm = useCallback(() => {
    setPendingLaunchAt(null)
    setPending(null)
  }, [])

  const confirmResult = useCallback(
    (status: CheckinStatus) => {
      const beans = status === 'success' ? parseBeans(beansInput) : null
      const next = upsertRecord({ date: today, status, beans, at: Date.now() })
      setRecords(next)
      setPendingLaunchAt(null)
      setPending(null)

      if (settings.hapticEnabled) {
        void invokeNative('vibrateShort', { type: 'light' }).catch(() => undefined)
      }
      if (settings.speakEnabled) {
        const text =
          status === 'success'
            ? beans !== null
              ? `今日签到已完成，A 豆 +${beans}`
              : '今日签到已完成'
            : '今天已经签过了，无需重复操作'
        // 播报是附加反馈，失败不打断主流程（诊断日志已在 callAbility 内记录）
        void callAbility('speak_text', { text }).catch(() => undefined)
      }
      toast({
        title: status === 'success' ? '已记录：今日签到完成' : '已记录：今天已签过',
        tone: 'success',
      })
    },
    [beansInput, settings.hapticEnabled, settings.speakEnabled, toast, today],
  )

  const statusBadge = todayRecord ? (
    todayRecord.status === 'success' ? (
      <Badge tone="success">已签到</Badge>
    ) : (
      <Badge tone="primary">已签过</Badge>
    )
  ) : (
    <Badge tone="neutral">未签到</Badge>
  )

  return (
    <div className="page space-y-3">
      {/* 今日状态主卡 */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-body text-muted-foreground">{formatToday(now)}</p>
          {statusBadge}
        </div>
        <p className="mt-3 text-display font-semibold">
          {todayRecord
            ? todayRecord.status === 'success'
              ? '今日已签到'
              : '今天已经签过了'
            : '今天还没签到'}
        </p>
        <p className="mt-1 text-body text-muted-foreground">
          {todayRecord
            ? todayRecord.beans !== null
              ? `A 豆 +${todayRecord.beans} · ${formatClock(todayRecord.at)} 确认`
              : `${formatClock(todayRecord.at)} 确认 · 明天记得再来`
            : `打开${settings.appName}完成任务页签到，领走今天的 A 豆`}
        </p>
        {todayRecord ? (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-success/10 px-3 py-2.5 text-body text-success">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            <span>今天已办结，不用再操作</span>
          </div>
        ) : (
          <Button
            block
            size="lg"
            className="mt-4"
            variant={showConfirm ? 'outline' : 'primary'}
            loading={opening}
            onClick={() => void openTarget()}
          >
            {!opening && <LogIn className="size-5" aria-hidden />}
            {showConfirm ? '重新打开' : `打开${settings.appName}签到`}
          </Button>
        )}
      </Card>

      {/* 回前台确认卡：从 Amoo 回来才出现 */}
      {showConfirm && (
        <Card className="bg-primary-soft p-4">
          <div className="flex items-center gap-2">
            <CircleHelp className="size-5 text-primary" aria-hidden />
            <p className="text-title font-semibold">在{settings.appName}里点完了吗？</p>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            回来确认一下，助手会记录结果并语音播报
          </p>
          <div className="mt-3">
            <Input
              label="A 豆数量（选填）"
              inputMode="numeric"
              placeholder="例如 20"
              value={beansInput}
              onChange={(event) => setBeansInput(event.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={() => confirmResult('success')}>
              签到成功
            </Button>
            <Button variant="outline" onClick={() => confirmResult('already')}>
              今天已签过
            </Button>
          </div>
          <Button variant="ghost" block className="mt-2" onClick={cancelConfirm}>
            还没完成，稍后再来
          </Button>
        </Card>
      )}

      {/* 统计概览 */}
      <Card className="p-4">
        <div className="grid grid-cols-3 divide-x divide-border">
          <div className="px-1 text-center">
            <p className="text-title font-semibold tabular-nums">{stats.streak}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">连续签到（天）</p>
          </div>
          <div className="px-1 text-center">
            <p className="text-title font-semibold tabular-nums">{stats.totalBeans}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">累计 A 豆</p>
          </div>
          <div className="px-1 text-center">
            <p className="text-title font-semibold tabular-nums">
              {stats.monthDone}
              <span className="text-caption font-normal text-muted-foreground">/{stats.monthTotal}</span>
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">本月签到</p>
          </div>
        </div>
      </Card>

      {/* 提醒入口 */}
      <Card>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="list-row w-full py-3 text-left active:bg-accent"
        >
          <Bell className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-body">每日提醒</span>
          <span className="text-caption text-muted-foreground">
            {settings.reminderEnabled
              ? `${String(settings.reminderHour).padStart(2, '0')}:${String(settings.reminderMinute).padStart(2, '0')} 已开启`
              : '未开启'}
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </Card>

      {/* 能力边界说明：管理预期，避免用户以为助手能全自动 */}
      <p className="pb-2 text-caption text-muted-foreground">
        受平台能力限制，App 不能代替你点击其他应用——打开{settings.appName}
        后需要你手动点一下「签到」，剩下的记录和播报交给助手。
      </p>

      {abilityReady === false && (
        <p className="pb-2 text-caption text-muted-foreground">
          当前是浏览器预览：打开应用、语音播报等需要真机环境才能使用。
        </p>
      )}
    </div>
  )
}
