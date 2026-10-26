@echo off
rem Dois cliques para instalar (ou atualizar) o BTS Compress no Windows.
rem Funciona sozinho: baixa o instalador mais novo do GitHub. Precisa de internet.
title Instalar BTS Compress
echo.
echo   Baixando o instalador do BTS Compress...
set "PS1=%TEMP%\instalar-bts-compress.ps1"
if exist "%~dp0instalar-windows.ps1" (
  copy /y "%~dp0instalar-windows.ps1" "%PS1%" >nul
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/BrunoTv01/bts-compress/main/deploy/windows/instalar-windows.ps1' -OutFile '%PS1%'"
)
if not exist "%PS1%" (
  echo   Nao consegui baixar o instalador. Verifique a internet.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
