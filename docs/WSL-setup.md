WSL Ubuntu clone and test-run instructions

## Purpose

Quick, reproducible instructions to clone this repository into a WSL Ubuntu environment and run the Jest tests (matching CI) to reproduce Linux-specific handle/socket behavior seen on GitHub Actions.

## Why use WSL

- GitHub Actions runners use Linux; WSL (Ubuntu) gives a near-equivalent environment on Windows for reproducing timing/handle differences.
- Useful for debugging lingering native handles, sockets, and CI-only failures.

## Steps (PowerShell -> WSL Ubuntu)

1. Install WSL and Ubuntu (if not already):

```powershell
# From Windows PowerShell (run as admin):
wsl --install -d ubuntu
# After installation, reboot if prompted, then open Ubuntu from the Start menu to finish setup.
```

2. Open WSL (Ubuntu) and set up a working directory. From PowerShell you can open a WSL shell in the repo path:

```powershell
# From Windows PowerShell (in repo root):
# This opens a WSL shell with the current Windows path mounted and working directory set
wsl -d ubuntu -- cd "$(wslpath 'C:\Users\peais\Documents\Virtual Strategy Tech\VST NovAIn Voiceflow\vf-wiring-deterministic')" && bash
```

Or launch Ubuntu and clone inside WSL directly (recommended for a clean environment):

```bash
# In WSL Ubuntu shell
sudo apt update && sudo apt install -y git curl build-essential
# install Node 18 (use nodesource or nvm)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
# verify node
node -v
npm -v
# clone repository (replace with your fork/remote if needed)
git clone https://github.com/virtualstrategytech/vf-wiring-deterministic.git
cd vf-wiring-deterministic
git fetch --all
git checkout wiring-agent-fixes/catch-cleanup
```

3. Install dependencies and run tests (CI-like):

```bash
# in WSL Ubuntu shell, repo root
npm ci
# Run the full Jest suite similar to CI (detectOpenHandles enabled)
# Use runInBand to make local runs easier to debug
npx jest --runInBand --detectOpenHandles
```

4. If you need the extra diagnostic run used in CI (writes async handle maps / more verbose):

```bash
# export DEBUG env vars to enable the verbose diagnostics used by the tests
export DEBUG_TESTS=1
export DEBUG_TESTS_LEVEL=3
# run tests
npx jest --runInBand --detectOpenHandles
# inspect artifacts/async_handles_*.json after the run
ls artifacts | grep async_handles || true
```

## Notes and tips

- If tests behave differently on WSL vs Windows, use `DEBUG_TESTS=1` as above to generate handle/stack dumps.
- Use `git clean -fdx` inside WSL with care; it will remove node_modules and built artifacts.
- Keep one clone for Windows dev/test and another inside WSL for CI reproduction.

If you'd like, I can add a short PowerShell wrapper script to open WSL in the right path and run the diagnostic test command automatically.
