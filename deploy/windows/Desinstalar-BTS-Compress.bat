@echo off
rem Remove o BTS Compress do Windows. O banco de dados e os backups sao mantidos.
title Desinstalar BTS Compress
set "PS1=%TEMP%\instalar-bts-compress.ps1"
if exist "%~dp0instalar-windows.ps1" (
  copy /y "%~dp0instalar-windows.ps1" "%PS1%" >nul
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/deploy/windows/instalar-windows.ps1' -OutFile '%PS1%'"
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Desinstalar
