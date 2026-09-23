---
name: iniciar
description: Prepara Relevo en este proyecto y comprueba agy, la sesión de Google, los permisos y Obsidian. Úsalo cuando el usuario escriba /relevo:iniciar o pida configurar Relevo.
allowed-tools: mcp__plugin_relevo_team__status mcp__plugin_relevo_team__board mcp__plugin_relevo_team__vault
---

# Relevo · iniciar

Guía al usuario paso a paso, en lenguaje llano y sin jerga. Claude ya está conectado: es esta misma sesión con su cuenta. Lo único que hay que conectar es Gemini (agy).

1. Llama a `status` y resume en pocas líneas qué está listo y qué falta.
   - **agy no instalado:** dale el comando de instalación exacto que muestra `status`.
     - Después tiene que abrir una terminal NUEVA, escribir `agy` y entrar con su cuenta de Google (AI Pro o Ultra) en el navegador que se abre.
     - Cuando vea el chat de agy, puede salir con `/exit`.
     - Si ya usa la app de Antigravity con esa cuenta, normalmente ya tiene la sesión iniciada.
   - **Sesión de agy no iniciada:** solo el paso de escribir `agy` en una terminal nueva e iniciar sesión.
   - Cuando diga que ya lo ha hecho, vuelve a llamar a `status` para comprobarlo.
2. **CONSENTIMIENTO PENDIENTE:** explícale esto:
   - Relevo usa el agy oficial con su propia sesión y nunca toca contraseñas ni tokens.
   - Las condiciones de Antigravity prohíben usar el servicio «con productos de terceros», y Google no ha aclarado si este caso cuenta. Existe riesgo de que suspendan su cuenta de Google.
   - Alternativa sin ese riesgo: configurar agy con una API key de Google AI Studio.

   Pregúntale si acepta. Solo con un sí explícito, llama a `status accept_risk=true`.
3. Llama a `board action=init` y di en una línea qué creó (AGENTS.md, CLAUDE.md, .relevo/).
4. Obsidian:
   - **Configurado:** llama a `vault action=brief` y di qué carpeta usará. Si no es la correcta, se fija con `.relevo/config.json` → `{"vaultFolder": "Subcarpeta"}`.
   - **Sin configurar:** pregunta si usa Obsidian.
     - Si dice que sí: pídele la carpeta de su bóveda y guárdala con `vault action=configure path=<ruta>`.
     - Si dice que no: sigue sin Obsidian.
5. Termina con esta frase: «Listo. Escribe `/relevo:equipo <lo que quieras hacer>` y Claude y Gemini trabajarán juntos».
