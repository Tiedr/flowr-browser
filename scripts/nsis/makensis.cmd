@echo off
rem NSIS entry point used through ELECTRON_BUILDER_NSIS_DIR.
rem
rem electron-builder pipes the generated installer script into makensis on
rem stdin and passes the output path with -XOutFile. NSIS drops those /X
rem script commands when the script arrives over stdin, which leaves the
rem installer with no output file and the slow default compressor. The real
rem work happens in wrapper.js, which converts the piped script into a file
rem with the output path and compressor injected as ordinary commands.
rem
rem See scripts/nsis/wrapper.js for the full explanation.

setlocal
set "SCRIPT_DIR=%~dp0"

set "NODE_EXE="
for %%i in (node.exe) do set "NODE_EXE=%%~$PATH:i"
if not defined NODE_EXE (
    echo nsis-wrapper: node.exe not found on PATH 1>&2
    exit /b 1
)

"%NODE_EXE%" "%SCRIPT_DIR%wrapper.js" %*
exit /b %ERRORLEVEL%
