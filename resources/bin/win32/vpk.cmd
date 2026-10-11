@echo off
setlocal
set "SCRIPT_DIR=%~dp0\.."
set "CLI=%SCRIPT_DIR%\vpk-cli.cjs"

if defined ELECTRON_RUN_AS_NODE (
  node "%CLI%" %*
) else if defined ELECTRON_EXEC_PATH (
  set "ELECTRON_RUN_AS_NODE=1"
  "%ELECTRON_EXEC_PATH%" "%CLI%" %*
) else (
  node "%CLI%" %*
)
