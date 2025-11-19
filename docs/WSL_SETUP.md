WSL setup and clone instructions

This document shows how to clone this repository into WSL and run the test-suite there. The goal: run the code in a Linux environment (Node 18) to reduce Windows-specific file/socket differences and stabilize CI/test behavior.

Prerequisites (on Windows):

- WSL2 installed and one Linux distro available (Ubuntu recommended).
- `wsl.exe` on PATH (standard with WSL installation).
- Git installed both on Windows and in the WSL distro (you can use either; we clone from Windows into WSL in the helper below).

Recommended Node runtime: Node 18.x (project includes `.nvmrc` and `package.json.engines`).

Quick commands (PowerShell):

```powershell
# Clone the repo into your WSL home under the same repo name
# Replace <your-git-url> with your repository remote (origin HTTPS or SSH)
wsl -- bash -lc "cd ~ && git clone https://github.com/virtualstrategytech/vf-wiring-deterministic.git"

# Enter WSL and install nvm + node (example for Ubuntu):
wsl -- bash -lc "bash -lc 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash' && \
  export NVM_DIR=\"$HOME/.nvm\" && \n  [ -s \"$NVM_DIR/nvm.sh\" ] && . \"$NVM_DIR/nvm.sh\" && \n  nvm install 18 && nvm use 18 && node -v && npm -v"

# From Windows PowerShell you can run tests inside WSL (example)
wsl -- bash -lc "cd ~/vf-wiring-deterministic && npm ci && npm test -- --runInBand"
```

Notes and troubleshooting

- If `npm ci` fails because of native build steps, install required distro packages (build-essential, python, etc.).
- Use `nvm install 18` to match `.nvmrc`.
- Run tests in-band (`--runInBand`) initially to reduce flakiness.
- If child-process server runs behave differently, toggle `USE_CHILD_PROCESS_SERVER=1` and set `TEST_PROMPT_STUB=1` in the env to reproduce CI child-run behavior.

Further automation

- See `scripts/clone_to_wsl.ps1` (in the repo root) which automates the clone + basic Node install checks from Windows PowerShell.

If you'd like, I can add a minimal `Dockerfile` or a reproducible GitHub Actions job that emulates the WSL (Linux) environment for CI runs.
