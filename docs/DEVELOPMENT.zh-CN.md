# 开发说明

## MVP 策略

第一个可用版本刻意比完整 PRD 小。当前目标是先把核心评测流程跑通，保证非技术人员可以完成基础试用。

当前目标：

1. API 配置管理。
2. 快速模型连通性测试。
3. 基础延迟和响应记录。
4. 只保存在本机的请求日志。
5. 非技术人员能理解的操作界面。

当前已实现：

1. Vite 前端壳。
2. Tauri 2 桌面壳。
3. 临时 Node 本地 API 服务。
4. OpenAI-compatible 和 Claude Messages API 的快速连通性测试。
5. 一键标准评测，串联快速测试、低轮稳定性测试和少量场景初筛。
6. 多轮稳定性测试。
7. 本地 Markdown 报告生成。
8. 多 API 配置批量稳定性测试。
9. 内置场景测试和基于规则的质量评分。
10. 报告中心模型/渠道排行榜。
11. 支持进度轮询和取消的任务运行器。
12. 操作模板、执行前 token 预估和执行确认。
13. API 配置脱敏导出/导入。
14. Markdown 和 HTML 报告生成。
15. API 配置模板、场景包、错误处理建议和标准评测下一步建议。
16. 本次测试信息保存，并自动写入交付模板。
17. 保存 API 配置前的基础检查器，以及标准评测后的人话结论和下一步按钮。
18. GitHub Actions 免安装桌面包，区分普通版和内部风控版。
19. 本地 HTTP 安全边界、请求体限制、静态路径保护、日志裁剪和上游响应大小保护。

暂缓项：

1. Rust 本地代理。
2. SQLite。
3. 更正式的跨平台系统级安全密钥存储。
4. AI 裁判评分。
5. 更完整的打包后桌面应用自动化验收。

## 本地命令

启动临时 API 服务：

```bash
pnpm dev:server
```

启动 Web 前端：

```bash
pnpm dev
```

启动桌面壳：

```bash
pnpm dev:desktop
```

按交付对象启动：

```bash
pnpm dev:desktop:standard
pnpm dev:desktop:risk
```

- `standard`：普通版，隐藏内容安全合规包。
- `risk`：内部风控版，显示内容安全合规包。

使用自定义端口：

```bash
VITE_PORT=5181 API_PORT=5182 pnpm dev:desktop
```

也可以创建本地 `dev.config.json`：

```json
{
  "vitePort": 5181,
  "apiPort": 5182,
  "portMode": "auto",
  "protectedPorts": [17891]
}
```

环境变量优先级高于 `dev.config.json`。

启动脚本会检查本地端口，但绝不会关闭已有进程。如果配置的前端端口已经是本项目页面，脚本会复用它，不会再启动一个 Vite 服务。如果端口被其他服务占用，脚本会给出简单冲突提示；可读取到占用程序时，会显示占用信息用于排查。`portMode: "auto"` 会为当前运行选择空闲端口，`portMode: "manual"` 会停止并提示可选空闲端口。

这个策略是刻意设计的，因为本地端口可能属于浏览器、代理、数据库、VPN 或其他重要开发工具。

默认启动提示要面向普通使用者隐藏端口细节。需要维护人员诊断时，设置：

```bash
SHOW_TECHNICAL_PORT_DETAILS=1 pnpm dev:desktop
```

`protectedPorts` 用来声明工具绝不能使用的端口。`17891` 默认受保护，因为它可能是本机 VPN/代理端口。其他关键端口也应该加入这里，而不是依赖用户记忆。

验证命令：

```bash
pnpm test
pnpm check
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

如果修改桌面启动器或端口策略，还要执行：

```bash
node --check scripts/dev-desktop.mjs
node --check scripts/port-policy.mjs
API_PORT=17891 PORT_MODE=manual node scripts/dev-desktop.mjs
```

最后一条命令必须输出友好的保护端口提示，并且不能启动任何本地服务。

## 为什么先做本地 Web MVP

项目先从本地 Web MVP 开始，现在加了 Tauri 桌面壳。当前 Node API 服务是临时实现，用来快速验证评测流程、页面交互、日志和报告。

在 M1/M2 之后，本地服务应逐步迁移到 Tauri 命令和 Rust 模块，减少长期维护成本。

## 下一阶段工程里程碑

### M0

- 启动本地应用。
- 添加 API 配置。
- 跑通一个 OpenAI-compatible 测试。
- 跑通一个 Claude Messages 测试。

### M1

- 增加多轮稳定性测试。
- 保存测试运行记录和请求记录。
- 生成 Markdown 报告。

当前 M1 仍运行在临时 Node 服务中。它已经可以用于操作流程验证，但正式交付前应迁移到 Rust/Tauri 模块。

## 本地数据文件

- `NexusAPI数据/配置/profiles.json`：本地 API 配置元数据，不能包含明文 API Key。
- `NexusAPI数据/.vault/local-secret.key`：本地加密 vault 兜底方案使用的加密密钥。
- `NexusAPI数据/.vault/key-vault.json`：当 macOS Keychain 不可用或在非 macOS 系统上使用时的加密 Key vault。
- `NexusAPI数据/日志/requests.jsonl`：每次请求一行 JSON，包含延迟、状态码、归一化错误、token 用量和输出摘要。
- `NexusAPI数据/日志/test-runs.jsonl`：每次稳定性测试一行 JSON。
- `NexusAPI数据/日志/task-events.jsonl`：任务完成、失败、取消、中断恢复等生命周期事件。
- `NexusAPI数据/日志/errors.jsonl`：技术错误日志，保存内部错误、前端错误和任务失败细节；前端只展示错误编号和非技术用户可理解的提示。
- `NexusAPI数据/报告/*.md`：给非技术测试人员或协作测试人员使用的 Markdown 报告。
- `NexusAPI数据/报告/*.html`：更方便阅读和分享的 HTML 报告。

长时间测试的稳定性约束：

- JSONL 日志会自动保留最近尾部内容，避免连续测试几小时后日志无限增长。
- 请求记录、错误记录和任务记录页面只读取日志尾部，不会为了展示最近记录而整文件读入内存。
- 单次上游响应有大小上限。超过保护限制会记录为 `response_too_large`，这是为了防止异常错误页、网关回包或失控输出拖垮本地工具。
- 长任务完成后，内存里只保留摘要和报告路径，完整 Markdown/HTML 报告写入 `NexusAPI数据/报告/`。
- 批量稳定性测试不会在汇总结果里嵌套保存每个子测试的完整报告，只保留子测试报告路径。
- 请求日志和报告会对常见 Key、Bearer Token、Authorization、password、secret 等内容做脱敏，但维护人员仍应避免把真实 Key 写进 Prompt 或模型名称。

## 当前模块边界

后端：

- `server.mjs` 只负责 HTTP 路由和静态文件服务。
- `server/http-request.mjs` 负责请求体读取、JSON 格式错误和请求体大小限制。
- `server/static-paths.mjs` 负责静态文件和文档文件的安全路径解析，避免目录穿越。
- `server/error-log.mjs` 负责错误编号、技术错误日志、敏感信息脱敏和用户友好错误文案。
- `server/test-runner.mjs` 负责快速测试、稳定性测试、批量测试、场景测试和上游 API 请求。
- `server/scenario-evaluator.mjs` 负责场景输出的规则化评分。
- `server/scenarios/*.mjs` 负责按分类维护内置测试场景；内容安全场景独立放在 `server/scenarios/safety.mjs`。
- `server/diagnostics.mjs` 负责错误诊断文案。
- `server/task-manager.mjs` 负责长任务创建、取消、进度、事件记录和任务公开视图。
- `server/reporting.mjs` 负责 Markdown 报告，`server/report-html.mjs` 负责 HTML 渲染。
- `server/profile-store.mjs` 和 `server/secret-store.mjs` 负责 API 配置和 Key 存储。
- `server/support-bundle.mjs` 负责一键导出问题包，只聚合脱敏摘要和最近诊断信息。

前端：

- `src/app.js` 负责页面装配、页面切换、数据加载和模块编排。
- `src/client-error-reporter.js` 负责捕获前端未处理异常，并在写入本地日志前脱敏。
- `src/*-controller.js` 负责具体页面或流程的表单提交和业务编排。
- `src/*-view.js` 负责可复用展示模板。
- `src/delivery-view.js` 负责报告洞察卡片、模型/渠道排行榜和交付模板。
- `src/workflow-guide.js` 负责首页下一步建议。
- `src/cost-estimates.js` 负责 token 消耗预估。
- `src/formatters.js` 负责状态和结果展示格式化。
- `src/operator-guidance.js` 负责面向非技术操作员的配置模板、场景包、错误处理建议和标准评测下一步建议。

维护原则：

- 不要把测试执行逻辑重新写回 `server.mjs`。
- 不要把大段展示模板、业务判断或测试流程重新堆回 `src/app.js`。
- 可独立判断、可独立渲染的逻辑，应拆成纯函数并补测试。
- 标准评测只做前端编排，复用已有接口；如果后续要改成后端任务，需要保留现有取消、进度和报告机制。
- 排行榜综合分只是快速筛选指标，算法变化必须同步更新使用手册。
- 配置模板、场景包、错误建议和下一步建议面向非技术人员，文案必须清楚、短句、可执行，不要写成开发者日志。
- 普通版使用 `pnpm dev:desktop:standard` 或 `pnpm tauri:build:standard`，会通过 `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=0` 关闭内容安全场景，避免普通测试人员误用。
- 内部风控版使用 `pnpm dev:desktop:risk` 或 `pnpm tauri:build:risk`，会显示内容安全合规包。
- 内容安全场景只允许使用模拟违规请求，不允许加入具体违法步骤、露骨细节、真实政治事件或真实个人隐私。
- 配置检查器只做“保存前明显风险拦截”，不能替代真实快速测试；后续新增规则要避免误伤合法中转路径。
- 标准评测下一步按钮只是操作引导，不能偷偷启动高成本测试，必须让用户在目标页面再次确认。
- 涉及 API Key、Prompt、响应正文的日志改动，必须确认不会泄露敏感信息。
- 新增本地 HTTP 接口必须使用带大小限制的 JSON 读取，并对错误输入返回非技术用户可理解的提示。
- 静态文件或文档文件访问必须走 `server/static-paths.mjs`，不要直接用 `startsWith` 做路径安全判断。
- 上游 API 响应必须带大小限制读取；测试执行代码里不要直接调用 `response.text()`。
- JSONL 日志会保留尾部并控制大小，最近记录读取只读尾部；不要改回整文件读取。
- 长任务状态只保留摘要和报告路径，完整 Markdown 报告只写入 `NexusAPI数据/报告/`，不要长期放在内存里。
- 批量测试内部结果不要嵌套完整子报告，避免多 API 长跑时内存和报告体积膨胀。

## 操作员测试流程

1. 添加或确认 API 配置。
2. 普通操作员优先跑标准评测，完成连通、低轮稳定性和少量场景初筛。
3. 标准评测通过后，进入报告中心查看极简结论、排行榜和报告路径。
4. 需要交付时进入测试交付页，复制交付模板并附上报告文件。
5. URL、模型名、Key 或协议变更后，如果只想排查配置，可以单独跑快速测试。
6. 对比候选渠道或准备推荐服务商前，再进入高级复测，跑 10 轮或 30 轮稳定性测试。
7. 多渠道对比时使用批量稳定性测试：
   - `同时测试 API 数` 默认保持 2。
   - `单 API 请求并发` 默认保持 1，除非明确要测试网关并发能力。
8. 评估复杂能力时使用场景测试：
   - 初筛可以选择所有内置场景。
   - 快速筛选时 repeats 保持 1。
   - 最终候选对比时再提高到 2 或 3。
8. 汇报结果时附上生成的 Markdown 报告。

## 稳定性指标

- 成功率是最重要的可用性指标。
- 平均总延迟反映常规用户体验。
- P95 总延迟比平均值更能反映尾部延迟和不稳定情况。
- 归一化错误会把上游、网络、限流等错误归类为更容易处理的类型。
- 报告刻意排除 API Key。

## 场景指标

- 成功率仍然衡量基础可用性。
- 平均质量分是基于规则的快速筛选指标，不能作为正式模型质量结论。
- 当前质量检查包括输出长度、关键词覆盖、结构化 JSON 解析、拒答/空答检测。
- 场景报告按 API、场景、延迟、成功率和质量分对比模型。
- 正式质量评测前，应增加裁判模型模块。

## 文档维护规则

`docs/USER_MANUAL.md` 是工具内“使用手册”的来源。任何面向用户的变化，都必须在同一轮改动里更新它。

需要同步更新手册的情况：

- 页面、按钮、表单或字段名变化。
- 测试类型、默认 Prompt、轮数、并发或评分逻辑变化。
- 操作模板、执行前预估、任务进度、取消或确认流程变化。
- token 消耗假设或成本提示变化。
- 报告字段、日志字段或数据存储路径变化。
- 启动命令、端口处理或本地配置行为变化。
- 错误名称、推荐规则或操作流程变化。

规则很简单：如果非技术操作员需要知道这件事，功能完成前就必须更新手册。

### M2

- 安装 Rust。
- 用 Tauri/Rust 后端替换 Node 后端。
- 增加 SQLite 和安全密钥存储。
