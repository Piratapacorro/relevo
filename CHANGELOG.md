# Cambios

## 0.1.4 — 2026-09-25

- **Instalación en un solo paso:** `install.ps1` (Windows) e `install.sh` (Mac/Linux).
  - Comprueban Node.js y git; si faltan, los instalan (winget en Windows, Homebrew en Mac).
  - Instalan la Antigravity CLI oficial y activan Relevo en Claude Code.
  - Guían el inicio de sesión con Google.
  - Preguntan antes de instalar nada.
- **README:** instalación en 3 pasos (instalador → iniciar sesión → reiniciar Claude y `/relevo:iniciar`).
- **Diario automático en Obsidian:** cada trabajo integrado o descartado queda anotado en «Relevo - <proyecto> - <fecha>», sin depender de Claude ni gastar su cuota.
- **Corrección:** `settings.json` guardado con BOM (Bloc de notas / PowerShell 5.1) ya no rompe la instalación ni hace que se ignoren las opciones.
- Probado con Claude Code 2.1.281: `/relevo:iniciar` y `/relevo:equipo` completos, y el instalador en equipos limpios.

## 0.1.3 — 2026-09-23

- `status` dice explícitamente si el consentimiento ya está aceptado, y `/relevo:iniciar` y `/relevo:equipo` solo lo piden si falta (antes Claude podía volver a preguntarlo).
- Las consultas rápidas a agy (`--version`, `models`) se lanzan desde una carpeta neutra: agy arranca los servidores MCP del usuario incluso para eso, y el de WordPress dejaba `wordpress-mcp.log` en el proyecto.

## 0.1.2 — 2026-09-23

- **Corrección:** se restaura `disable-model-invocation` en los comandos. Sin esa marca, `/relevo:estado` y compañía se enviaban a Claude como texto en lugar de ejecutarse (comprobado con Claude Code 2.1.275).
- **Robustez:** cada comando indica el nombre exacto de las herramientas MCP (`mcp__plugin_relevo_team__*`), para que ningún modelo las confunda.
- Se retira de 0.1.1 la línea «los comandos también los puede invocar Claude».

## 0.1.1 — 2026-09-23

- **Instalador de un comando** (`install.cjs`), que funciona también en la app de escritorio de Claude, donde no existe `/plugin`.
- **README reescrito:** qué hay que conectar (Claude: nada; Gemini: `agy` + iniciar sesión) e instalación paso a paso.
- **Obsidian:** la bóveda se configura simplemente diciéndosela a Claude (`vault action=configure`). `/relevo:iniciar` la pregunta.
- **`/relevo:equipo`:** guarda siempre una nota de la sesión en Obsidian si está configurado, y puede saltarse el debate en tareas triviales.
- **Logs de MCP:** se borran los logs que los servidores MCP del usuario (p. ej. WordPress) dejaban en la carpeta del proyecto.
- **Estado:** ya no se confunde el límite de seguridad de Relevo con la cuota de Google.

## 0.1.0 — 2026-09-22

- Primera versión: servidor MCP con 7 herramientas, 5 comandos, copias aisladas, memoria compartida y Obsidian.
