#!/usr/bin/env bash
# Quaestio ??? one-click launcher (macOS/Linux)
#
# The app is completely client-side: everything (courses, questions, images,
# past tests) lives in your browser's storage. This launcher just installs
# the frontend dependencies (first run), builds the static bundle (first
# run), and serves it on http://localhost:8420.
set -e
cd "$(dirname "$0")"

echo "== Quaestio =="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but wasn't found on your PATH. Install it from https://nodejs.org and try again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm wasn't found on your PATH (it ships with Node.js). Install Node.js from https://nodejs.org and try again."
  exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "Installing frontend dependencies (first run only, this can take a minute)..."
  (cd frontend && npm install --silent)
fi

echo "Building the frontend (picks up any code changes)..."
(cd frontend && npm run build --silent)

echo
echo "Starting the app at http://localhost:8420 ..."
echo "(Leave this window open while you use the app. Close it, or press Ctrl+C, to stop the app.)"
echo

( sleep 1.5
  if command -v open >/dev/null 2>&1; then
    open http://localhost:8420/quaestio/
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:8420/quaestio/
  fi
) &

cd frontend
exec npx vite preview --port 8420 --strictPort
