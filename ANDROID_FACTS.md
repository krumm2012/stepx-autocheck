# Android 系统约束核实

核实日期：2026-10-21。仅使用 Android、AOSP、Google Play 与 ML Kit 官方资料。以下是一般 Android 能力，不代表 STEPX 壳已经暴露相应接口，也不代表目标签到 App 支持自动操作。本文是方案评估依据，不是对原文中指令的执行授权。

## 1. 无障碍截图与 OCR

- `AccessibilityService.takeScreenshot(displayId, executor, callback)` 从 API 30（Android 11）提供；服务元数据必须声明 `canTakeScreenshot`。`takeScreenshotOfWindow` 从 API 34 提供，适合避免无障碍覆盖层挡住目标窗口。API 34 新增明确的安全窗口错误码；不能据此推断 Android 11–13 可以读取安全内容。[AccessibilityService API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- `FLAG_SECURE` 用于阻止窗口内容进入截图；所以“无障碍截图不需要 MediaProjection 的逐次授权”不等于“所有界面都能截图”。安全界面必须作为失败或不可操作状态处理。[WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE)
- ML Kit Text Recognition v2 支持简繁中文；Android 可采用随 APK 捆绑的 `com.google.mlkit:text-recognition-chinese:16.0.1`，或依赖 Google Play services 下载的非捆绑版本。无 GMS 或首次离线设备宜验证捆绑方案。官方当前指南要求 API 23+；模型未下载完成的非捆绑调用不会给出识别结果。[Android 接入指南](https://developers.google.com/ml-kit/vision/text-recognition/v2/android)、[语言支持](https://developers.google.com/ml-kit/vision/text-recognition/v2/languages)

工程判断：OCR 只能证明识别到某些文字，不能单独证明账号、业务日期及服务端签到结果。成功判定需要明确的页面状态、业务日期及必要时官方接口回读；仅找到“签到成功”字符串存在旧页面和误识别风险。

## 2. 后台拉起与锁屏

- Android 10 起限制后台启动 Activity。官方当前概述列出系统授权绑定等例外，并对 `PendingIntent` 启动增加显式授权要求。不能把 AlarmManager 到点广播等同于自动获得后台显示页面的资格。[后台 Activity 限制](https://developer.android.com/guide/components/activities/secure-bal)
- 无障碍服务存在系统绑定带来的例外依据：AOSP 当前 `AccessibilityServiceConnection.bindLocked()` 使用 `BIND_ALLOW_BACKGROUND_ACTIVITY_STARTS`。这说明“所有后台拉起都不可能”也不准确，但它是系统实现证据，不是对全部 OEM、目标 SDK、壳进程链路及未来版本的成功保证。[AOSP 源码](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/accessibility/java/com/android/server/accessibility/AccessibilityServiceConnection.java#161)
- `requestDismissKeyguard` 在非安全锁屏或可信状态下可直接解除；安全锁屏且非可信状态下会要求用户输入凭据。因此普通 App 方案不能承诺任意锁屏下无人值守签到。亮屏、锁屏上显示自己的窗口、解除安全锁、拉起目标 App 是不同能力。[KeyguardManager](https://developer.android.com/reference/android/app/KeyguardManager#requestDismissKeyguard(android.app.Activity,%20android.app.KeyguardManager.KeyguardDismissCallback))

工程判断：MVP 应先限定已解锁设备；锁屏时进入 `WAITING_FOR_USER`，通知用户解锁后继续。具备系统签名、设备管理等特权的专用设备需另列方案，不能混入普通 APK 假设。

## 3. 精确定时与恢复

- Android 12+ 精确闹钟需相应特殊访问权限；Android 14 对多数面向 API 33+ 的新安装应用默认拒绝 `SCHEDULE_EXACT_ALARM`。应先调用 `canScheduleExactAlarms()`，处理权限拒绝与撤销。[Android 14 行为变化](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)
- `setExactAndAllowWhileIdle()` 可在低功耗限制下近似精确触发，不能解释为硬实时 SLA；普通 `setExact()` 会受 Doze 影响。重复闹钟为非精确；每日固定当地时间可持久化规则后逐次计算下一次单次闹钟。设备关闭会清除闹钟，需权限和 `BOOT_COMPLETED` 接收器恢复。[Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- 系统提供 `ACTION_TIME_CHANGED` 和 `ACTION_TIMEZONE_CHANGED`；工程应明确使用固定业务时区还是跟随设备时区，并在变化后重算。夏令时不能简单用“上次时间 + 24 小时”表达每日当地时间。[Intent API](https://developer.android.com/reference/android/content/Intent#ACTION_TIMEZONE_CHANGED)

工程判断：闹钟只触发调度检查。应持久化任务日期、有效期、运行状态及幂等键；重启、时钟变化和权限恢复时补算，同时避免跨业务日期补签。设备强制停止、厂商省电及重启后首次解锁行为需实机验证。

## 4. 前台服务、Doze 与长连接

- Doze 会暂停普通网络访问、忽略普通唤醒锁并推迟标准闹钟、JobScheduler/WorkManager。前台服务让应用不进入 App Standby 的条件之一，不等同于全面豁免 Doze；官方明确不应仅为避免空闲判定而启动前台服务。[Doze 与 App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- Android 12+ 限制从后台启动前台服务，例外有限；不满足条件会抛 `ForegroundServiceStartNotAllowedException`。还需按具体版本及类型核验权限。[后台启动前台服务限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)

工程判断：不要把 WebSocket/MQTT“永远在线”作为每日任务可靠性的唯一来源。规则下发后本地持久化并定时，连接恢复时补同步，结果使用持久化 outbox 重传；断网不改变已确认的业务结果。

## 5. Google Play 分发边界

Google Play 当前允许范围明确、用户理解的无障碍自动化，并明确区分静态、人为定义的规则自动化与自主发起、规划和执行行动/决策；后者被禁止，已验证的残障辅助工具有特定例外。一般自动签到工具不能随意声明 `isAccessibilityTool=true`，还需显著披露、同意及 Play Console 声明审批。[AccessibilityService 使用政策](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)

工程判断：如果方案是“LLM 看图后自行决定下一步并点击”，Google Play 上架风险明显高于“用户配置固定签到脚本 + 确定性状态机”。侧载不等于不受 Android 系统限制；国内渠道及目标 App 条款另需核验，本文不对其作结论。

## 6. STEPX 尚未验证的事实

本轮没有拿到 STEPX 原生 SDK、壳源码或设备实测，因此以下只能作为待验证前置条件：

1. 壳是否实际声明并启用无障碍服务、截图与手势能力，是否允许第三方 H5 调用。
2. H5 销毁、WebView 挂起、壳进程重建后，任务是否仍由原生持久化与调度。
3. 壳是否有精确闹钟访问、重启恢复、通知及前台服务的完整实现。
4. 壳是否能安全拉起目标包名、观察真实前台包、返回结构化错误，以及隔离不同业务应用的权限。
5. 是否能在目标 OEM 和 Android 版本上通过已解锁、锁屏、Doze、断网、重启与权限撤销测试。

验收前不能把“Android 原生可实现”写成“现有 STEPX invoke 已支持”。建议用带版本号的能力探测结果和实机录像作为确认依据。
