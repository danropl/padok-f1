#!/bin/bash
# WORLD GP: uruchomienie na macOS (dwuklik w Finderze) i Linuksie.
# Gra przeniosła się do repozytorium danropl/world-gp. Ten skrypt klonuje je obok
# tego folderu (jeśli jeszcze go nie ma) i uruchamia grę stamtąd. Zapisy w przeglądarce zostają.
cd "$(dirname "$0")" || exit 1
NEW_REPO="https://github.com/danropl/world-gp.git"
if command -v git >/dev/null 2>&1 && ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
  TARGET="$(dirname "$ROOT")/world-gp"
  if [ ! -f "$TARGET/start.command" ]; then
    echo "Gra przeniosła się do nowego repozytorium. Pobieram ją do $TARGET…"
    git clone "$NEW_REPO" "$TARGET" || TARGET=""
  fi
  if [ -n "$TARGET" ] && [ -f "$TARGET/start.command" ]; then
    echo "Uruchamiam grę z $TARGET (od teraz możesz uruchamiać ją stamtąd)."
    exec bash "$TARGET/start.command" "$@"
  fi
  echo "Nie udało się pobrać nowego repozytorium, uruchamiam starą wersję z dysku."
fi
exec python3 serve.py "$@"
