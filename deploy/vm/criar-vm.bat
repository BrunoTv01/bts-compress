@echo off
rem Dois cliques aqui para criar a maquina virtual do BTS Compress no VirtualBox.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-vm-virtualbox.ps1" %*
