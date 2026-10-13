@echo off
rem WORLD GP: uruchomienie na Windows (dwuklik).
rem Najpierw pobiera najnowsza wersje gry z GitHuba, potem otwiera gre w przegladarce.
cd /d "%~dp0"
where git >nul 2>nul
if %errorlevel%==0 (
  echo Pobieram najnowsza wersje gry...
  for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do git pull --ff-only origin %%b
)
where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py
) else (
  python serve.py
)
pause
