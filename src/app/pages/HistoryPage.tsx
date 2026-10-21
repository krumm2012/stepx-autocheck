import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'

import emptyCheckinIllustration from '@/assets/empty-checkin.svg'
import {
  computeStats,
  dateKey,
  groupByMonth,
  loadRecords,
  type CheckinRecord,
} from '@/shared/lib/checkin'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/Feedback'
import { usePageTitle } from '../layout/PageTitle'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDay(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatClock(at: number): string {
  const date = new Date(at)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatMonth(month: string): string {
  const [year, mon] = month.split('-')
  return `${year} 年 ${Number(mon)} 月`
}

/** 当月日历：周一开头，签到日带豆点，今天高亮 */
function MonthCalendar({ records, now }: { records: CheckinRecord[]; now: Date }) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthPrefix = `${year}-${pad(month + 1)}`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // 周一为一周第一天（国内日历惯例）
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7

  const doneDates = useMemo(
    () => new Set(records.filter((item) => item.date.startsWith(monthPrefix)).map((item) => item.date)),
    [records, monthPrefix],
  )
  const todayK = dateKey(now)

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-title font-semibold">
          {year} 年 {month + 1} 月
        </p>
        <p className="text-caption text-muted-foreground tabular-nums">
          本月已签 {doneDates.size} 天
        </p>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-y-1.5 text-center">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-caption text-muted-foreground">
            {label}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const key = `${monthPrefix}-${pad(day)}`
          const done = doneDates.has(key)
          const isToday = key === todayK
          return (
            <div key={key} className="flex flex-col items-center gap-0.5">
              <span
                className={cn(
                  'text-caption tabular-nums',
                  isToday && 'font-semibold text-primary',
                  done && !isToday && 'font-medium text-foreground',
                  !done && !isToday && 'text-muted-foreground',
                )}
              >
                {day}
              </span>
              <span
                className={cn('size-1.5 rounded-full', done ? 'bg-primary' : 'bg-transparent')}
                aria-hidden
              />
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** 签到记录：统计 + 当月日历 + 按月分组列表 */
export function HistoryPage() {
  usePageTitle('签到记录')
  const navigate = useNavigate()
  const [records] = useState<CheckinRecord[]>(loadRecords)

  const now = new Date()
  const stats = computeStats(records, now)
  const groups = useMemo(() => groupByMonth(records), [records])

  if (records.length === 0) {
    return (
      <div className="page">
        <EmptyState
          illustration={<img src={emptyCheckinIllustration} alt="" className="h-28" />}
          title="还没有签到记录"
          description="今天去签到，记录会出现在这里"
          action={<Button onClick={() => navigate('/')}>去今天看看</Button>}
        />
      </div>
    )
  }

  return (
    <div className="page space-y-3">
      {/* 统计 */}
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
            <p className="text-title font-semibold tabular-nums">{Math.round(stats.rate * 100)}%</p>
            <p className="mt-0.5 text-caption text-muted-foreground">历史签到率</p>
          </div>
        </div>
      </Card>

      <MonthCalendar records={records} now={now} />

      {/* 按月分组的记录列表 */}
      {groups.map((group) => (
        <div key={group.month}>
          <p className="px-1 pb-1.5 pt-2 text-caption text-muted-foreground">{formatMonth(group.month)}</p>
          <Card>
            {group.items.map((record) => (
              <div key={record.date} className="list-row py-3">
                <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-body">{formatDay(record.date)}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">{formatClock(record.at)} 确认</p>
                </div>
                {record.status === 'success' ? (
                  <Badge tone="success">已签到</Badge>
                ) : (
                  <Badge tone="primary">已签过</Badge>
                )}
                {record.beans !== null && (
                  <span className="w-12 text-right text-body font-medium tabular-nums">+{record.beans}</span>
                )}
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  )
}
