#!/usr/bin/env bash
set -u

echo "Second Brain runtime dependency check"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the guided macOS runtime install."
  echo "Install Homebrew from https://brew.sh, then run this script again."
  read -r -p "Press Return to close."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Installing Python..."
  brew install python
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  brew install uv
fi

echo "Installing Graphify with file support..."
uv tool install --upgrade "graphifyy[all]"
uv tool ensurepath

echo "Installing fpdf2 for PDF artifacts..."
python3 -m pip install --user --upgrade fpdf2 --break-system-packages

echo "Second Brain runtime dependency check complete."
read -r -p "Press Return to close."
