@echo off
setlocal
cd /d "%~dp0"
set "TAMI_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "TAMI_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Primero instala Node.js 24 y pnpm 11 y ejecuta: pnpm install --frozen-lockfile
  pause
  exit /b 1
)
"%TAMI_NODE%" node_modules\typescript\bin\tsc --noEmit
if errorlevel 1 goto :failure
"%TAMI_NODE%" node_modules\vite\bin\vite.js build --configLoader native
if errorlevel 1 goto :failure
echo Abri http://127.0.0.1:4173/booth en Chrome o Edge. Manten esta ventana abierta.
"%TAMI_NODE%" node_modules\vite\bin\vite.js preview --configLoader native --host 127.0.0.1 --port 4173 --strictPort
exit /b %errorlevel%
:failure
echo No se pudo compilar. Revisa los mensajes anteriores.
pause
exit /b 1
