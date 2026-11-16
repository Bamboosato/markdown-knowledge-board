@echo off
powershell.exe -NoProfile -File "%~dp0Install.ps1"
set "mkb_setup_exit=%ERRORLEVEL%"
if not "%mkb_setup_exit%"=="0" echo Setup did not complete. See the message above and README.md.
pause
exit /b %mkb_setup_exit%
