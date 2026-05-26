# Packaging Guide

This project is distributed as private no-install desktop packages.

## Package Types

- `NexusAPI-Evaluator-macOS-x64-Standard.zip`: macOS standard edition. Content-safety scenarios are hidden.
- `NexusAPI-Evaluator-macOS-x64-Internal-Risk.zip`: macOS internal risk-control edition. Content-safety scenarios are enabled.
- `NexusAPI-Evaluator-Windows-x64-Standard.zip`: Windows standard edition. Content-safety scenarios are hidden.
- `NexusAPI-Evaluator-Windows-x64-Internal-Risk.zip`: Windows internal risk-control edition. Content-safety scenarios are enabled.

End users do not need to install Node.js, pnpm, Rust, or Tauri. Those tools are only required for development and CI packaging.

Each zip package contains `版本说明.txt` so operators can confirm the package edition before use.

## Runtime Design

The desktop app starts the bundled Node.js local API service from the same unzipped folder on `127.0.0.1`.

- It searches for an available local port starting at `5180`.
- It never uses protected infrastructure ports such as `17891`.
- It does not stop or modify any user process.
- It only terminates the child process that was started by this app.
- User-visible reports and logs are written to `NexusAPI数据/`.

The standard edition sets `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=0` and hides internal content-safety scenarios.

The internal risk-control edition sets `NEXUSAPI_ENABLE_SAFETY_SCENARIOS=1` and shows content-safety scenarios. Only trained internal operators should use this package.

## GitHub Actions

The workflow is stored in `.github/workflows/release.yml`.

Manual build:

1. Open the private GitHub repository.
2. Go to `Actions`.
3. Select `Build desktop packages`.
4. Click `Run workflow`.
5. Download the four artifacts after all jobs pass.

Release build:

1. Create and push a tag, for example `v0.1.3`.
2. The workflow builds standard and internal risk-control packages for macOS and Windows.
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

For the internal risk-control edition:

```bash
pnpm tauri:build:risk
```
