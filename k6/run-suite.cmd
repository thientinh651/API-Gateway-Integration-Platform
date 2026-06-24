@echo off
REM Chay tu Windows CMD — load generator, KHONG chay tren Droplet.
REM Usage:
REM   set CLIENT_ID=avaso_pk_...
REM   set CLIENT_SECRET=avaso_sk_...
REM   run-suite.cmd health
REM   run-suite.cmd jwt
REM   run-suite.cmd all

setlocal enabledelayedexpansion

set "BASE_URL=%BASE_URL%"
if "%BASE_URL%"=="" set "BASE_URL=https://thientinh.io.vn"

set "DURATION=%DURATION%"
if "%DURATION%"=="" set "DURATION=30s"

set "DATA_PLANE_PATH=%DATA_PLANE_PATH%"
if "%DATA_PLANE_PATH%"=="" set "DATA_PLANE_PATH=/v1/api/get"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=health"

set "OUT_DIR=results"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

set K6_WEB_DASHBOARD=true
set K6_WEB_DASHBOARD_EXPORT=

for %%V in (50 100 250 500) do (
  echo.
  echo ===== VUS=%%V scenario=%MODE% =====
  set "TS=%date:~-4%%date:~4,2%%date:~7,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
  set "TS=!TS: =0!"
  set "REPORT=%OUT_DIR%\!MODE!-%%Vvu-!TS!.html"

  if /i "%MODE%"=="health" (
    k6 run -e BASE_URL=%BASE_URL% -e SCENARIO=health -e VUS=%%V -e DURATION=%DURATION% benchmark.js
  ) else if /i "%MODE%"=="jwt" (
    if "%CLIENT_ID%"=="" (
      echo ERROR: set CLIENT_ID va CLIENT_SECRET truoc khi chay jwt
      exit /b 1
    )
    if "%CLIENT_SECRET%"=="" (
      echo ERROR: set CLIENT_ID va CLIENT_SECRET truoc khi chay jwt
      exit /b 1
    )
    k6 run -e BASE_URL=%BASE_URL% -e SCENARIO=jwt -e VUS=%%V -e DURATION=%DURATION% ^
      -e CLIENT_ID=%CLIENT_ID% -e CLIENT_SECRET=%CLIENT_SECRET% ^
      -e DATA_PLANE_PATH=%DATA_PLANE_PATH% benchmark.js
  ) else if /i "%MODE%"=="all" (
    call "%~f0" health
    call "%~f0" jwt
    goto :done
  ) else (
    echo Unknown mode: %MODE%. Use health, jwt, or all.
    exit /b 1
  )

  echo Ghi lai: VUS=%%V ^| xem summary phia tren ^| SSH htop tren Droplet
  echo.
)

:done
echo Done. Dien so vao results\BENCHMARK_TABLE.md
endlocal
