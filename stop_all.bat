@echo off
setlocal EnableExtensions
rem Stops everything run_all.bat started: the camera bridge, the website bridge and the console.

echo.
echo  Stopping EcoSort Edge...

rem Whatever is listening on the three ports, with the programs it started.
for %%P in (3000 7777 8000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    taskkill /PID %%A /T /F >nul 2>nul
  )
)

rem The three windows themselves.
taskkill /FI "WINDOWTITLE eq EcoSort*" /T /F >nul 2>nul

echo  Stopped.
echo.
exit /b 0
