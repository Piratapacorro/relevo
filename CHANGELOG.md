# Cambios

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
