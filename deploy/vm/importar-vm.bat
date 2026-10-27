@echo off
rem Dois cliques aqui para instalar a copia .ova do BTS Compress no VirtualBox deste computador.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0importar-vm.ps1" %*
