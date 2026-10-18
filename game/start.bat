@echo off
rem WORLD GP: uruchomienie na Windows (dwuklik).
rem Gra przeniosla sie do repozytorium danropl/world-gp. Ten skrypt klonuje je obok
rem tego folderu (jesli jeszcze go nie ma) i uruchamia gre stamtad. Zapisy w przegladarce zostaja.
cd /d "%~dp0"
set "TARGET=%~dp0..\..\world-gp"
where git >nul 2>nul
if %errorlevel%==0 (
  if not exist "%TARGET%\start.bat" (
    echo Gra przeniosla sie do nowego repozytorium. Pobieram ja do %TARGET%...
    git clone https://github.com/danropl/world-gp.git "%TARGET%"
  )
)
if exist "%TARGET%\start.bat" (
  echo Uruchamiam gre z %TARGET% - od teraz mozesz uruchamiac ja stamtad.
  call "%TARGET%\start.bat"
  exit /b
)
echo Nie udalo sie pobrac nowego repozytorium, uruchamiam stara wersje z dysku.
where py >nul 2>nul
if %errorlevel%==0 (
  py serve.py
) else (
  python serve.py
)
pause
