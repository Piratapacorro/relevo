#!/usr/bin/env bash
# Instalador de Relevo para macOS y Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash
#
# Comprueba lo que hace falta y PREGUNTA antes de instalar nada:
#   1. Node.js 18+ y git
#   2. Antigravity CLI (agy), con el instalador oficial de Google
#   3. Relevo dentro de Claude Code (añade el plugin a ~/.claude/settings.json, con copia de seguridad)
#   4. Inicio de sesión de agy con tu cuenta de Google (solo si hace falta)
# Nunca pide ni guarda contraseñas: el inicio de sesión lo haces tú en el navegador.
set -u

RAW="https://raw.githubusercontent.com/Piratapacorro/relevo/main"
DRY="${RELEVO_DRY_RUN:-}"
FAKE=",${RELEVO_FAKE_MISSING:-},"

if [ -t 1 ]; then C='\033[36m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; N='\033[0m'; else C=''; G=''; Y=''; R=''; N=''; fi
titulo() { printf "\n${C}%s${N}\n" "$1"; }
ok() { printf "  ${G}[OK]${N} %s\n" "$1"; }
aviso() { printf "  ${Y}[!]${N}  %s\n" "$1"; }
fallo() { printf "  ${R}[X]${N}  %s\n" "$1"; }

# Las preguntas se leen del teclado (/dev/tty): con "curl | bash" la entrada normal es el propio script.
pregunta() {
  [ "${RELEVO_YES:-}" = "1" ] && return 0
  local r=""
  if { : < /dev/tty; } 2>/dev/null; then
    printf "  %s [S/n] " "$1" > /dev/tty
    read -r r < /dev/tty || r=""
  else
    return 1
  fi
  case "$r" in "" | s | S | si | Si | sí | y | Y | yes) return 0 ;; *) return 1 ;; esac
}
ejecuta() {
  local desc="$1"
  shift
  if [ -n "$DRY" ]; then printf "  (simulación) %s\n" "$desc"; else "$@"; fi
}
tiene() {
  case "$FAKE" in *",$1,"*) return 1 ;; esac
  command -v "$1" >/dev/null 2>&1
}
busca_agy() {
  case "$FAKE" in *",agy,"*) return 1 ;; esac
  for p in "$HOME/.local/bin/agy" /opt/homebrew/bin/agy /usr/local/bin/agy; do
    if [ -x "$p" ]; then AGY="$p"; return 0; fi
  done
  AGY="$(command -v agy 2>/dev/null || true)"
  [ -n "$AGY" ]
}

main() {
  local OS
  OS="$(uname -s)"
  printf "\n  Relevo · Claude Code + Gemini como un equipo\n  -------------------------------------------\n"

  # 1. Node.js y git -------------------------------------------------------------
  titulo "1/4  Node.js y git"
  local major=0
  if tiene node; then major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"; fi
  if [ "$major" -ge 18 ] 2>/dev/null; then
    ok "Node.js $(node -v)"
  else
    if [ "$OS" = "Darwin" ] && tiene brew && pregunta "Falta Node.js 18+. ¿Lo instalo con Homebrew?"; then
      ejecuta "brew install node" brew install node
    fi
    if [ -z "$DRY" ] && ! tiene node; then
      fallo "Relevo necesita Node.js 18+. Instálalo desde https://nodejs.org (versión LTS) y vuelve a ejecutar este instalador."
      return 1
    fi
    ok "Node.js listo"
  fi
  if tiene git; then
    ok "$(git --version)"
  else
    if [ "$OS" = "Darwin" ] && tiene brew && pregunta "Falta git. ¿Lo instalo con Homebrew?"; then
      ejecuta "brew install git" brew install git
    fi
    if [ -z "$DRY" ] && ! tiene git; then
      if [ "$OS" = "Darwin" ]; then fallo "Relevo necesita git. Instálalo con:  xcode-select --install   y vuelve a ejecutar este instalador."
      else fallo "Relevo necesita git. Instálalo con tu gestor de paquetes (p. ej. sudo apt install git) y vuelve a ejecutar este instalador."; fi
      return 1
    fi
    ok "git listo"
  fi

  # 2. Antigravity CLI (agy) -------------------------------------------------------
  titulo "2/4  Gemini: Antigravity CLI (agy)"
  AGY=""
  if busca_agy; then
    ok "agy en $AGY"
  else
    if ! pregunta "Falta la Antigravity CLI (agy), la herramienta oficial de Google. ¿La instalo ahora?"; then
      fallo "Sin agy, Gemini no puede trabajar. Instálala cuando quieras: curl -fsSL https://antigravity.google/cli/install.sh | bash"
      return 1
    fi
    ejecuta "instalador oficial de agy" bash -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
    AGY="$HOME/.local/bin/agy"
    if [ -z "$DRY" ] && [ ! -x "$AGY" ]; then fallo "La instalación de agy no terminó bien. Revisa el mensaje de arriba."; return 1; fi
    ok "agy en $AGY"
  fi

  # 3. Relevo en Claude Code -------------------------------------------------------
  titulo "3/4  Relevo en Claude Code"
  local tmp="${TMPDIR:-/tmp}/relevo-install-$$.cjs"
  if [ -n "${RELEVO_SOURCE:-}" ]; then
    cp "$RELEVO_SOURCE/install.cjs" "$tmp"  # pruebas locales
  elif ! curl -fsSL "$RAW/install.cjs" -o "$tmp"; then
    fallo "No pude descargar Relevo de GitHub. Revisa tu conexión y vuelve a intentarlo."
    return 1
  fi
  if [ -n "$DRY" ]; then
    printf "  (simulación) activar Relevo en ~/.claude/settings.json\n"
  elif ! RELEVO_QUIET=1 node "$tmp"; then
    rm -f "$tmp"
    fallo "No se pudo activar Relevo en Claude Code (mira el mensaje de arriba)."
    return 1
  fi
  rm -f "$tmp"

  # 4. Sesión de Google en agy -----------------------------------------------------
  titulo "4/4  Tu cuenta de Google en agy"
  local sesion=0
  if [ -z "$DRY" ] && [ -x "$AGY" ]; then
    # agy arranca tus servidores MCP incluso para esto: mejor desde una carpeta neutra.
    if (cd "${TMPDIR:-/tmp}" && "$AGY" models 2>/dev/null) | grep -q '^gemini-'; then sesion=1; fi
  fi
  if [ "$sesion" = 1 ]; then
    ok "Sesión iniciada"
  else
    aviso "Falta iniciar sesión en agy con tu cuenta de Google (AI Pro o Ultra)."
    printf "       Se abrirá agy y tu navegador: entra con tu cuenta de Google.\n"
    printf "       Cuando aparezca el chat de agy, escribe /exit y pulsa Enter.\n"
    if pregunta "¿Abrimos agy para iniciar sesión ahora?"; then
      ejecuta "abrir agy para iniciar sesión" sh -c "cd \"\${TMPDIR:-/tmp}\" && \"$AGY\" < /dev/tty"
    else
      aviso "Cuando quieras, abre una terminal y ejecuta: $AGY"
    fi
  fi

  printf "\n  ${G}¡Listo! Ahora:${N}\n"
  printf "    1. Cierra y vuelve a abrir la app de Claude (o Claude Code en la terminal).\n"
  printf "    2. Abre una sesión en la carpeta de tu proyecto y escribe:  /relevo:iniciar\n"
  printf "    3. Después pide trabajo al equipo, por ejemplo:  /relevo:equipo añade un formulario de contacto\n\n"
}

# Todo dentro de main(): con "curl | bash" nada se ejecuta hasta haber descargado el script entero.
main "$@"
