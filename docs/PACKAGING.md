# Packaging Guide

This project is distributed as private no-install desktop packages.

## Package Types

- `NexusAPI-Evaluator-macOS-x64.zip`: contains `NexusAPI Evaluator.app` and bundled resources.
- `NexusAPI-Evaluator-Windows-x64.zip`: contains `NexusAPI Evaluator.exe` and bundled resources.

End users do not need to install Node.js, pnpm, Rust, or Tauri. Those tools are only required for development and CI packaging.

## Runtime Design

The desktop app starts the bundled Node.js local API service from the same unzipped folder on `127.0.0.1`.

- It searches for an available local port starting at `5180`.
- It never uses protected infrastructure ports such as `17891`.
- It does not stop or modify any user process.
- It only terminates the child process that was started by this app.
- User-visible reports and logs are written to `NexusAPI数据/`.

The standard package hides internal content-safety scenarios by setting `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=0`.

## GitHub Actions

The workflow is stored in `.github/workflows/release.yml`.

Manual build:

1. Open the private GitHub repository.
2. Go to `Actions`.
3. Select `Build desktop packages`.
4. Click `Run workflow`.
5. Download the macOS and Windows artifacts after both jobs pass.

Release build:

1. Create and push a tag, for example `v0.1.0`.
2. The workflow builds both packages.
3. The generated zip files are uploaded to the GitHub Release.

## Local Build

For local macOS packaging, prepare the bundled Node runtime first:

```bash
mkdir -p resources/bin
cp "$(which node)" resources/bin/node
chmod 755 resources/bin/node
xattr -c resources/bin/node || true
pnpm tauri:build:standard
```

The copied Node binary is ignored by Git.
