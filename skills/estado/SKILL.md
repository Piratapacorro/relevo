---
name: estado
description: Estado del equipo Relevo (agy, cuota de Gemini, tablero y trabajos en curso).
disable-model-invocation: true
allowed-tools: mcp__plugin_relevo_team__status mcp__plugin_relevo_team__board
---

Llama a `status` y a `board action=read`. Resume al usuario en 10 líneas como máximo:
- estado de agy;
- cuota de Gemini;
- tareas abiertas;
- trabajos pendientes de integrar;
- qué harías a continuación.
