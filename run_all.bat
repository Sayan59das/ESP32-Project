@echo off
setlocal EnableExtensions
rem ============================================================================
rem  EcoSort Edge: run everything with one double click.
rem
rem    run_all.bat         start the camera bridge, the website bridge and the console
rem    run_all.bat prod    the same, but the console runs as a production build
rem    run_all.bat check   only check that everything is ready, start nothing
rem    stop_all.bat        stop everything
rem
rem  Three windows open:
rem    1  camera bridge   reads the camera board over USB and runs the trained model
rem    2  website bridge  stores every verdict and serves the data
rem    3  console         the website, opened at http://localhost:3000
rem
rem  Before you start: plug the camera board in with a data USB cable, close the
rem  Arduino Serial Monitor and live.py, and keep the camera view EMPTY. The
rem  camera bridge learns the empty background in its first seconds.
rem ============================================================================

cd /d "%~dp0"

rem Optional settings. Remove the word rem in front of a line to use it.
rem set CAMERA_PORT=COM6
rem set CAMERA_BAUD=921600
rem set ECOSORT_NO_BROWSER=1

set "PY=.venv\Scripts\python.exe"
set "MODE=%~1"

echo.
echo  EcoSort Edge
echo  ------------

rem ---- 1. Python environment -------------------------------------------------
if exist "%PY%" goto have_venv
echo  Creating the Python environment, once. This takes a minute.
where py >nul 2>nul
if %errorlevel%==0 (py -3 -m venv .venv) else (python -m venv .venv)
if not exist "%PY%" goto no_python
:have_venv
"%PY%" -c "import numpy, serial, PIL, fastapi, uvicorn" >nul 2>nul
if %errorlevel%==0 goto python_ok
echo  Installing Python packages, once.
"%PY%" -m pip install -r backend\requirements.txt -r Model\requirements.txt
if errorlevel 1 goto pip_failed
:python_ok

rem ---- 2. Website packages ----------------------------------------------------
where npm >nul 2>nul
if errorlevel 1 goto no_node
if exist "frontend\node_modules\next" goto node_ok
echo  Installing the website packages, once. This takes a few minutes.
pushd frontend
call npm install --no-audit --no-fund
set "NPM_RESULT=%errorlevel%"
popd
if not "%NPM_RESULT%"=="0" goto npm_failed
:node_ok

rem ---- 3. Settings file and the model ------------------------------------------
if not exist ".env" copy /y ".env.example" ".env" >nul
if not exist "Model\waste_cnn.pt" goto no_model
"%PY%" Model\camera_bridge.py --check
if errorlevel 1 goto model_failed

rem ---- 4. Ports must be free ----------------------------------------------------
for %%P in (3000 7777 8000) do (
  netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul
  if not errorlevel 1 set "BUSY=%%P"
)
if defined BUSY goto port_busy

if /i "%MODE%"=="check" goto checked

rem ---- 5. Start everything -----------------------------------------------------------
rem The website bridge reads the camera bridge as if it were the board, over TCP.
rem These variables override whatever .env says.
set "SOURCE=serial"
set "SERIAL_PORT=socket://127.0.0.1:7777"
set "NEXT_TELEMETRY_DISABLED=1"

echo.
echo  Starting the camera bridge. Keep the camera view empty for a few seconds.
start "EcoSort 1 camera bridge" cmd /k ".venv\Scripts\python.exe Model\camera_bridge.py"
ping -n 3 127.0.0.1 >nul

echo  Starting the website bridge.
start "EcoSort 2 website bridge" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --app-dir backend --host 127.0.0.1 --port 8000"

echo  Starting the console.
if /i "%MODE%"=="prod" goto console_prod
start "EcoSort 3 console" /D frontend cmd /k "npm run dev"
goto wait_console
:console_prod
echo  Building the console first, this takes about a minute.
start "EcoSort 3 console" /D frontend cmd /k "npm run build && npm start"

:wait_console
echo  Waiting for the console to come up...
set /a TRIES=0
:wait_loop
curl -s -o nul http://localhost:3000 >nul 2>nul
if not errorlevel 1 goto console_up
set /a TRIES+=1
if %TRIES% geq 90 goto console_slow
ping -n 3 127.0.0.1 >nul
goto wait_loop

:console_up
if defined ECOSORT_NO_BROWSER goto running
start "" http://localhost:3000
goto running

:console_slow
echo  The console is taking long. Look at window 3 for errors, then open
echo  http://localhost:3000 yourself.
goto running

:running
echo.
echo  Running. Open http://localhost:3000
echo.
echo    Put an item in front of the camera: the matching count goes up by one.
echo    Take it away before the next one, so the view is empty in between.
echo    If the counts do not move, read window 1: it says what the camera sees.
echo.
echo  To stop everything, run stop_all.bat or close the three windows.
echo.
exit /b 0

:checked
echo.
echo  Everything is ready. Run run_all.bat to start.
echo.
exit /b 0

rem ---- problems -------------------------------------------------------------------------
:no_python
echo.
echo  Could not create the Python environment. Install Python 3.11 or newer from
echo  python.org, tick Add Python to PATH, then run this file again.
goto failed
:pip_failed
echo.
echo  Installing the Python packages failed. Check the internet connection, then
echo  run this file again.
goto failed
:no_node
echo.
echo  Node.js was not found. Install Node 20 or newer from nodejs.org, then run
echo  this file again.
goto failed
:npm_failed
echo.
echo  Installing the website packages failed. Check the internet connection, then
echo  run this file again.
goto failed
:no_model
echo.
echo  Model\waste_cnn.pt is missing. It is made by Model\train.py.
goto failed
:model_failed
echo.
echo  The model did not load. The message above says why.
goto failed
:port_busy
echo.
echo  Port %BUSY% is already in use, probably by an earlier run. Run stop_all.bat,
echo  then run this file again.
goto failed
:failed
echo.
pause
exit /b 1
