# filepath: run_mock.ps1
# ensure the script runs from its directory regardless of caller CWD
Set-Location $PSScriptRoot
node .\mock_business_server.js
