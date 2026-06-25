#!/usr/bin/env sh
set -eu

# MTM UI Pilot launcher for Ubuntu/macOS shell.
# Edit the values below before first run.

export MTM_DB_USER="tradeuser"
export MTM_DB_NAME="myts"
export MTM_DB_PASSWORD="CHANGE_ME_DB_PASSWORD"
export MTM_DEFAULT_ADMIN_PASSWORD="admin123"
export MTM_EODHD_API_TOKEN="CHANGE_ME_EODHD_TOKEN"

# Optional overrides:
# export PORT="4173"
# export HOST="127.0.0.1"
# export MTM_MYSQL_CLIENT="mysql"

cd "$(dirname "$0")"

echo "Starting MTM UI Pilot..."
echo "Open http://127.0.0.1:4173/ after the server starts."

npm start

