@echo off
call "%~dp0start.cmd" -OpenBrowser %*
exit /b %errorlevel%
