# 签到助手

> 每天提醒你去 Amoo 签到，一键打开签到页，记录连续签到与 A 豆收益。
> 由 AI Builder 的 **app-creator-skill** 生成。改代码前请先读该 Skill 的 `SKILL.md` 与 `references/` 下的规范。

## 本地迭代与源码来源

本工程来自 [STEPX Builder 自动签到系统](https://studio.stepx.com/builder/app/p_42bd7ce9ad0bc85c)，Git 仓库为 [krumm2012/stepx-autocheck](https://github.com/krumm2012/stepx-autocheck)。
此次为源码快照导入，**本地提交不会自动同步到 Builder**。来源校验、差异和后续迭代方式见 [本地开发说明](docs/LOCAL_DEVELOPMENT.md)。
之前的 [方案评审](方案评审.md)、[Android 官方核实](ANDROID_FACTS.md) 和 [Python 参考模型](prototype/checkin_core.py) 已保留；参考模型未接入当前 App。

## v0.1.1 真机修复

已修复原生 `content` 返回值导致的安装检测误报；默认通过 STEPX 账号中心进入「我的任务」，设置页提供「使用 Amoo 默认入口」以修复旧配置。原有签到记录不清空。

USB 联调与本轮实际验证边界见 [真机调试记录](docs/DEVICE_DEBUGGING.md)。

## 这个 App 做什么

- **今天**：今日签到状态 → 一键打开 Amoo 账号中心（再点「我的任务」）→ 手动点完签到回到本页确认 → 记录 + 语音播报 + 震动反馈；连续天数 / 累计 A 豆 / 本月签到概览。
- **签到记录**：统计（连续 / 累计 / 签到率）、当月日历（签到日带豆点）、按月分组的历史列表。
- **设置**：每日提醒（系统闹钟，默认 08:05）、打开方式（按应用名 / 按包名+页面）、播报与震动开关、检测 Amoo 是否安装、清空记录。

**能力边界（重要）**：平台不提供「自动点击其他 App」的接口（无无障碍 / 手势注入类端能力或连接器），
所以签到最后一下由用户手动完成；助手负责提醒、直达、记录与播报。数据只存本机，不接平台后端、无登录、无管理后台。

## 接入的平台能力

| 连接器 | 用途 | 调用入口 |
| --- | --- | --- |
| 通用原子能力（ic_atomic_472） | 打开 Amoo（按名 / 按包名直达页面）、检测安装、TTS 播报 | `src/shared/native/abilities.ts` → `window.mcp.callTool` |
| 时钟（ic_atomic_452） | 每日提醒闹钟（新建 / 停用 / 改时间） | 同上 |

原子能力走设备侧 MCP（`window.mcp`，壳 `capsule.js` 加载后可用），与 `src/shared/bridge`（`capsule.invoke`）是两条独立的桥；
普通浏览器预览没有原生桥，相关入口呈现禁用态并提示去真机验证。壳侧 `capsule/manifest.json` 的 `permissions`
不涉及危险能力（上述能力都不是 7 个危险能力之列）。

## 快速开始

```bash
npm ci
npm run setup:local  # 首次本地构建准备；需 JDK/keytool，只生成忽略的本机调试签名
npm run dev        # http://127.0.0.1:5173/  → App UI
npm test           # 设备返回值回归测试
npm run typecheck  # 类型门禁（构建不含类型检查，两条都要跑）
npm run build      # 产物：dist/client/（壳侧 bundle 内容）
npm run deps       # 依赖自愈：沙箱回收后 node_modules 丢失时按需重装（dev/build/typecheck 已自动前置）
```

本工程**没有管理后台**（无 `admin.html` / `src/admin/` / `vite.config.admin.ts`），`npm run build` 自动跳过 Admin 构建；
只交付 APK 时可用 `npm run build:client` 只出 `dist/client/`。

预览插件（`stepai-vite-config`）已配好：`npm run dev` 时提供元素点选定位、预览运行时与错误收集；`npm run build` 不会把任何调试代码打进产物。

开发前请先读 [AGENTS.md](./AGENTS.md)——它写清了改代码时必须同步维护的东西（`capsule/`、`permissions`、版本号等）。

## 数据与模块

- 签到记录 / 设置 / 「去签到」挂起态：`src/shared/lib/checkin.ts`（经 `src/shared/lib/storage.ts` 持久化到本机）。
- 统计（连续天数、累计 A 豆、签到率）：同文件 `computeStats`。
- 「回前台确认」依赖壳事件 `appShow`：点「打开 Amoo 签到」时记挂起时间，回前台 30 分钟窗口内亮出确认卡。
- 页面：`src/app/pages/`（HomePage 今天 / HistoryPage 签到记录 / SettingsPage 设置），路由见 `src/app/App.tsx`，底部 Tab 见 `src/app/layout/AppShell.tsx`。

## 构建产物与部署

`npm run build` 产出 `dist/client/`（打进 APK 的壳侧 bundle）：

```
dist/client/
├── manifest.json         # 由 capsule/manifest.json 复制而来
├── signing/              # capsule.p12 + capsule.properties
├── icon/                 # 桌面图标（capsule/icon/ 存在时才有）
└── web/                  # App UI 构建产物（manifest.entry 指向 web/index.html）
    ├── index.html
    └── assets/           # 带内容 hash
```

- **App UI 打进 APK**：`dist/client/` 整体打包成 `<applicationId>.bundle` 交给壳工程出 APK；
  `dist/client/` 里少了 `signing/` 会让 APK 构建失败。
- 入口用 `HashRouter`，路由在 `#` 之后 → 静态部署不需要任何 rewrite / fallback；`base: './'` 让产物可挂在任意子路径下。
- bundle 打包与出 APK 的完整流程见 **builder-app-packaging** skill（由平台执行，Agent 只需产出 `dist/client/`）。

## 目录结构

```
capsule/                     壳侧交付信息（构建时复制进 dist/client/）
├── manifest.json            applicationId / name / version / versionCode / entry / permissions
├── signing/                 capsule.p12 + capsule.properties（.p12 不进版本库，构建时自动生成调试证书）
└── icon/                    桌面图标 XML
scripts/
├── build.mjs                npm run build 入口：依赖自愈 → vite build → 收尾（不含类型检查）
├── finalize-build.mjs       构建收尾：校验 manifest、拼装 dist/client/
└── gen-debug-signing.mjs    生成调试签名证书
src/
├── app/                     App UI（移动端）
│   ├── App.tsx              路由表（今天 / 记录 / 设置）
│   ├── layout/AppShell.tsx  内容区 + 按需顶栏 + 底部 Tab
│   ├── layout/PageTitle.tsx 页面级 chrome 注册（usePageTitle() / useTopBleed()）
│   ├── layout/TopBleedScrim.tsx 穿透页的状态栏渐变垫底
│   └── pages/               HomePage / HistoryPage / SettingsPage
└── shared/                  App UI 与共用代码
    ├── assets/              本地图标与插图（favicon、空态插图）
    ├── bridge/              原生能力封装（业务只用 index.ts）
    ├── hooks/               useAsync / useBridgeTask
    ├── lib/                 cn / storage / format / checkin（签到数据层）
    ├── native/              原生运行态（安全区、视口单位）+ abilities.ts（设备侧 MCP 原子能力）
    ├── styles/              tokens.css（唯一色值来源）+ globals.css
    └── ui/                  基础组件
```

## 铁律（改代码时不要违反）

1. **颜色只写在 [`src/shared/styles/tokens.css`](./src/shared/styles/tokens.css)**，组件里禁止出现 `#hex` / `rgb(...)` 字面值；
   也**不要**写 `dark:` 变体——本工程只有一套配色（门禁 G10）。主色是「豆金」琥珀系（呼应 A 豆奖励心智），换色只改 token。
2. **原生能力只通过 [`@/shared/bridge`](./src/shared/bridge/index.ts) 调用**，不要在业务代码里直接 `window.capsule`；
   **原子能力只通过 [`@/shared/native/abilities`](./src/shared/native/abilities.ts)**，不要在业务代码里直接 `window.mcp`。
3. **新页面必须挂到路由表**（[`src/app/App.tsx`](./src/app/App.tsx)），并同步 `AppShell` 的 `TABS` / `ROOT_ROUTES`（底部 Tab）。
4. **所有依赖与静态资源必须本地化，禁止引用线上第三方 CDN**：图片/字体/音频先下载到 [`src/assets/`](./src/assets) 再 `import`。
   唯一的例外是壳提供的桥接 SDK `/sdk/capsule.js`（跟随当前页面主机：测试包 `appassets.t-stepos.com`，线上包 `appassets.stepaos.com`）：
   它**不静态写在源 [index.html](./index.html) 里**，由构建期插件（[`vite.config.ts`](./vite.config.ts) 的 `capsuleSdkInjectPlugin`）注入产物 HTML。
5. **预览环境的原生能力兜底只存在于 dev，真机不许有告警**：缺口上报已内置在
   [`src/shared/bridge/dev-report.ts`](./src/shared/bridge/dev-report.ts)，业务代码**不要**自己写这类兜底或告警。
6. **改了版本就要同步** `capsule/manifest.json` 的 `version` / `versionCode` 与 `src/shared/config/app.ts` 的 `APP_VERSION`。
   详见 [AGENTS.md](./AGENTS.md) §2 / §3。

## 与原生的关系

- 真机：页面依赖壳提供的 `capsule.js`（产物 HTML 里由构建期注入 `<script src="/sdk/capsule.js">`，跟随当前页面主机），
  `invokeNative()` 直达原生；原子能力经 `window.mcp.callTool` 由壳转交设备侧服务。
- 浏览器 / 平台预览：SDK 不可达，`capsule.invoke` 自动降级到 mock；`window.mcp` 不存在，原子能力入口禁用并提示去真机。
- **预览里的缺口会提示到 DevServer 终端**（`[native] ⚠ 原生能力缺口`），只提示一次；真机预览走 native，不会出现这些提示。
- 能力清单与调用规范见 **capsule-native-api** skill；连接器能力以 `inspect_connector` 的实际清单为准。
