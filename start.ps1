# ---------------------------------------------------------------
#  Task Management Application - one-click launcher (PowerShell)
# ---------------------------------------------------------------
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "  Node.js was not found on your PATH." -ForegroundColor Red
  Write-Host "  Install it from https://nodejs.org/ (LTS) and run this again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "  Starting the Task Manager backend..." -ForegroundColor Cyan
Write-Host "  Opening http://localhost:3000 in your browser"
Write-Host ""

Start-Job -ScriptBlock {
  Start-Sleep -Seconds 2
  Start-Process "http://localhost:3000"
} | Out-Null

node server.js
