# 打包说明

本项目按私有免安装桌面工具交付。

## 包类型

- `NexusAPI-Evaluator-macOS-x64-Standard.zip`：macOS 标准版，隐藏内容安全合规测试。
- `NexusAPI-Evaluator-macOS-x64-Internal-Risk.zip`：macOS 内部风控版，显示内容安全合规测试。
- `NexusAPI-Evaluator-Windows-x64-Standard.zip`：Windows 标准版，隐藏内容安全合规测试。
- `NexusAPI-Evaluator-Windows-x64-Internal-Risk.zip`：Windows 内部风控版，显示内容安全合规测试。

最终使用者不需要安装 Node.js、pnpm、Rust 或 Tauri。这些只在开发和 CI 打包时需要。

每个 zip 包内都有 `版本说明.txt`，用于确认当前包是标准版还是内部风控版。

## 运行机制

桌面程序启动后，会从同一个解压目录自动拉起内置 Node.js 本地 API 服务，监听 `127.0.0.1`。

- 默认从 `5180` 开始查找可用端口。
- 永远不使用 `17891` 这类保护端口。
- 不会停止或修改用户电脑上的任何已有进程。
- 退出时只会清理本程序自己启动的子进程。
- 用户需要查看和导出的报告、日志保存在 `NexusAPI数据/`。

标准版会设置 `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=0`，隐藏内部内容安全合规测试。

内部风控版会设置 `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=1`，显示内容安全合规测试。这个版本只交给负责人或受训测试人员，不要发给普通外包人员。

## GitHub Actions 打包

workflow 文件在 `.github/workflows/release.yml`。

手动打包：

1. 打开 GitHub 私有仓库。
2. 进入 `Actions`。
3. 选择 `Build desktop packages`。
4. 点击 `Run workflow`。
5. 等 4 个任务都通过后，下载 artifacts 里的 zip 包。

Release 打包：

1. 创建并推送 tag，例如 `v0.1.1`。
2. GitHub Actions 会自动打包 macOS/Windows 的标准版和内部风控版。
3. 生成的 zip 文件会上传到 GitHub Release。

## 本地打包

如果要在本机打 macOS 包，需要先准备内置 Node runtime：

```bash
mkdir -p resources/bin
cp "$(which node)" resources/bin/node
chmod 755 resources/bin/node
xattr -c resources/bin/node || true
pnpm tauri:build:standard
```

复制进去的 Node 二进制文件已加入 `.gitignore`，不会提交到 Git。

内部风控版本地打包：

```bash
pnpm tauri:build:risk
```
