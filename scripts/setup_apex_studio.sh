#!/usr/bin/env bash
# ==============================================================================
# Apex Studio Bootstrap & Setup Script
# Configures the dual-model engine (ApexPhi-Think & ApexPhi-Coder) and VS Code extension.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "========================================================"
echo "          Apex Studio: Cognitive AI IDE Setup           "
echo "========================================================"
echo "Apex Studio Root: $APEX_ROOT"

# 1. Check Python & Virtual Environment
PYTHON_BIN="$APEX_ROOT/../.venv-qwen-systems/bin/python3"
if [ ! -f "$PYTHON_BIN" ]; then
    PYTHON_BIN="python3"
fi

echo "Checking Python environment with: $PYTHON_BIN"
$PYTHON_BIN -c "import ddgs, bs4, fastapi, uvicorn, requests, pydantic; print('  ✓ Python core dependencies verified.')" || {
    echo "Installing missing Python dependencies..."
    $PYTHON_BIN -m pip install ddgs beautifulsoup4 fastapi uvicorn requests pydantic
}

# 2. Check Ollama Connection & Models
echo "Checking local Ollama connection on http://localhost:11434..."
if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "  ✓ Ollama server online."
    if curl -s http://localhost:11434/api/tags | grep -q "apex-phi-think-14b"; then
        echo "  ✓ apex-phi-think-14b found."
    else
        echo "  ⚠ apex-phi-think-14b not detected. Pull or create from Modelfile."
    fi
    if curl -s http://localhost:11434/api/tags | grep -q "apex-phi-coder-14b"; then
        echo "  ✓ apex-phi-coder-14b found."
    else
        echo "  ⚠ apex-phi-coder-14b not detected. Pull or create from Modelfile."
    fi
else
    echo "  ✗ Ollama is not running! Please start Ollama before running Apex Studio."
fi

# 3. Compile VS Code Extension
echo "Compiling Apex Studio VS Code Extension..."
cd "$APEX_ROOT/extensions/apex-studio"
npm run compile
echo "  ✓ Extension compiled successfully to out/extension.js"

# 4. Check for VS Code or Cursor CLI
if command -v code &> /dev/null; then
    echo "VS Code CLI ('code') detected."
    read -p "Install apex-studio.vsix into local VS Code? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        code --install-extension "$APEX_ROOT/apex-studio.vsix" --force
        echo "  ✓ Extension installed into VS Code!"
    fi
elif command -v cursor &> /dev/null; then
    echo "Cursor CLI ('cursor') detected."
    read -p "Install apex-studio.vsix into local Cursor? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cursor --install-extension "$APEX_ROOT/apex-studio.vsix" --force
        echo "  ✓ Extension installed into Cursor!"
    fi
fi

echo ""
echo "========================================================"
echo "Setup complete! To run the Apex Studio Engine daemon:"
echo "  cd $APEX_ROOT && $PYTHON_BIN -m engine.server"
echo "Or use the CLI directly:"
echo "  cd $APEX_ROOT && $PYTHON_BIN -m engine.cli --help"
echo "========================================================"
