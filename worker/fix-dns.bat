@echo off
chcp 65001 >nul
title Timery - fix DNS for workers.dev

set "HOSTLINE=188.114.96.7  timery-bale-relay.id6108179.workers.dev"
set "HOSTS=%windir%\System32\drivers\etc\hosts"

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo  Timery - DNS fix
echo  ================================
echo.

findstr /C:"timery-bale-relay.id6108179.workers.dev" "%HOSTS%" >nul 2>&1
if %errorLevel%==0 (
  echo  [i] Entry already exists - nothing to add.
) else (
  echo %HOSTLINE%>>"%HOSTS%"
  if %errorLevel%==0 (
    echo  [+] Added to hosts file.
  ) else (
    echo  [!] Failed to write hosts file.
  )
)

echo  [*] Flushing DNS cache...
ipconfig /flushdns >nul 2>&1

echo.
echo  Testing connection...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'https://timery-bale-relay.id6108179.workers.dev/health' -UseBasicParsing -TimeoutSec 15; Write-Host '  [OK] Server responded:' $r.StatusCode } catch { Write-Host '  [FAIL]' $_.Exception.Message }"

echo.
echo  Done. Close this window and reload the extension.
pause
