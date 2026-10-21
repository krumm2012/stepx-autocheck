import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Search, Trash2 } from 'lucide-react'

import { callAbility, isAbilityBridgeAvailable } from '@/shared/native/abilities'
import {
  clearRecords,
  loadSettings,
  saveSettings,
  type CheckinSettings,
} from '@/shared/lib/checkin'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Dialog } from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Switch } from '@/shared/ui/Input'
import { useToast } from '@/shared/ui/Toast'
import { usePageTitle } from '../layout/PageTitle'

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 设置页：每日提醒（系统闹钟）、打开方式、反馈开关、数据管理 */
export function SettingsPage() {
  usePageTitle('设置')
  const { toast } = useToast()

  const [settings, setSettings] = useState<CheckinSettings>(loadSettings)
  const [abilityReady, setAbilityReady] = useState<boolean | undefined>(undefined)
  const [timeDialogOpen, setTimeDialogOpen] = useState(false)
  const [draftHour, setDraftHour] = useState(String(settings.reminderHour))
  const [draftMinute, setDraftMinute] = useState(String(settings.reminderMinute))
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  useEffect(() => {
    void isAbilityBridgeAvailable().then(setAbilityReady)
  }, [])

  const deviceOnly = abilityReady === false

  const patch = useCallback((next: Partial<CheckinSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next }
      saveSettings(merged)
      return merged
    })
  }, [])

  /** 提醒开关：开 = 建系统闹钟（每天重复）；关 = 停用该时间的闹钟 */
  const toggleReminder = useCallback(
    async (enabled: boolean) => {
      if (deviceOnly) {
        toast({ title: '需要在手机 App 里使用', description: '浏览器预览无法设置闹钟', tone: 'warning' })
        return
      }
      try {
        if (enabled) {
          await callAbility('alarm_clock_add', {
            hour: settings.reminderHour,
            minute: settings.reminderMinute,
            label: '签到提醒',
            repeatDays: 1, // 每天
            vibrate: true,
          })
          toast({
            title: `已开启每日提醒`,
            description: `每天 ${formatTime(settings.reminderHour, settings.reminderMinute)} 提醒你签到`,
          })
        } else {
          await callAbility('alarm_clock_disable_one', {
            hour: settings.reminderHour,
            minute: settings.reminderMinute,
          })
          toast({ title: '已关闭每日提醒' })
        }
        patch({ reminderEnabled: enabled })
      } catch (error) {
        toast({
          title: enabled ? '开启提醒失败' : '关闭提醒失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          tone: 'danger',
        })
      }
    },
    [deviceOnly, patch, settings.reminderHour, settings.reminderMinute, toast],
  )

  const openTimeDialog = useCallback(() => {
    setDraftHour(String(settings.reminderHour))
    setDraftMinute(String(settings.reminderMinute))
    setTimeDialogOpen(true)
  }, [settings.reminderHour, settings.reminderMinute])

  /** 改提醒时间：已开启时先停用旧闹钟再建新闹钟（接口没有「更新」，只能删旧建新） */
  const saveReminderTime = useCallback(async () => {
    const hour = Number(draftHour)
    const minute = Number(draftMinute)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      toast({ title: '小时需要在 0 到 23 之间', tone: 'warning' })
      return
    }
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      toast({ title: '分钟需要在 0 到 59 之间', tone: 'warning' })
      return
    }
    const changed = hour !== settings.reminderHour || minute !== settings.reminderMinute
    if (!changed) {
      setTimeDialogOpen(false)
      return
    }
    if (settings.reminderEnabled) {
      if (deviceOnly) {
        toast({ title: '需要在手机 App 里使用', description: '浏览器预览无法设置闹钟', tone: 'warning' })
        return
      }
      try {
        await callAbility('alarm_clock_disable_one', {
          hour: settings.reminderHour,
          minute: settings.reminderMinute,
        })
        await callAbility('alarm_clock_add', {
          hour,
          minute,
          label: '签到提醒',
          repeatDays: 1,
          vibrate: true,
        })
      } catch (error) {
        toast({
          title: '修改提醒时间失败',
          description: error instanceof Error ? error.message : '请稍后重试',
          tone: 'danger',
        })
        return
      }
    }
    patch({ reminderHour: hour, reminderMinute: minute })
    setTimeDialogOpen(false)
    toast({ title: `提醒时间已改为 ${formatTime(hour, minute)}` })
  }, [deviceOnly, draftHour, draftMinute, patch, settings, toast])

  const checkInstalled = useCallback(async () => {
    if (deviceOnly) {
      toast({ title: '需要在手机 App 里使用', description: '浏览器预览无法读取应用列表', tone: 'warning' })
      return
    }
    try {
      const result = await callAbility('check_app_installed_by_name', { appName: settings.appName })
      const text = typeof result.text === 'string' ? result.text : ''
      const installed = text.includes('已安装') && !text.includes('未安装')
      toast({
        title: installed ? `${settings.appName} 已安装` : `没找到「${settings.appName}」`,
        description: installed ? '可以正常打开签到' : '请在设置里换成正确的应用名，或改用包名直达',
        tone: installed ? 'success' : 'warning',
      })
    } catch (error) {
      toast({
        title: '检测失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        tone: 'danger',
      })
    }
  }, [deviceOnly, settings.appName, toast])

  return (
    <div className="page space-y-3">
      {/* 每日提醒 */}
      <div>
        <p className="px-1 pb-1.5 text-caption text-muted-foreground">每日提醒</p>
        <Card>
          <div className="px-4">
            <Switch
              checked={settings.reminderEnabled}
              onChange={(checked) => void toggleReminder(checked)}
              disabled={deviceOnly}
              label="每天提醒我签到"
            />
          </div>
          <button
            type="button"
            onClick={openTimeDialog}
            className="list-row w-full py-3 text-left active:bg-accent"
          >
            <span className="flex-1 text-body">提醒时间</span>
            <span className="text-body tabular-nums text-muted-foreground">
              {formatTime(settings.reminderHour, settings.reminderMinute)}
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </Card>
        {deviceOnly && (
          <p className="px-1 pt-1.5 text-caption text-muted-foreground">
            浏览器预览无法设置闹钟，请到真机开启。
          </p>
        )}
      </div>

      {/* 打开方式 */}
      <div>
        <p className="px-1 pb-1.5 text-caption text-muted-foreground">打开方式</p>
        <Card>
          <div className="px-4">
            <Switch
              checked={settings.openMode === 'package'}
              onChange={(checked) => patch({ openMode: checked ? 'package' : 'name' })}
              label={
                <span>
                  直达签到页
                  <span className="mt-0.5 block text-caption font-normal text-muted-foreground">
                    关闭时按应用名打开，进入任务页自己点
                  </span>
                </span>
              }
            />
          </div>
          {settings.openMode === 'package' ? (
            <div className="space-y-3 p-4">
              <Input
                label="应用包名"
                placeholder="例如 com.example.amoo"
                value={settings.packageName}
                onChange={(event) => patch({ packageName: event.target.value })}
                hint="Amoo 的 Android 包名，必填"
              />
              <Input
                label="签到页页面名（选填）"
                placeholder="例如 com.example.amoo.TaskActivity"
                value={settings.className}
                onChange={(event) => patch({ className: event.target.value })}
                hint="Activity 全限定类名，填了一步直达签到页"
              />
            </div>
          ) : (
            <div className="p-4">
              <Input
                label="应用名"
                placeholder="Amoo"
                value={settings.appName}
                onChange={(event) => patch({ appName: event.target.value })}
                hint="系统里显示的应用名，支持简称"
              />
            </div>
          )}
        </Card>
      </div>

      {/* 反馈 */}
      <div>
        <p className="px-1 pb-1.5 text-caption text-muted-foreground">反馈</p>
        <Card>
          <div className="px-4">
            <Switch
              checked={settings.speakEnabled}
              onChange={(checked) => patch({ speakEnabled: checked })}
              label="确认后语音播报"
            />
          </div>
          <div className="px-4">
            <Switch
              checked={settings.hapticEnabled}
              onChange={(checked) => patch({ hapticEnabled: checked })}
              label="确认后震动反馈"
            />
          </div>
        </Card>
      </div>

      {/* 其他 */}
      <div>
        <p className="px-1 pb-1.5 text-caption text-muted-foreground">其他</p>
        <Card>
          <button
            type="button"
            onClick={() => void checkInstalled()}
            className="list-row w-full py-3 text-left active:bg-accent"
          >
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-body">检测{settings.appName}是否安装</span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          <div className="px-4 py-2">
            <Button
              variant="danger-ghost"
              block
              onClick={() => setClearDialogOpen(true)}
            >
              <Trash2 className="size-4" aria-hidden />
              清空签到记录
            </Button>
          </div>
        </Card>
      </div>

      <p className="pb-2 text-caption text-muted-foreground">
        签到记录只保存在本机。受平台能力限制，App
        不能代替你点击其他应用，每日提醒通过系统闹钟实现——响铃后打开助手，一键到达签到页。
      </p>

      {/* 提醒时间选择 */}
      <Dialog
        open={timeDialogOpen}
        onClose={() => setTimeDialogOpen(false)}
        title="提醒时间"
        description="每天在这个时间提醒你签到"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTimeDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void saveReminderTime()}>保存</Button>
          </>
        }
      >
        <div className="flex items-end gap-3">
          <Input
            label="小时"
            inputMode="numeric"
            maxLength={2}
            value={draftHour}
            onChange={(event) => setDraftHour(event.target.value.replace(/\D/g, ''))}
          />
          <Input
            label="分钟"
            inputMode="numeric"
            maxLength={2}
            value={draftMinute}
            onChange={(event) => setDraftMinute(event.target.value.replace(/\D/g, ''))}
          />
        </div>
      </Dialog>

      {/* 清空记录确认 */}
      <Dialog
        open={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        title="清空签到记录"
        description="所有签到历史与统计都会被删除，且无法恢复。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setClearDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearRecords()
                setClearDialogOpen(false)
                toast({ title: '签到记录已清空', tone: 'success' })
              }}
            >
              确认清空
            </Button>
          </>
        }
      />
    </div>
  )
}
