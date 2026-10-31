@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-docker.ps1" -Action Logs %*
set "docker_exit=%errorlevel%"
pause
exit /b %docker_exit%
