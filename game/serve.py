#!/usr/bin/env python3
"""WORLD GP: lokalny serwer gry.

W odróżnieniu od `python3 -m http.server` wyłącza pamięć podręczną przeglądarki,
więc po aktualizacji (git pull) zawsze ładuje się najnowsza wersja gry.
Użycie: python3 serve.py [port] [--no-browser]
"""
import functools
import http.server
import os
import re
import socket
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


def game_version():
    try:
        with open(os.path.join(ROOT, 'js', 'data.js'), encoding='utf-8') as f:
            m = re.search(r"PG\.VERSION = '([^']+)'", f.read())
        return m.group(1) if m else ''
    except OSError:
        return ''


def port_busy(port):
    # Czy coś już słucha na tym porcie (IPv4 albo IPv6)? Na macOS stary `python3 -m http.server`
    # na [::]:8000 przejmuje localhost:8000 nawet wtedy, gdy nowy serwer zdoła zająć 127.0.0.1:8000.
    for host in ('127.0.0.1', '::1'):
        try:
            with socket.create_connection((host, port), timeout=0.3):
                return True
        except OSError:
            pass
    return False


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
        if port_busy(port):
            print('Port %d jest zajęty (może to stary serwer gry z innego folderu: zamknij tamto okno Terminala).' % port)
            continue
        try:
            httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
            break
        except OSError:
            continue
    if httpd is None:
        print('Nie znalazłem wolnego portu (%d-%d).' % (start, start + 19))
        sys.exit(1)
    version = game_version()
    url = 'http://localhost:%d/' % port
    print('WORLD GP %s działa pod adresem: %s' % (version, url))
    print('Aby zatrzymać grę, zamknij to okno albo naciśnij Ctrl+C.')
    if '--no-browser' not in sys.argv:
        # unikalny adres strony: przeglądarka nie weźmie starej kopii z pamięci podręcznej
        fresh = url + '?v=' + (version or str(int(time.time())))
        threading.Timer(0.8, lambda: webbrowser.open(fresh)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nZatrzymano.')


if __name__ == '__main__':
    main()
