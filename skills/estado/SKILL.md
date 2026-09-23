---
name: estado
description: Estado del equipo Relevo (agy, sesión de Google, tablero y trabajos en curso). Úsalo cuando el usuario escriba /relevo:estado.
disable-model-invocation: true
allowed-tools: mcp__plugin_relevo_team__status mcp__plugin_relevo_team__board
---

> Herramientas de Relevo (llámalas con estos nombres exactos): `status` = `mcp__plugin_relevo_team__status` · `board` = `mcp__plugin_relevo_team__board`

Llama a `status` y a `board action=read`. Resume al usuario en 10 líneas como máximo:
- estado de agy y de la sesión de Google;
- límite de seguridad de Relevo (llamadas usadas / máximo por sesión). No lo presentes como la cuota de Google: esa no se puede consultar sin gastarla;
- tareas abiertas;
- trabajos pendientes de integrar;
- qué harías a continuación.
