---
name: revisar
description: Revisión cruzada. Gemini revisa de forma adversarial los cambios actuales (o un trabajo R-n) y Claude filtra el resultado.
argument-hint: "[R-n | en qué fijarse]"
disable-model-invocation: true
allowed-tools: mcp__plugin_relevo_team__status mcp__plugin_relevo_team__delegate mcp__plugin_relevo_team__inspect
---

> Herramientas de Relevo (llámalas con estos nombres exactos): `status` = `mcp__plugin_relevo_team__status` · `delegate` = `mcp__plugin_relevo_team__delegate` · `inspect` = `mcp__plugin_relevo_team__inspect`

# Relevo · revisión cruzada

Argumentos: $ARGUMENTS

1. Llama a `delegate role=review`:
   - si los argumentos son un id `R-n`, con `review_of=<ese id>`;
   - si no, con `review_of=working` y usa los argumentos como el enfoque de la revisión dentro de `task`.
2. Filtra los hallazgos:
   - Descarta los falsos positivos. Para comprobarlos, lee solo las líneas citadas o usa `inspect` con `path`.
   - Ordena por severidad.
3. Presenta 10 hallazgos reales como máximo, cada uno con archivo:línea, el problema y el arreglo.
4. Si el usuario pidió corregirlos, corrígelos: los mecánicos con `delegate role=implement`, los delicados tú. Si no lo pidió, pregunta si quiere que se corrijan.
