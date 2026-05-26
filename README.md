# NexusAPI Evaluator

[中文说明](README.zh-CN.md)

Private repository. This project is proprietary and not open source.

NexusAPI Evaluator is a local model and channel evaluation tool prototype.

The current version is a local desktop MVP with a Tauri shell and a Node.js local API service. It is designed so the UI, evaluation flow, local logs, and report delivery can be tested before a production-grade backend is finalized.

## Current Capabilities

- Manage judge and target API profiles.
- Store local API profiles in `NexusAPI数据/配置/profiles.json`.
- Run a quick connectivity test against OpenAI-compatible or Claude Messages APIs.
- Run one-click standard evaluation: quick test, low-round stability test, and small scenario screening.
- Save per-batch test metadata and inject project, batch, tester, and purpose into the handoff template.
- Run multi-round stability tests with configurable rounds and light concurrency.
- Run batch stability tests across multiple API profiles without opening multiple app windows.
- Run scenario tests for connectivity, speed, structured output, coding, long context, reasoning, and business writing.
- Use operator templates, pre-run token estimates, progress display, and task cancellation for long tests.
- Use API profile templates, scenario packs, failure handling advice, and standard-evaluation next-step advice for non-technical operators.
- Export/import API profile templates without API keys.
- Record request metrics in `NexusAPI数据/日志/requests.jsonl`.
- Save stability run summaries in `NexusAPI数据/日志/test-runs.jsonl`.
- Generate Markdown and HTML reports in `NexusAPI数据/报告/`.
- Show status code, latency, token usage when returned, output summary, normalized errors, success rate, P50/P95 latency, and recommendation.
- Show a model/channel ranking board in the report center, based on success rate, P95 latency, and scenario quality score.
- Validate API profiles before saving, blocking obvious Base URL mistakes and warning about protocol, timeout, and output-length risks.
- Show a plain-language conclusion and next-step buttons after standard evaluation.
- Show non-technical user-facing errors in the UI while writing technical details to local `NexusAPI数据/日志/errors.jsonl`.
- Provide save-and-test profile flow, a plain report conclusion, and one-click support bundle export for non-technical operators.
- Keep reports and logs local. API keys are never written into request logs or reports, and common sensitive fields are redacted.
- Protect long-running tests by trimming JSONL logs, limiting single upstream response size, and keeping only task summaries plus report paths in memory after completion.

## Run Local Web UI

```bash
pnpm dev:server
pnpm dev
```

Then open:

```text
http://127.0.0.1:5179
```

## Run Desktop Shell

```bash
pnpm dev:desktop
```

Run the standard or internal risk-control edition:

```bash
pnpm dev:desktop:standard
pnpm dev:desktop:risk
```

The standard edition hides content-safety scenarios. The internal risk-control edition shows them.

The launcher encapsulates local communication ports. Normal operators do not need to understand or configure ports.

If a local communication channel is occupied, the launcher switches to a free one automatically. It never stops existing user processes and avoids protected local infrastructure such as VPN, proxy, and database ports. If automatic recovery fails, it prints a short operator-friendly message asking the user to restart the app or send the message to the maintainer.

Maintainers can set `SHOW_TECHNICAL_PORT_DETAILS=1` to print detailed port diagnostics.

## Desktop Packages

GitHub Actions builds private no-install packages for macOS and Windows:

- macOS: unzip and open `NexusAPI Evaluator.app`.
- Windows: unzip and double-click `NexusAPI Evaluator.exe`.

The packaged folder includes its own Node.js runtime and starts the local API service automatically. End users do not need to install Node.js, pnpm, Rust, or Tauri.

Packaging details:

```text
docs/PACKAGING.md
docs/PACKAGING.zh-CN.md
```

## Basic Operator Flow

1. Open the app with `pnpm dev:desktop`.
2. Add a target API profile in `API 配置`.
3. Fill the project, batch, tester, and test purpose on the dashboard.
4. Run `标准评测` first when an operator wants a guided low-cost screening flow.
5. Run `快速测试` manually when debugging URL, key, model, or protocol issues.
6. Run `稳定性测试`:
   - `3 轮` is for a quick smoke test.
   - `10 轮` is the default basic stability test.
   - `30 轮` is a more complete check.
7. Use `批量并发测试` when comparing multiple models or channels:
   - `同时测试 API 数` controls how many profiles run at the same time.
   - `单 API 请求并发` controls concurrency inside one profile.
8. Use `场景测试` when evaluating complex task capability:
   - Choose from low-cost screening, coding, long-context, full baseline, or deep candidate scenario packs.
   - Start with the low-cost screening pack.
   - Increase repeats when comparing serious candidates.
9. Review `报告中心` for summary cards, ranking, test runs, and request logs.
10. Copy the handoff template or open the saved report file under `NexusAPI数据/报告/`.

For non-technical operators, read the full Chinese guide:

```text
docs/USER_MANUAL.md
```

For maintainers, read:

```text
docs/MAINTAINING.md
```

For real API trial acceptance, use:

```text
docs/ACCEPTANCE_TEST_PLAN.md
```

## Built-in Scenario Types

- Connectivity: confirms the API can respond normally.
- Speed: tests short request latency and basic completeness.
- Structured JSON: checks whether the model follows strict JSON output requirements.
- Coding debug: checks code analysis, repair plan, and test thinking.
- Long context: checks summary and risk extraction over longer input.
- Reasoning decision: checks multi-factor business decision reasoning.
- Business writing: checks readable explanation for non-technical users.

## Security Notes

API keys are no longer written to `NexusAPI数据/配置/profiles.json`.

On macOS, keys are stored in the system Keychain when available. On other systems, or if Keychain is unavailable in a development shell, the app falls back to an encrypted local vault under `NexusAPI数据/.vault/`.

Reports, request logs, exported profiles, and generated delivery templates do not include API keys.

## License

This is a private proprietary project. See [LICENSE](LICENSE).

## Future Technical Direction

- Gradually migrate the temporary Node local service into Rust/Tauri modules.
- Add SQLite for test records and report indexes.
- Improve cross-platform system-level secure key storage.
- Add more automated acceptance checks for packaged desktop apps.
- Add a built-in local proxy and AI judge scoring if needed.
