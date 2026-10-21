# USB 真机联调（v0.1.1）

本轮以 STEPX Neo / PZ261A（Android 16，API 36）实机作为验证环境。原手机 APK 是可调试测试壳，应用包为 `com.stepx.aiapp.p42bd7ce9ad0b`。

## 已复现的问题与修复

1. 安装检测原生返回 `{isError:false, content:'Amoo已安装'}`，页面读取 `result.text`，导致误报“没找到”。本地 v0.1.1 兼容实际 `content` 及原有 `text`，缺少明确证据时显示“无法确认”，不会误当未安装。按包名模式改为实际已核验的 `check_app_installed_by_package`。
2. Amoo 的 `com.stepos.ailauncher` 没有普通启动入口，`open_app_by_name` 返回错误 10002；`ChatActivity` 不能经原子能力直接打开。公开的 `ChatMainActivity` 可打开聊天，但不是任务页。
3. 真机已验证 `open_app_by_package` 可打开 `com.stepos.account.StepOSAccountActivity`，其中存在“我的任务”。新安装默认使用这条路径。任务页为未对外开放的 `com.stepos.account.web.WebActivity`，保留用户点击“我的任务”的步骤，不保证从外部直接进入任务页。

“按包名打开”不是“必然直达签到页”，设置文案已更正；已安装也不再被描述成必然可以打开签到页。

## 原生契约核实

能力名、参数来自手机现有 `window.mcp.describeTool` 回执，没有猜测原生接口。新增检测能力属于已有 `ic_atomic_472` 通用原子能力连接器；连接器版本和 `includes` 保留原值，不新增危险权限。每日闹钟 `repeatDays:1` 的语义已由真机能力描述确认是“每天”。

## 本地开发与安装包的区别

本地页面通过 `adb reverse` 在 USB 上进入已安装壳的 WebView；使用调试器加载该壳已有的 SDK，业务代码不增加手写 SDK 注入或假桥。原机安装包和签名不改变。

本地页面来源是 `http://127.0.0.1:5175/`，与原平台预览页面的存储按 origin 隔离。测试记录不冒充真实领取；未经实际签到，不写成功记录。连接 USB 的页面验证不等于已生成可离线安装的 v0.1.1 APK。正式替换需要平台打包及匹配签名。

截图、APK、完整能力回执、账户与调试配置只保存在被 Git 忽略的 `.local/device-debug/`，不得上传到公开仓库。

## 验证命令

```bash
npm test
npm run typecheck
npm run build
python3 -m unittest discover -s prototype -v
```

安装检测回归测试先以原解析逻辑运行，5 项中 3 项失败；修复后 5 项通过。真机页面也已从“原生返回已安装，页面却显示没找到”变为成功提示。

其余端到端结果将在真机验证结束后更新本文件。锁屏时必须由用户解锁；调试不绕过安全锁。

## 本轮功能与用户要求的对应

| 变更 | 用户要求 |
| --- | --- |
| 修复安装检测 / 区分名称与包名模式 | “先打通现有版本真机流程” |
| 使用实测可打开的账号中心作为默认入口；旧配置可一键恢复入口 | “迭代进行 auto-check 的升级和调试”及“先打通现有版本真机流程” |
| USB 联调命令和检查 | “手机已经连接上 USB” |

## 可重复的 USB 开发命令

辅助脚本需要 Node.js 22+（App 原有工具链仍为 Node >=20.19）、Android `adb` 与 `unzip`。先手动解锁手机并在本机启动 Vite：

```bash
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
# 在另一个终端执行
npm run device:start
npm run device:check
npm run device:stop
```

`start` 使用现有 APK 的 SDK，在调试器中建立本地页面会话；`check` 校验实际页面、原生 MCP 与目标应用安装状态；`stop` 恢复原 Builder 预览。辅助工具不安装 APK、不替换签名、不修改安全锁。多设备时必须用 `ANDROID_SERIAL` 明确指定目标。

会话恢复地址含平台调试信息，只保存在 `.local/usb-session/session.json`，不能上传。若连接中断，不要删除该文件，先解锁并运行 `device:stop`。手机壳进程重启时本地调试挂钩会自然失效，安装包仍然是原版本。

## 当前验证结果与待办

- 已通过：原生 MCP 连接；Amoo 按名称的实际安装检测；修复后页面正确提示已安装；显式拉起 Amoo ChatMainActivity；经原子能力打开账号中心；在手机 UI 中进入“我的任务”。
- 已通过：`npm test` 5 项、`npm run typecheck`、`npm run build`、Python 参考模型 7 项、Git 差异空白检查。
- 辅助脚本已验证锁屏时安全失败，尚待解锁后跑通完整 start/check/stop。
- 未完成：实际领取一次签到奖励并回助手记录；TTS/震动端到端确认；临时测试闹钟的创建与关闭；v0.1.1 测试 APK 的平台打包与同签名安装。
- 中断原因：手机再次进入安全锁屏。没有绕过凭据，没有改动屏幕常亮设置，没有领取奖励或创建任何闹钟。
- 测试 APK 还需用户对发送本轮修复给 Builder 助手的明确回复；不默认发布上线。

所有“已通过”的真机结果来自旧测试壳 + USB 本地源码会话，不能等同于新版 APK 已离线安装。Vite 的大 chunk 告警仍存在，不影响构建通过。
