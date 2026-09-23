# Cambios

## 0.1.1 — 2026-09-23

- **Instalador de un comando** (`install.cjs`), que funciona también en la app de escritorio de Claude, donde no existe `/plugin`.
- **README reescrito:** qué hay que conectar (Claude: nada; Gemini: `agy` + iniciar sesión) e instalación paso a paso.
- **Obsidian:** la bóveda se configura simplemente diciéndosela a Claude (`vault action=configure`). `/relevo:iniciar` la pregunta.
- **`/relevo:equipo`:** guarda siempre una nota de la sesión en Obsidian si está configurado, y puede saltarse el debate en tareas triviales.
- **Comandos:** Claude también puede invocarlos por su cuenta (por ejemplo, `/relevo:preguntar` para ahorrar cuota).
- **Logs de MCP:** se borran los logs que los servidores MCP del usuario (p. ej. WordPress) dejaban en la carpeta del proyecto.
- **Estado:** ya no se confunde el límite de seguridad de Relevo con la cuota de Google.

## 0.1.0 — 2026-09-22

- Primera versión: servidor MCP con 7 herramientas, 5 comandos, copias aisladas, memoria compartida y Obsidian.
