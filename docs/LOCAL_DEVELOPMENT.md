# 本地工程与 Builder 的对应关系

- Builder 应用：<https://studio.stepx.com/builder/app/p_42bd7ce9ad0bc85c>
- 项目 ID：`p_42bd7ce9ad0bc85c`
- GitHub：<https://github.com/krumm2012/stepx-autocheck>
- 本地目录：`/Users/krum5539/Documents/Codex/2026-10-20/ban/outputs/auto-check`
- 本地远程：`origin=https://github.com/krumm2012/stepx-autocheck.git`

本地 Git 与 Builder 不是自动双向同步。此次采用 Builder 源码快照导出后纳入 Git 的方式；没有配置平台 Git Webhook、自动导入、发布或云端执行任务。后续本地提交不会自动更新 Builder 页面或 APK。

原 Builder 的应用是半自动签到助手：打开 Amoo 后由用户完成签到，再回到助手确认并记录；没有跨 App 自动点击能力。浏览器预览的原生功能限制应以导出源码实际实现与真机验证为准。

GitHub 仓库当前为公开仓库。不要提交 `.env*`、私钥、签名文件、token、运行记录或截图中的个人信息。签名材料和平台环境配置应通过本地安全方式单独恢复，不能凭导出源码假设已有生产签名或后端凭据。

## 已导入的源码快照

- 导出日期：2026-10-21。
- 业务基线提交：`d32f2cfdc4a8abe48bbfe15ffd6feacadec8d037`。
- Builder 导出轮次提交：`8748cef`（界面显示的短提交号；不是 GitHub 提交）。
- 导出包：130,619 字节，63 个源码文件。
- SHA-256：`c62933760bd3bc1e8b51df005e50dd7379af0fbb3fbe85ce7f35673ce5633159`。
- 本地比对：解码后压缩包 SHA-256 一致；拒绝绝对路径、目录穿越、符号链接及签名/环境文件后解包。

业务源码、版本 `0.1.0`、竖屏设定和两个连接器登记保持导出值。本地增量仅为 Git 忽略规则、文档与 `scripts/setup-local.mjs` / `npm run setup:local`。没有新增原生调用，没有新增后台、后端或登录。

## 启动与检查

要求 Node.js >=20.19.0；若要执行完整壳侧构建，还需 JDK 的 `keytool`。

```bash
npm ci
npm run setup:local
npm run dev
```

`setup:local` 只在没有现存证书和配置的情况下创建随机密码的本机调试配置，再调用工程原有调试证书生成器。它保留现有配置和证书；若仅有证书而缺匹配配置，会报错，要求恢复对应配置。新调试签名与 Builder 原签名不同，不能用于正式发布或覆盖原安装包。

```bash
npm run typecheck
npm run build
python3 -m unittest discover -s prototype -v
```

本次上述三项均通过（Python 7 项测试）。完整构建会生成 `dist/client/`；本工程没有 Admin 入口。Vite 有单个 chunk 超过 500 kB 的非阻断告警，保留原有实现，本次没有做性能改造。

当前 App 不使用平台后端，未复制 `.env.local`，无需为本地页面补造后端地址和密钥。浏览器能验证页面与本地记录；打开 Amoo、系统闹钟、TTS、震动仍需匹配 STEPX 壳和真机验证。

平台的 `app-creator-skill`、`capsule-native-api`、`builder-app-packaging` 不在本地已安装技能中；本次未更改端能力契约，也没有声称跑过平台全量门禁或生成正式 APK。后续修改端能力和正式打包前，应取得对应平台技能与真实连接器契约。

## 后续 Git 工作流

```bash
git pull --ff-only origin main
git switch -c codex/your-change
# 修改后运行类型检查和构建
git add <本次修改的源码文件>
git commit
git push -u origin HEAD
```

需要回传 Builder 时，先确认平台支持的源码导入/同步流程，再传当前分支对应版本。本次未设置任何双向同步任务，不要在两边同时修改后覆盖。
