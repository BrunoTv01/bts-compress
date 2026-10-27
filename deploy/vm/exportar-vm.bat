@echo off
rem Dois cliques aqui (com a VM desligada) para criar a copia .ova da VM do BTS Compress.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0exportar-vm.ps1" %*
