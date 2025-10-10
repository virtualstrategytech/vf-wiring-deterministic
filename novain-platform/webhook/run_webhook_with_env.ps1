Set-Location $PSScriptRoot
$env:WEBHOOK_API_KEY = "<REDACTED>"
$env:PORT = "3000"
$env:BUSINESS_URL = "http://127.0.0.1:4000"
node .\server.js

