<#
PowerShell helper to clone this repo into WSL and run a basic bootstrap.
Run from the repository root in Windows PowerShell as an interactive user.
#>
param(
  [string] $RemoteUrl = 'https://github.com/virtualstrategytech/vf-wiring-deterministic.git',
  [string] $WslDistro = 'Ubuntu'
)

Write-Output "Cloning repo into WSL ($WslDistro) home and installing Node 18 via nvm..."

# Ensure WSL is available
if ($null -eq (Get-Command wsl -ErrorAction SilentlyContinue)) {
  Write-Error "wsl.exe not found. Install WSL2 and try again."; exit 1
}

# Clone into WSL home
$cloneShell = "cd ~ && if [ -d vf-wiring-deterministic ]; then echo 'repo already exists in WSL'; else git clone '$RemoteUrl'; fi"
Start-Process -FilePath "wsl" -ArgumentList @("--distribution", $WslDistro, "--", "bash", "-lc", $cloneShell) -NoNewWindow -Wait

# Install nvm and Node 18 inside WSL and run npm ci
$bootstrap = @'
set -e
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
fi
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# install node 18 and use it
nvm install 18
nvm use 18
cd ~/vf-wiring-deterministic
# install deps
npm ci
# run a quick smoke test (in-band)
npm test -- --runInBand --silent || true
'@

Start-Process -FilePath "wsl" -ArgumentList @("--distribution", $WslDistro, "--", "bash", "-lc", $bootstrap) -NoNewWindow -Wait

Write-Output "WSL bootstrap finished. Enter WSL with: wsl -d $WslDistro -e bash"