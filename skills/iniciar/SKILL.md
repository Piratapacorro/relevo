---
name: iniciar
description: Prepara Relevo en este proyecto y comprueba agy, la sesión de Google, los permisos y Obsidian.
disable-model-invocation: true
allowed-tools: mcp__plugin_relevo_team__status mcp__plugin_relevo_team__board mcp__plugin_relevo_team__vault
---

# Relevo · iniciar

1. Llama a `status` y explica el resultado al usuario en lenguaje llano, en 8 líneas como máximo.
   - **agy no instalado:** dale el comando de instalación que muestra `status`. Después tiene que ejecutar `agy` una vez en una terminal: se abre el navegador y entra con su cuenta de Google (AI Pro o Ultra). En Windows, si la terminal no encuentra `agy`, que la cierre y abra otra.
   - **Sesión no iniciada:** solo el paso de ejecutar `agy`.
   - **CONSENTIMIENTO PENDIENTE:** explícale esto:
     - Relevo usa el agy oficial con su propia sesión y nunca toca contraseñas ni tokens.
     - Las condiciones de Antigravity prohíben usar el servicio «con productos de terceros», y Google no ha aclarado si este caso cuenta. Existe riesgo de que suspendan su cuenta de Google.
     - Alternativa sin ese riesgo: configurar agy con una API key de Google AI Studio.

     Pregúntale si acepta. Solo con un sí explícito, llama a `status accept_risk=true`.
2. Llama a `board action=init` y di qué creó o modificó (AGENTS.md, CLAUDE.md, .relevo/).
3. Obsidian:
   - **Configurado:** llama a `vault action=brief` y di qué carpeta usará. Si no es la correcta, se puede fijar en `.relevo/config.json` con `{"vaultFolder": "Subcarpeta"}`.
   - **Sin configurar:** di que se configura en `/plugin` → Relevo → «Bóveda de Obsidian».
4. Termina con: «Listo. Usa `/relevo:equipo <objetivo>` para trabajar en equipo».
