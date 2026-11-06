#!/usr/bin/env bash
# ==============================================================================
# Apex Studio Launcher
# Starts the backend daemon and launches the editor.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PYTHON_BIN="$APEX_ROOT/../.venv-qwen-systems/bin/python3"

if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

echo "Starting Apex Studio Engine on http://127.0.0.1:8000..."
cd "$APEX_ROOT"
APEX_WORKSPACE="$APEX_ROOT" $PYTHON_BIN -m engine.server &
SERVER_PID=$!

echo "Apex Engine Daemon running with PID $SERVER_PID."

cleanup() {
    echo "Stopping Apex Engine Daemon (PID $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if command -v code &> /dev/null; then
    echo "Launching VS Code with Apex Studio extension..."
    code --extensionDevelopmentPath="$APEX_ROOT/extensions/apex-studio" "$APEX_ROOT"
elif command -v cursor &> /dev/null; then
    echo "Launching Cursor with Apex Studio extension..."
    cursor --extensionDevelopmentPath="$APEX_ROOT/extensions/apex-studio" "$APEX_ROOT"
else
    echo "VS Code CLI not found in PATH. Daemon is running at http://127.0.0.1:8000."
    echo "Press Ctrl+C to terminate."
    wait $SERVER_PID
fi
