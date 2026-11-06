#!/usr/bin/env bash
# ==============================================================================
# Standalone Apex Studio Desktop Launcher
# Launches the standalone native desktop application.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_PATH="$APEX_ROOT/standalone/dist/Apex Studio-darwin-arm64/Apex Studio.app"

if [ -d "$APP_PATH" ]; then
    echo "Launching Standalone Apex Studio Desktop App..."
    open "$APP_PATH"
else
    echo "Running Standalone Apex Studio from source..."
    cd "$APEX_ROOT/standalone"
    npm start
fi
