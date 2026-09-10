@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" --env-file=.env scripts\start-local-dev.mjs > "%TEMP%\kol-crm-dev.log" 2>&1
