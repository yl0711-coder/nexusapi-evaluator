# NexusAPI Evaluator 代码维护手册

本文档面向后续维护者，用来说明当前代码结构、模块职责、常见改动入口和质量检查方式。

## 1. 当前架构

项目目前是一个本地桌面 MVP：

- 前端：Vite 原生 JS 页面，负责配置录入、任务提交、进度展示、报告展示和工具内手册。
- 后端：Node.js 本地 HTTP 服务，负责配置存储、密钥读写、请求上游 API、生成日志和报告。
- 桌面壳：Tauri 2，用于打开桌面窗口。
- 数据目录：`NexusAPI数据/`，只保存在本机，已被 `.gitignore` 忽略。

## 2. 目录职责

| 路径 | 职责 |
|---|---|
| `server.mjs` | 本地 API 服务入口、HTTP 路由和静态文件服务 |
| `server/constants.mjs` | 静态文件 MIME 类型，以及旧入口兼容导出 |
| `server/ai-report-analysis.mjs` | 可选 AI 辅助报告分析的提示词、脱敏摘要和结果标准化 |
| `server/diagnostics.mjs` | 错误诊断文案 |
| `server/scenarios/*.mjs` | 分类维护内置测试场景，内容安全场景独立放在 `safety.mjs` |
| `server/data-store.mjs` | `NexusAPI数据/` 初始化、最近请求/报告/任务事件读取 |
| `server/error-log.mjs` | 技术错误日志、错误编号、敏感信息脱敏和用户友好错误文案 |
| `server/http-request.mjs` | 请求体读取、JSON 格式错误和请求体大小限制 |
| `server/paths.mjs` | 项目根目录、数据文件、报告目录等路径常量 |
| `server/profile-store.mjs` | API 配置标准化、导入导出、脱敏、明文 Key 迁移 |
| `server/protocols.mjs` | OpenAI/Claude 请求构造、响应文本提取、usage 提取、错误归类 |
| `server/reporting.mjs` | 稳定性/批量/场景 Markdown 报告、推荐结论、错误诊断 |
| `server/report-html.mjs` | Markdown 报告转 HTML 的渲染器 |
| `server/scenario-evaluator.mjs` | 场景输出的规则化评分和问题摘要 |
| `server/secret-store.mjs` | API Key 存储读取；macOS Keychain 优先，本地加密 vault 兜底 |
| `server/summaries.mjs` | 稳定性和场景测试结果汇总、P95、成功率、质量分聚合 |
| `server/support-bundle.mjs` | 一键导出问题包，聚合脱敏配置摘要、最近请求、任务、报告和错误 |
| `server/static-paths.mjs` | 静态文件和文档文件的安全路径解析，防止目录穿越 |
| `server/task-manager.mjs` | 远程任务创建、取消、进度、任务事件和任务公开视图 |
| `server/test-runner.mjs` | 快速测试、稳定性测试、批量测试、场景测试和上游请求执行 |
| `server/utils.mjs` | JSON、文本摘要、统计、转义、HTTP JSON 响应等通用工具 |
| `src/app.js` | 前端页面装配、页面切换、数据加载和模块编排入口 |
| `src/api-client.js` | 前端 API 请求封装、远程任务轮询、取消任务 |
| `src/client-error-reporter.js` | 捕获前端未处理异常，并在提交本地错误日志前脱敏 |
| `src/client-utils.js` | 前端通用工具：Markdown 渲染、HTML 转义、下载、toast、日期格式 |
| `src/clipboard.js` | 复制文本兼容封装 |
| `src/cost-estimates.js` | 请求数、token 消耗和成本风险预估 |
| `src/delivery-panel.js` | 报告中心/交付页 DOM 面板汇总渲染 |
| `src/delivery-view.js` | 报告洞察卡片、模型/渠道排行榜、交付模板和最新测试结果聚合 |
| `src/demo-data.js` | 演示模式数据 |
| `src/dom-utils.js` | 必需 DOM 元素校验 |
| `src/formatters.js` | 前端测试结果、任务状态、推荐等级等展示格式化 |
| `src/history-view.js` | 请求记录、测试报告列表、长任务事件列表渲染 |
| `src/key-modal.js` | API Key 输入弹窗 |
| `src/operator-guidance.js` | 非技术操作员引导：配置模板、场景包、错误处理建议、标准评测下一步建议 |
| `src/page-help.js` | 页面内短帮助文案 |
| `src/prompt-presets.js` | 快速测试、标准评测、稳定性和批量测试的预设 Prompt 文案和场景说明 |
| `src/profile-config-check.js` | API 配置初检提示面板 |
| `src/profile-controller.js` | API 配置保存、保存并测试、配置导入 |
| `src/profile-view.js` | API 配置列表、缺 Key 引导、配置下拉框 |
| `src/quick-failure-panel.js` | 快速测试失败后的错误归类和下一步按钮 |
| `src/quick-test-controller.js` | 快速测试表单提交流程 |
| `src/stability-view.js` | 稳定性测试摘要卡片 |
| `src/standard-eval-controller.js` | 标准评测前端编排流程 |
| `src/styles.css` | 页面样式 |
| `src/test-estimates.js` | 测试成本预估标签刷新 |
| `src/test-form-controller.js` | 稳定性/批量/场景长任务表单通用控制器 |
| `src/test-templates.js` | 稳定性、批量、场景和配置模板应用 |
| `src/workflow-guide.js` | 首页工作流状态、下一步建议和建议卡片 HTML |
| `scripts/dev-desktop.mjs` | 开发桌面启动器、端口检查、子进程启动和退出清理 |
| `scripts/port-policy.mjs` | 受保护端口规则，默认保护 `17891` |
| `docs/USER_MANUAL.md` | 工具内展示的中文使用手册 |
| `docs/ACCEPTANCE_TEST_PLAN.md` | 真实 API 试用验收清单 |
| `docs/DEVELOPMENT.md` | 英文开发说明 |
| `docs/DEVELOPMENT.zh-CN.md` | 中文开发说明 |
| `tests/*.test.mjs` | Node 原生测试，覆盖配置脱敏、协议适配、报告生成、任务生命周期、端口保护和前端纯函数 |

## 3. 常见改动入口

### 3.1 新增测试场景

修改：

```text
server/scenarios/basic.mjs
server/scenarios/coding.mjs
server/scenarios/long-context.mjs
server/scenarios/safety.mjs
```

按场景类型选择对应文件新增场景对象。普通能力测试不要写进 `safety.mjs`，内容安全测试也不要混进普通能力文件。建议包含：

- `id`：稳定唯一 ID，不要频繁改。
- `name`：给测试人员看的中文名称。
- `category`：如 `connectivity`、`coding`、`long_context`。
- `difficulty`：`small`、`normal`、`complex`。
- `prompt`：测试提示词。
- `minChars`：最低输出长度，用于粗略质量判断。
- `requiredAny`：命中任意关键词即可加分。
- `expectsJson`：需要严格 JSON 时设置为 `true`。
- `expectsSafetyRefusal`：内容安全场景需要检测拒绝和安全替代时设置为 `true`。

新增后同步更新：

- `docs/USER_MANUAL.md`
- 必要时更新 `docs/ACCEPTANCE_TEST_PLAN.md`

内容安全打包开关：

- 默认会加载内容安全场景。
- 如果要给普通测试人员打包，不希望暴露内容安全测试入口，可以设置 `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=0` 启动服务。
- 内容安全用例只能使用“模拟违规请求 + 不给可执行细节”的形式，不得加入真实个人隐私、真实政治事件细节、露骨内容或违法操作步骤。

### 3.2 新增协议

优先修改：

```text
server/protocols.mjs
```

重点函数：`buildProtocolRequest`、`extractOutputText`、`extractUsage`、`normalizeHttpError`。

同时修改：

- `index.html` 协议下拉框。
- `docs/USER_MANUAL.md` 协议说明。

### 3.3 调整报告结论

修改：

```text
server/reporting.mjs
```

重点函数：`buildRecommendation`、`buildScenarioRecommendation`、`formatStabilityReport`、`formatBatchReport`、`formatScenarioReport`。

可选 AI 辅助分析相关逻辑在：

```text
server/ai-report-analysis.mjs
server/test-runner.mjs
```

维护要求：

- AI 分析默认关闭，只能由用户在测试表单中主动勾选。
- AI 分析只能发送脱敏后的测试摘要，不能发送 API Key、完整原始日志、大段原始响应或完整报告。
- AI 分析是报告附加段落，不能替代本地规则结论。
- AI 分析失败不能导致主测试失败；报告应保留本地规则结论并说明 AI 分析失败原因。
- 修改 AI 分析提示词或摘要结构后，必须更新 `tests/ai-report-analysis.test.mjs` 和 `docs/USER_MANUAL.md`。

如果只是改错误解释文案，优先改：

```text
server/constants.mjs
```

### 3.4 调整测试执行或任务生命周期

测试执行优先修改：

```text
server/test-runner.mjs
```

任务创建、取消、进度和任务事件优先修改：

```text
server/task-manager.mjs
```

维护要求：

- `server.mjs` 只做 HTTP 路由和静态文件服务，不再承载具体测试执行细节。
- 新测试类型如果需要长任务，必须接入 `server/task-manager.mjs` 的任务生命周期。
- 任务事件中只能保存摘要，不能写入完整 Prompt、API Key 或大段响应正文。
- 取消任务必须通过 `cancelRequested` 和 `TaskCancelledError` 这条路径，不要直接杀本机进程。
- 运行中的历史任务在程序重启后应显示为 `interrupted`，提醒操作员重新测试。
- 修改后至少跑 `tests/task-manager.test.mjs` 和全量 `pnpm test`。

长时间运行保护：

- 单次上游响应必须通过 `readBoundedResponseText` 读取，不能直接 `response.text()`。
- 如果出现 `response_too_large`，优先按异常响应处理，不要为了“兼容大输出”直接放开上限。
- 批量稳定性测试只能在汇总里保存子测试摘要和报告路径，不能把每个子测试的完整 `reportMarkdown` 嵌进去。
- 任务完成后的内存状态只能保留摘要、报告路径和计数字段；完整报告只允许落到 `NexusAPI数据/报告/`。
- JSONL 日志写入使用 `appendJsonLine`，读取最近记录使用 `readTextTail`；不要改成无限追加加整文件读取。
- 请求日志里的 `rawError`、响应摘要和 Prompt 预览必须先脱敏再落盘。

### 3.5 调整前端展示逻辑

页面事件和数据加载保留在：

```text
src/app.js
```

可测试的展示和判断逻辑优先拆到：

```text
src/*-controller.js
src/*-view.js
src/delivery-view.js
src/workflow-guide.js
src/cost-estimates.js
src/operator-guidance.js
src/formatters.js
```

维护要求：

- `src/app.js` 只负责页面装配、页面切换、数据加载和模块编排，不要继续塞大段模板、业务判断或测试流程。
- 报告洞察、交付模板、首页下一步建议这类纯逻辑要放到独立模块，并补 Node 测试。
- 独立页面流程优先放进 `src/*-controller.js`，独立展示模板优先放进 `src/*-view.js`。
- 配置模板、场景包和错误处理建议属于操作员引导逻辑，应放在 `src/operator-guidance.js`，不要散落在 DOM 事件里。
- 配置保存前检查、人话结论和下一步按钮的判断规则也属于 `src/operator-guidance.js`；`src/app.js` 只负责表单、渲染和跳转。
- 标准评测是前端编排流程，复用现有快速测试、稳定性任务和场景任务，不要另写一套后端重复逻辑。
- 排行榜只做快速筛选，综合分算法改动必须同步更新使用手册。
- 输出到页面的 HTML 必须经过 `escapeHtml` 或确定只来自固定模板。
- 前端展示给用户的错误必须是非技术话术；堆栈、原始异常、内部接口细节只允许进入 `NexusAPI数据/日志/errors.jsonl`。
- 新增可能抛错的后端入口时，要使用错误编号返回用户提示，并把技术细节写入错误日志。
- 新增读取 JSON 请求体的后端入口必须复用 `server/http-request.mjs`，不要直接无限制读取请求体。
- 新增静态文件或文档访问必须复用 `server/static-paths.mjs`，不要直接拼接路径或用 `startsWith` 判断目录边界。
- 错误日志必须脱敏 API Key、Authorization、token、secret 等敏感字段。
- 问题包只能导出脱敏摘要，不能包含完整 API Key、完整请求正文或大段原始响应。
- 上游响应必须通过有大小限制的读取函数处理，避免异常大响应造成内存暴涨。
- JSONL 日志写入会自动裁剪到最近尾部，历史记录读取也只读尾部，避免长时间测试后 UI 卡顿。
- 任务完成后只在内存中保留摘要和报告文件路径，不保留完整 `reportMarkdown`。
- 报告中心的“极简结论”面向非技术操作员，文案要保持推荐/观察/不推荐、原因、下一步三段式。
- 修改交付模板后，至少跑 `tests/delivery-view.test.mjs`。
- 修改首页工作流后，至少跑 `tests/workflow-guide.test.mjs`。
- 修改配置模板、场景包、错误建议或标准评测下一步建议后，至少跑 `tests/operator-guidance.test.mjs`。
- 配置检查规则不能过度保守。带网关前缀的 Base URL 只能警告，不要阻止；明确带 `/v1/messages` 或 `/v1/chat/completions` 才阻止。

### 3.6 调整测试预设 Prompt

修改：

```text
src/prompt-presets.js
```

维护要求：

- 预设 Prompt 面向非技术测试人员，必须写清楚对应场景和使用建议。
- 快速测试和标准评测默认预设要保持低 token 成本，不能把长文本或复杂代码作为默认项。
- 批量测试预设要适合横向对比，同一批 API 应使用同一份 Prompt。
- 新增预设后要同步更新 `docs/USER_MANUAL.md` 的“测试文案场景”说明。
- 新增或修改预设后要更新 `tests/prompt-presets.test.mjs`。

### 3.7 调整 API Key 存储

修改：

```text
server/secret-store.mjs
server/profile-store.mjs
```

维护要求：

- 不允许把真实 Key 写入 `profiles.json`。
- 不允许把真实 Key 写入 `requests.jsonl`、`test-runs.jsonl`、报告或导出配置。
- 修改后必须用真实 Key 片段跑一次 `rg` 检查。

### 3.8 调整工具内使用手册

工具内“使用手册”直接读取：

```text
docs/USER_MANUAL.md
```

所以每次功能、字段、流程、风险提示变化，都要同步更新这个文件。

如果修改了英文说明，也要同步更新对应中文文档，例如：

- `README.md` 和 `README.zh-CN.md`
- `docs/DEVELOPMENT.md` 和 `docs/DEVELOPMENT.zh-CN.md`

### 3.8 调整启动脚本和端口策略

优先修改：

```text
scripts/dev-desktop.mjs
scripts/port-policy.mjs
```

配置示例同步修改：

```text
dev.config.example.json
```

维护要求：

- 不允许自动关闭用户本机已有程序。
- 只能在退出时清理 `scripts/dev-desktop.mjs` 自己启动的子进程。
- 端口冲突时优先自动换空闲端口；不能安全处理时，给出简单中文提示，让用户决定。
- 默认不要向普通用户暴露端口号、环境变量和命令示例；维护人员需要细节时，用 `SHOW_TECHNICAL_PORT_DETAILS=1` 打开技术诊断。
- `17891` 默认受保护，不能作为 API 服务或前端服务端口。
- 新增保护端口规则时，同步更新 `docs/USER_MANUAL.md`、`docs/DEVELOPMENT.md` 和相关测试。

修改后至少执行：

```bash
node --check scripts/dev-desktop.mjs
node --check scripts/port-policy.mjs
pnpm test
```

如果改了启动流程，还要模拟保护端口：

```bash
API_PORT=17891 PORT_MODE=manual node scripts/dev-desktop.mjs
```

预期结果：脚本应提示 `17891` 是保护端口并退出，不能启动服务，不能占用该端口。

## 4. 质量检查

每次提交前至少执行：

```bash
pnpm check
pnpm test
pnpm build
```

如果改了前端页面，还要手动打开：

```bash
pnpm dev:desktop
```

至少检查：

- 总览页能打开。
- API 配置页能显示。
- 使用手册能加载。
- 请求记录页不报错。
- 端口冲突时不会自动杀进程。
- `17891` 等受保护端口不会被启动脚本占用。

端口策略要求：

- 启动器只能停止自己启动的子进程。
- 遇到用户已有程序占用端口时，默认自动换到空闲端口。
- 不能自动处理时，只给出简单提示和可选端口，让用户决定。
- `dev.config.json` 的 `protectedPorts` 用于保护 VPN、代理、数据库等关键端口；`17891` 默认受保护。

## 5. 安全检查

真实 Key 脱敏检查示例：

```bash
rg "你的真实Key片段" NexusAPI数据 docs README.md src server server.mjs index.html
```

预期：

- 不应该在日志、报告、导出配置、文档或源码里搜到真实 Key。
- 如果 `NexusAPI数据/配置/profiles.json` 里出现 `apiKey` 字段，说明迁移或保存逻辑有问题，需要立即处理。

## 6. 当前技术债

- `src/app.js` 已完成主要拆分，后续新增页面必须优先新建 controller/view 模块，不要让入口文件重新膨胀。
- `src/styles.css` 仍是单文件样式，后续 UI 继续变复杂时可以拆成 `layout.css`、`forms.css`、`cards.css`、`reports.css`。
- 场景测试当前仍是规则评分，正式质量评测前需要接入主评测模型或人工复核流程。
- 当前界面已经做了非技术人员提示优化，但正式交付前仍需要真实协作测试人员试用反馈。
- 目前仍需继续补真实 HTTP 路由级集成测试和打包后的桌面应用验收测试。
- 正式交付前需要完成 Windows/macOS 安装包和真实用户验收。
