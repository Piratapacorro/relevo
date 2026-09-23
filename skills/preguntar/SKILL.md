---
name: preguntar
description: Consulta rápida a Gemini (investigar o explorar el código) sin gastar apenas cuota de Claude.
argument-hint: <pregunta>
allowed-tools: mcp__plugin_relevo_team__status mcp__plugin_relevo_team__delegate
---

# Relevo · preguntar a Gemini

Pregunta: $ARGUMENTS

1. Llama a `delegate`:
   - con `role=explore` si la pregunta es sobre el código de este proyecto;
   - con `role=research` en cualquier otro caso.

   En `task` pasa la pregunta tal cual, más el contexto mínimo necesario.
2. Resume al usuario la respuesta de Gemini en 15 líneas como máximo, con las fuentes o rutas que cite.
3. No investigues por tu cuenta salvo que Gemini falle.
