# auto-check：每日自动签到方案分析

本目录包含方案评审和可运行的账本参考模型。没有部署云服务、创建自动签到任务或操作 Amoo。

- [方案评审.md](../方案评审.md)：结论、风险、修订架构、识别策略、协议与验收计划。
- [ANDROID_FACTS.md](../ANDROID_FACTS.md)：Android / Google 官方资料核实与适用边界。
- [原始方案.txt](../原始方案.txt)：输入文件副本；原文在 OCR 代码中途截断。
- [prototype/checkin_core.py](../prototype/checkin_core.py)：Python 标准库 + SQLite 状态机与回执 outbox。
- [prototype/test_checkin_core.py](../prototype/test_checkin_core.py)：并发触发、进程中断、证据约束、回执恢复等测试。

## 验证参考代码

在本目录运行（Python 3.10+，无第三方依赖）：

```bash
python3 -m unittest discover -s prototype -v
```

本次 Python 3.14.7 下 7 项测试通过。测试只证明本地模型的这些性质，不代表 Android、Amoo 或云服务已集成或验证。

## 参考模型的调用约束

1. 上层先确认账户，按业务时区算出业务日，构造 `JobKey`。
2. `reserve()` 返回 owner 后才允许单设备执行器继续；返回 None 不能点击。
3. 观察到当日已完成，可从 RESERVED 转 ALREADY_DONE。
4. 每次真实点击前，先成功持久化 RESERVED → CLICK_INTENT，随后由 Android 适配器执行动作。
5. 只用绑定目标包、账号、业务日的已完成状态转 SUCCESS。余额变动不能独立证明成功。
6. 点击后结果不明转 NEEDS_REVIEW；不自动重点击，后续只读复核。
7. 进程重启且确认旧执行器停止后调用 `recover_after_restart()`。生产版还需查询待复核任务接口；该模型可从 SQLite 查询，未实现完整工作队列 API。
8. 独立上报 outbox；服务端持久化接收同一事件 ID 并去重后才 acknowledge。上报重试不触发 UI 重跑。

模型没有实现 Android 权限、页面识别、命令认证、时间窗口、重试预算、跨设备协调、密钥管理、云服务与播报。它也不校验视觉证据真实性：`daily_status` 证据须由可信页面适配器生成。账号和目标包在测试中均为虚构标识。

UI 副作用无法与 SQLite 原子提交。本模型保守阻止未知结果重跑，可能产生需要人工确认的漏签，不能声称 exactly-once。
