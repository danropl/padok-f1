#!/usr/bin/env python3
"""Monza Grand Prix: lokalny serwer gry.

W odróżnieniu od `python3 -m http.server` wyłącza pamięć podręczną przeglądarki,
więc po aktualizacji (git pull) zawsze ładuje się najnowsza wersja gry.
Użycie: python3 serve.py [port] [--no-browser]
"""
import functools
import http.server
import os
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{'.js': 'text/javascript'})

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    ports = [int(a) for a in sys.argv[1:] if a.isdigit()]
    start = ports[0] if ports else 8000
    handler = functools.partial(Handler, directory=ROOT)
    httpd = None
    for port in range(start, start + 20):
        try:
            httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
            break
        except OSError:
            continue
    if httpd is None:
        print('Nie znalazłem wolnego portu (%d-%d).' % (start, start + 19))
        sys.exit(1)
    url = 'http://localhost:%d/' % port
    print('Monza Grand Prix działa pod adresem: ' + url)
    print('Aby zatrzymać grę, zamknij to okno albo naciśnij Ctrl+C.')
    if '--no-browser' not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nZatrzymano.')


if __name__ == '__main__':
    main()
