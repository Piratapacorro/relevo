#!/usr/bin/env bash
# Instalador de Relevo para macOS y Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash
#   (sin curl:  wget -qO- https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash)
#
# Comprueba lo que hace falta y PREGUNTA antes de instalar nada:
#   1. curl, git y Node.js 18+   (con apt, dnf, pacman, zypper, apk o Homebrew)
#   2. Claude Code                (instalador oficial de Anthropic, si no lo tienes)
#   3. Antigravity CLI (agy)      (instalador oficial de Google)
#   4. Relevo dentro de Claude Code (~/.claude/settings.json, con copia de seguridad)
#   5. Inicio de sesión de agy con tu cuenta de Google (solo si hace falta)
# Nunca pide ni guarda contraseñas de tus cuentas: los inicios de sesión los haces tú en el navegador.
# (Si instala paquetes del sistema, "sudo" te pedirá la contraseña de TU ordenador.)
set -u

RAW="https://raw.githubusercontent.com/Piratapacorro/relevo/main"
DRY="${RELEVO_DRY_RUN:-}"
FAKE=",${RELEVO_FAKE_MISSING:-},"
LOCAL_BIN="$HOME/.local/bin"

if [ -t 1 ]; then C='\033[36m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; B='\033[1m'; N='\033[0m'; else C=''; G=''; Y=''; R=''; B=''; N=''; fi
titulo() { printf "\n${C}%s${N}\n" "$1"; }
ok() { printf "  ${G}[OK]${N} %s\n" "$1"; }
aviso() { printf "  ${Y}[!]${N}  %s\n" "$1"; }
fallo() { printf "  ${R}[X]${N}  %s\n" "$1"; }
info() { printf "       %s\n" "$1"; }

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
descarga() { # descarga URL a stdout con curl o wget
  if tiene curl; then curl -fsSL "$1"; elif tiene wget; then wget -qO- "$1"; else return 1; fi
}

# ---------- gestor de paquetes del sistema ----------
PM=""
SUDO=""
detecta_pm() {
  if [ "$(uname -s)" = "Darwin" ]; then
    tiene brew && PM="brew"
    return
  fi
  for p in apt-get dnf yum pacman zypper apk; do
    if tiene "$p"; then PM="$p"; break; fi
  done
  if [ "$(id -u)" != "0" ]; then
    if tiene sudo; then SUDO="sudo"; else SUDO="__no_sudo__"; fi
  fi
}
# Nombre del paquete en cada gestor
pkg() {
  case "$1" in
    node) case "$PM" in brew) echo node ;; *) echo nodejs ;; esac ;;
    *) echo "$1" ;;
  esac
}
instala_paquetes() { # $@ = herramientas (curl git node)
  local pkgs=""
  for t in "$@"; do pkgs="$pkgs $(pkg "$t")"; done
  pkgs="${pkgs# }"
  if [ -z "$PM" ]; then return 1; fi
  if [ "$SUDO" = "__no_sudo__" ]; then
    fallo "Para instalar $pkgs hace falta ser administrador (sudo) y no está disponible."
    return 1
  fi
  local s="$SUDO"
  case "$PM" in
    brew) ejecuta "brew install $pkgs" brew install $pkgs ;;
    apt-get) ejecuta "apt-get install $pkgs" sh -c "$s apt-get update -qq && $s env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $pkgs ca-certificates" ;;
    dnf) ejecuta "dnf install $pkgs" $s dnf install -y $pkgs ;;
    yum) ejecuta "yum install $pkgs" $s yum install -y $pkgs ;;
    pacman) ejecuta "pacman -S $pkgs" $s pacman -S --noconfirm --needed $pkgs ;;
    zypper) ejecuta "zypper install $pkgs" $s zypper --non-interactive install $pkgs ;;
    apk) ejecuta "apk add $pkgs" $s apk add --no-cache $pkgs ;;
  esac
}
version_node() {
  tiene node || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

# ~/.local/bin en el PATH de las próximas terminales (ahí instalan agy y Claude Code).
asegura_path() {
  case ":$PATH:" in *":$LOCAL_BIN:"*) return ;; esac
  export PATH="$LOCAL_BIN:$PATH"
  local rc=""
  case "${SHELL:-}" in */zsh) rc="$HOME/.zshrc" ;; *) rc="$HOME/.bashrc" ;; esac
  if [ -n "$DRY" ]; then printf "  (simulación) añadir ~/.local/bin al PATH en %s\n" "$rc"; return; fi
  if ! grep -qs '.local/bin' "$rc"; then
    printf '\n# Añadido por el instalador de Relevo: programas instalados en ~/.local/bin\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    info "He añadido ~/.local/bin a tu PATH en $rc (se aplica en las terminales nuevas)."
  fi
}

main() {
  local OS
  OS="$(uname -s)"
  detecta_pm
  printf "\n  ${B}Relevo · Claude Code + Gemini como un equipo${N}\n  -------------------------------------------\n"

  # 1. curl, git y Node.js ---------------------------------------------------------
  titulo "1/5  Herramientas básicas: curl, git y Node.js"
  local faltan=""
  tiene curl || tiene wget || faltan="$faltan curl"
  tiene git || faltan="$faltan git"
  local nv
  nv="$(version_node)"
  [ "$nv" -ge 18 ] 2>/dev/null || faltan="$faltan node"
  faltan="${faltan# }"
  if [ -n "$faltan" ]; then
    local legible
    legible="$(echo "$faltan" | sed 's/node/Node.js/; s/ \([^ ]*\)$/ y \1/; s/ \([^ y][^ ]*\) y/, \1 y/')"
    if [ -n "$PM" ] && pregunta "Faltan: $legible. ¿Los instalo ahora con $PM?$( [ -n "$SUDO" ] && [ "$SUDO" != "__no_sudo__" ] && echo ' (te pedirá la contraseña de tu ordenador)')"; then
      info "Instalando $legible con $PM..."
      instala_paquetes $faltan
      # Algunas distribuciones (p. ej. Ubuntu 22.04) traen un Node.js demasiado antiguo.
      nv="$(version_node)"
      if [ -z "$DRY" ] && [ "$PM" = "apt-get" ] && tiene node && ! [ "$nv" -ge 18 ] 2>/dev/null; then
        aviso "Tu sistema instala Node.js $(node -v), demasiado antiguo para Relevo (hace falta 18+)."
        if pregunta "¿Instalo Node.js LTS desde NodeSource (el repositorio oficial de Node.js para Ubuntu/Debian)?"; then
          ejecuta "Node.js LTS desde NodeSource" bash -c "$(declare -f descarga tiene); FAKE=''; descarga https://deb.nodesource.com/setup_lts.x | $SUDO bash - && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs"
        fi
      fi
    fi
    if [ -z "$DRY" ]; then
      if ! tiene curl && ! tiene wget; then fallo "Falta curl. Instálalo (p. ej. sudo apt install curl) y vuelve a ejecutar este instalador."; return 1; fi
      if ! tiene git; then fallo "Falta git. Instálalo (p. ej. sudo apt install git) y vuelve a ejecutar este instalador."; return 1; fi
      nv="$(version_node)"
      if ! [ "$nv" -ge 18 ] 2>/dev/null; then
        if tiene node; then fallo "Tu Node.js es antiguo ($(node -v)). Relevo necesita la versión 18 o superior: https://nodejs.org/es/download"
        else fallo "Falta Node.js 18+. Instálalo desde https://nodejs.org/es/download y vuelve a ejecutar este instalador."; fi
        return 1
      fi
    fi
  fi
  if [ -n "$DRY" ]; then ok "curl, git y Node.js listos (simulación)"; else ok "curl, git y Node.js $(node -v)"; fi

  # 2. Claude Code ------------------------------------------------------------------
  titulo "2/5  Claude Code"
  local claude_nuevo=0
  if [ "$OS" = "Darwin" ] && [ -d "/Applications/Claude.app" ] && ! case "$FAKE" in *",claude,"*) true ;; *) false ;; esac; then
    ok "App de Claude para Mac encontrada"
  elif tiene claude || { [ -x "$LOCAL_BIN/claude" ] && ! case "$FAKE" in *",claude,"*) true ;; *) false ;; esac; }; then
    ok "Claude Code encontrado"
  else
    aviso "No encuentro Claude Code en este ordenador."
    if pregunta "¿Instalo Claude Code con el instalador oficial de Anthropic?"; then
      ejecuta "instalador oficial de Claude Code" bash -c "$(declare -f descarga tiene); FAKE=''; descarga https://claude.ai/install.sh | bash"
      claude_nuevo=1
      asegura_path
      if [ -z "$DRY" ] && ! tiene claude && [ ! -x "$LOCAL_BIN/claude" ]; then fallo "La instalación de Claude Code no terminó bien. Revisa el mensaje de arriba."; return 1; fi
      ok "Claude Code instalado"
    else
      aviso "Sigo sin Claude Code: instálalo cuando quieras con  curl -fsSL https://claude.ai/install.sh | bash"
    fi
  fi

  # 3. Antigravity CLI (agy) -----------------------------------------------------------
  titulo "3/5  Gemini: Antigravity CLI (agy)"
  AGY=""
  local p
  if ! case "$FAKE" in *",agy,"*) true ;; *) false ;; esac; then
    for p in "$LOCAL_BIN/agy" /opt/homebrew/bin/agy /usr/local/bin/agy; do
      if [ -x "$p" ]; then AGY="$p"; break; fi
    done
    [ -z "$AGY" ] && AGY="$(command -v agy 2>/dev/null || true)"
  fi
  if [ -n "$AGY" ]; then
    ok "agy en $AGY"
  else
    if ! pregunta "Falta la Antigravity CLI (agy), la herramienta oficial de Google. ¿La instalo ahora?"; then
      fallo "Sin agy, Gemini no puede trabajar. Instálala cuando quieras: curl -fsSL https://antigravity.google/cli/install.sh | bash"
      return 1
    fi
    ejecuta "instalador oficial de agy" bash -c "$(declare -f descarga tiene); FAKE=''; descarga https://antigravity.google/cli/install.sh | bash"
    AGY="$LOCAL_BIN/agy"
    asegura_path
    if [ -z "$DRY" ] && [ ! -x "$AGY" ]; then fallo "La instalación de agy no terminó bien. Revisa el mensaje de arriba."; return 1; fi
    ok "agy en $AGY"
  fi

  # 4. Relevo en Claude Code ------------------------------------------------------------
  titulo "4/5  Relevo en Claude Code"
  local tmp="${TMPDIR:-/tmp}/relevo-install-$$.cjs"
  if [ -n "${RELEVO_SOURCE:-}" ]; then
    cp "$RELEVO_SOURCE/install.cjs" "$tmp"  # pruebas locales
  elif ! descarga "$RAW/install.cjs" > "$tmp"; then
    rm -f "$tmp"
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

  # 5. Sesión de Google en agy ------------------------------------------------------------
  titulo "5/5  Tu cuenta de Google en agy"
  local sesion=0
  if [ -z "$DRY" ] && [ -x "$AGY" ]; then
    # agy arranca tus servidores MCP incluso para esto: mejor desde una carpeta neutra.
    if (cd "${TMPDIR:-/tmp}" && "$AGY" models 2>/dev/null) | grep -q '^gemini-'; then sesion=1; fi
  fi
  if [ "$sesion" = 1 ]; then
    ok "Sesión iniciada"
  else
    aviso "Falta iniciar sesión en agy con tu cuenta de Google (AI Pro o Ultra)."
    info "Se abrirá agy y tu navegador: entra con tu cuenta de Google."
    info "Cuando aparezca el chat de agy, escribe /exit y pulsa Enter."
    if [ -z "${RELEVO_NO_LOGIN:-}" ] && pregunta "¿Abrimos agy para iniciar sesión ahora?"; then
      ejecuta "abrir agy para iniciar sesión" sh -c "cd \"\${TMPDIR:-/tmp}\" && \"$AGY\" < /dev/tty > /dev/tty 2>&1"
    else
      aviso "Cuando quieras, abre una terminal y escribe: agy"
    fi
  fi

  printf "\n  ${G}¡Listo! Ahora:${N}\n"
  local n=1
  if [ "$claude_nuevo" = 1 ]; then
    printf "    %d. Abre una terminal NUEVA, escribe  claude  y entra con tu cuenta de Claude (Pro o Max).\n" "$n"; n=$((n + 1))
  else
    printf "    %d. Cierra y vuelve a abrir Claude (la app o Claude Code en la terminal).\n" "$n"; n=$((n + 1))
  fi
  printf "    %d. Dentro de Claude Code, en la carpeta de tu proyecto, escribe:  /relevo:iniciar\n" "$n"; n=$((n + 1))
  printf "    %d. Después pide trabajo al equipo, por ejemplo:  /relevo:equipo añade un formulario de contacto\n\n" "$n"
}

# Todo dentro de main(): con "curl | bash" nada se ejecuta hasta haber descargado el script entero.
main "$@"
