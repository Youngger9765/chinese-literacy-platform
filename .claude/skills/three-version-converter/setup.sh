#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP_PATH="${ROOT_DIR}/學習單字型.zip"
FONT_SOURCE_DIR="${ROOT_DIR}/fonts"

install_python_deps() {
  if python3 -m pip install python-docx lxml; then
    return 0
  fi

  if [ "$(uname -s)" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    echo "pip install failed; falling back to Debian/Ubuntu python packages"
    if command -v sudo >/dev/null 2>&1; then
      sudo apt-get install -y python3-docx python3-lxml
    else
      apt-get install -y python3-docx python3-lxml
    fi
    return 0
  fi

  echo "Python dependency install failed. Create/activate a venv, then run: python3 -m pip install python-docx lxml"
  return 1
}

install_system_deps_linux() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Unsupported Linux package manager: install LibreOffice, poppler-utils, ImageMagick, python3-pip manually"
    return 1
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y libreoffice poppler-utils imagemagick python3-pip unzip fontconfig
  else
    apt-get update
    apt-get install -y libreoffice poppler-utils imagemagick python3-pip unzip fontconfig
  fi
}

install_system_deps_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required on macOS: https://brew.sh/"
    return 1
  fi

  brew list --cask libreoffice >/dev/null 2>&1 || brew install --cask libreoffice
  brew list poppler >/dev/null 2>&1 || brew install poppler
  brew list imagemagick >/dev/null 2>&1 || brew install imagemagick

  if ! command -v soffice >/dev/null 2>&1 && [ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]; then
    echo "LibreOffice is installed. If pipeline.py cannot find soffice, run:"
    echo "  export SOFFICE_BIN=/Applications/LibreOffice.app/Contents/MacOS/soffice"
  fi
}

install_fonts_from_dir() {
  local src_dir="$1"
  local dest_dir="$2"
  local count=0

  mkdir -p "$dest_dir"
  while IFS= read -r -d '' font; do
    cp -f "$font" "$dest_dir/"
    count=$((count + 1))
  done < <(find "$src_dir" -type f \( -iname '*.ttf' -o -iname '*.ttc' \) -print0)

  echo "$count font file(s) installed into $dest_dir"
  return 0
}

install_fonts() {
  local dest_dir="$1"
  local tmp_dir=""

  if [ -f "$ZIP_PATH" ]; then
    tmp_dir="$(mktemp -d)"
    unzip -oq "$ZIP_PATH" -d "$tmp_dir"
    install_fonts_from_dir "$tmp_dir" "$dest_dir"
    rm -rf "$tmp_dir"
  elif [ -d "$FONT_SOURCE_DIR" ]; then
    install_fonts_from_dir "$FONT_SOURCE_DIR" "$dest_dir"
  else
    echo "Font bundle not found at: $ZIP_PATH"
    echo "Drop the .ttf/.ttc files into: $FONT_SOURCE_DIR"
    echo "Then re-run ./setup.sh"
  fi

  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f "$dest_dir"
  elif [ "$(uname -s)" = "Darwin" ]; then
    atsutil databases -removeUser >/dev/null 2>&1 || true
    atsutil server -shutdown >/dev/null 2>&1 || true
    atsutil server -ping >/dev/null 2>&1 || true
  fi
}

case "$(uname -s)" in
  Linux)
    install_system_deps_linux
    install_python_deps
    install_fonts "${HOME}/.local/share/fonts/chinese-literacy-platform"
    ;;
  Darwin)
    install_system_deps_macos
    install_python_deps
    install_fonts "${HOME}/Library/Fonts"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)"
    exit 1
    ;;
esac

echo "Setup complete"
