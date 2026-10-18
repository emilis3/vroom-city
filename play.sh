#!/usr/bin/env bash
# Opens Vroom City in its own Chrome window (works fully offline).
DIR="$(cd "$(dirname "$0")" && pwd)"
exec google-chrome-stable --new-window --app="file://$DIR/vroom-city.html" >/dev/null 2>&1
