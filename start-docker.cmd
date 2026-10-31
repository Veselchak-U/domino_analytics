@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage-docker.ps1" -Action Start %*
set "docker_exit=%errorlevel%"
if not "%docker_exit%"=="0" pause
exit /b %docker_exit%
