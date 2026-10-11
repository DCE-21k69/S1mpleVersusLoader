#!/usr/bin/env bash
# ==============================================================================
# S1mple Versus Loader — Launcher para Linux / Steam Deck
# Hecho: DCE Studios For EITO Comunity
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "  S1mple Versus Loader"
echo "  Hecho: DCE Studios For EITO Comunity"
echo "=========================================================="

# Agregar runtime de node del usuario si existe localmente
if [ -d "$HOME/.local/node/bin" ]; then
  export PATH="$HOME/.local/node/bin:$PATH"
fi
if [ -d "$HOME/.gemini/antigravity/bin" ]; then
  export PATH="$HOME/.gemini/antigravity/bin:$PATH"
fi

# Verificar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Error: Node.js no está instalado en el sistema."
  echo "    Instálalo con el gestor de paquetes de tu distro (apt, pacman, xbps, dnf...)"
  exit 1
fi

# Verificar si las dependencias están instaladas
if [ ! -d "node_modules" ]; then
  echo "[*] Instalando dependencias necesarias (primera ejecución)..."
  npm install --omit=dev
fi

# Compilar si dist/ no existe
if [ ! -d "dist" ]; then
  echo "[*] Compilando aplicación..."
  npm run build
fi

# Lanzar la aplicación
echo "[*] Iniciando S1mple Versus Loader..."
npx electron . "$@"
