# Development Notes

[中文开发说明](DEVELOPMENT.zh-CN.md)

## MVP Strategy

The first usable version is intentionally smaller than the full PRD.

Current goal:

1. API profile management.
2. Quick model connectivity test.
3. Basic latency and response recording.
4. Local-only request log.
5. A UI that non-developers can understand.

Implemented in this stage:

1. Vite frontend shell.
2. Tauri 2 desktop shell.
3. Temporary Node local API service.
4. Quick connectivity test for OpenAI-compatible and Claude Messages APIs.
5. One-click standard evaluation that runs quick test, low-round stability test, and small scenario screening.
6. Multi-round stability test.
7. Local Markdown report generation.
8. Batch stability test for multiple API profiles.
9. Scenario test with built-in cases and rule-based quality scoring.
10. Report-center model/channel ranking.
11. Task runner with progress polling and cancellation.
12. Operator templates, pre-run token estimation, and execution confirmation.
13. Redacted profile export/import.
14. Markdown and HTML report generation.
15. API profile templates, scenario packs, failure-handling advice, and standard-evaluation next-step advice.
16. Per-batch test metadata stored locally and injected into handoff templates.
17. Pre-save API profile validation plus plain-language conclusions and next-step buttons after standard evaluation.

Deferred:

1. Tauri desktop packaging.
2. Rust local proxy.
3. SQLite.
4. Secure key storage.
5. AI scoring.
6. HTML report export.

## Local Commands

Run temporary API service:

```bash
pnpm dev:server
```

Run Web frontend:

```bash
pnpm dev
```

Run desktop shell:

```bash
pnpm dev:desktop
```

Run by target audience:

```bash
pnpm dev:desktop:standard
pnpm dev:desktop:risk
```

- `standard`: hides content-safety scenarios.
- `risk`: shows content-safety scenarios for internal risk-control testing.

Run with custom ports:

```bash
VITE_PORT=5181 API_PORT=5182 pnpm dev:desktop
```

Or create a local `dev.config.json`:

```json
{
  "vitePort": 5181,
  "apiPort": 5182,
  "portMode": "auto",
  "protectedPorts": [17891]
}
```

Environment variables have higher priority than `dev.config.json`.

The startup script checks local port availability but never kills existing processes. If the configured frontend port already serves this project, the script reuses it instead of starting another Vite process. If a port is occupied by another service, it prints a simple conflict message and, when available, the listening process for diagnosis. With `portMode: "auto"`, it chooses a free port for the current run. With `portMode: "manual"`, it stops and prints suggested free ports. This is intentional because local ports may belong to browsers, proxies, databases, VPN tools, or other important development tools.

By default, launcher messages hide port details from ordinary operators. Maintainers can enable technical diagnostics with:

```bash
SHOW_TECHNICAL_PORT_DETAILS=1 pnpm dev:desktop
```

`protectedPorts` lists ports that must not be used by the tool. `17891` is protected by default because it may be used as a local VPN/proxy port. Add any other local critical ports here instead of relying on users to remember them.

Validate:

```bash
pnpm test
pnpm check
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

When changing the desktop launcher or port policy, also run:

```bash
node --check scripts/dev-desktop.mjs
node --check scripts/port-policy.mjs
API_PORT=17891 PORT_MODE=manual node scripts/dev-desktop.mjs
```

The last command must exit with a friendly protected-port message and must not start any local service.

## Why Start With a Local Web MVP

The project started as a local Web MVP and now has a Tauri desktop shell. The current Node API service is temporary. It should be replaced by Tauri commands and Rust modules in M1/M2.

## Next Engineering Milestones

### M0

- Run local app.
- Add API profiles.
- Run one OpenAI-compatible test.
- Run one Claude Messages test.

### M1

- Add multi-round stability testing.
- Save test runs and request records.
- Generate Markdown report.

Current M1 implementation is still in the temporary Node service. It is usable for operator workflow validation, but it should later move into Rust/Tauri modules before formal delivery.

## Local Data Files

- `NexusAPI数据/配置/profiles.json`: local API profile metadata. It must not contain raw API keys.
- `NexusAPI数据/.vault/local-secret.key`: local encryption key used only by the encrypted vault fallback.
- `NexusAPI数据/.vault/key-vault.json`: encrypted API key vault used when macOS Keychain is unavailable or on non-macOS systems.
- `NexusAPI数据/日志/requests.jsonl`: one JSON line per request, with latency, status code, normalized error, token usage when returned, and output summary.
- `NexusAPI数据/日志/test-runs.jsonl`: one JSON line per stability test run.
- `NexusAPI数据/日志/task-events.jsonl`: task lifecycle events for completed, failed, cancelled, and interrupted task recovery.
- `NexusAPI数据/日志/errors.jsonl`: technical error log for internal errors, client errors, and task failures. The UI only shows user-friendly messages and error IDs.
- `NexusAPI数据/报告/*.md`: generated Markdown reports for non-technical testers or external operators.
- `NexusAPI数据/报告/*.html`: generated HTML reports for easier sharing and reading.

## Current Module Boundaries

Backend:

- `server.mjs` owns HTTP routing and static file serving only.
- `server/error-log.mjs` owns error IDs, technical error logs, sensitive-field redaction, and user-facing error messages.
- `server/test-runner.mjs` owns quick tests, stability tests, batch tests, scenario tests, and upstream API requests.
- `server/task-manager.mjs` owns long-running task creation, cancellation, progress, events, and public task views.
- `server/reporting.mjs` owns Markdown reports.
- `server/report-html.mjs` owns HTML report rendering.
- `server/scenario-evaluator.mjs` owns rule-based scenario output scoring.
- `server/profile-store.mjs` and `server/secret-store.mjs` own API profile metadata and API key storage.
- `server/support-bundle.mjs` owns one-click support bundle export with redacted summaries and recent diagnostics only.

Frontend:

- `src/app.js` owns page assembly, navigation, data loading, and module orchestration.
- `src/*-controller.js` modules own concrete page/form workflows.
- `src/*-view.js` modules own reusable presentation templates.
- `src/delivery-view.js` owns report insight cards, model/channel ranking, and handoff templates.
- `src/workflow-guide.js` owns dashboard next-step guidance.
- `src/cost-estimates.js` owns token consumption estimates.
- `src/formatters.js` owns status and result display formatting.
- `src/operator-guidance.js` owns non-technical operator guidance: profile templates, scenario packs, error advice, and standard-evaluation next steps.

Maintenance rules:

- Do not move test execution logic back into `server.mjs`.
- Do not move large presentation templates, business rules, or test workflows back into `src/app.js`.
- Logic that can be decided or rendered independently should be extracted into pure functions and tested.
- Standard evaluation is currently frontend orchestration over existing APIs. If it later moves to the backend, keep the current cancellation, progress, and reporting behavior.
- Ranking is a fast screening signal only. Any scoring change must update the user manual.
- Operator guidance copy must be short, concrete, and action-oriented. Do not expose implementation details to non-technical users.
- Profile validation is only a pre-save obvious-risk check; it does not replace the quick connectivity test. New rules must avoid blocking valid gateway prefixes.
- Standard-evaluation next-step buttons should navigate and prefill only. They must not silently start high-cost tests.
- Any log changes touching API keys, prompts, or response text must be checked for sensitive data leakage.

## Operator Testing Flow

1. Add or verify an API profile.
2. Run one quick test. If this fails, do not run a stability test yet.
3. Run a 3-round smoke test after changing URL, model, key, or protocol.
4. Run a 10-round basic stability test for normal evaluation.
5. Run a 30-round test when comparing candidate channels or before recommending a provider.
6. Use batch stability testing when comparing multiple channels:
   - Keep `同时测试 API 数` at 2 by default.
   - Keep `单 API 请求并发` at 1 unless specifically testing gateway concurrency.
7. Use scenario testing when evaluating complex task capability:
   - Start with all built-in scenarios selected.
   - Keep repeats at 1 for quick screening.
   - Increase repeats to 2 or 3 when comparing final candidates.
8. Attach the generated Markdown report when reporting results.

## Stability Metrics

- Success rate is the primary availability signal.
- Average total latency shows normal user experience.
- P95 total latency shows tail latency and instability better than the average.
- Normalized errors group upstream/network failures into actionable categories.
- The report intentionally excludes API keys.

## Scenario Metrics

- Success rate still measures basic availability.
- Average quality score is rule-based and intended for fast screening only.
- Current quality checks include output length, key point coverage, structured JSON parsing, and refusal/empty-answer detection.
- Scenario reports compare models by API, scenario, latency, success rate, and quality score.
- A future judge-model module should be added before using the score as a formal quality benchmark.

## Documentation Maintenance Rule

`docs/USER_MANUAL.md` is the source for the in-app user manual. Any user-facing change must update this file in the same change set.

Update the manual when changing:

- Pages, buttons, forms, or field names.
- Test types, default prompts, rounds, concurrency, or scoring logic.
- Operator templates, pre-run estimates, task progress, cancellation, or confirmation behavior.
- Token consumption assumptions or cost guidance.
- Report fields, log fields, or data storage paths.
- Startup commands, port handling, or local configuration behavior.
- Error names, recommendation rules, or operator workflow.

The product rule is simple: if a non-technical operator would need to know it, the manual must be updated before the feature is considered complete.

### M2

- Install Rust.
- Replace Node backend with Tauri/Rust backend.
- Add SQLite and secure key storage.
