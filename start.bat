@echo off
cd /d "%~dp0"
npm --prefix server run dev
pause