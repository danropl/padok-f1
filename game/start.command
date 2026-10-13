#!/bin/bash
# Monza Grand Prix: uruchomienie na macOS (dwuklik w Finderze) i Linuksie.
# Najpierw pobiera najnowszą wersję gry z GitHuba, potem otwiera grę w przeglądarce.
cd "$(dirname "$0")" || exit 1
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Pobieram najnowszą wersję gry…"
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git pull --ff-only origin "$BRANCH" || echo "Nie udało się pobrać aktualizacji, uruchamiam wersję z dysku."
fi
exec python3 serve.py "$@"
