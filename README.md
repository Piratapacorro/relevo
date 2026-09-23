# Relevo

**Claude Code y Gemini trabajando como un equipo, con tus propias suscripciones.**

Relevo es un plugin gratuito y de código abierto para [Claude Code](https://code.claude.com). Convierte a Claude en el líder técnico de un equipo de dos. El otro miembro es Gemini, a través de la [Antigravity CLI](https://antigravity.google/docs/cli/) oficial de Google (`agy`).

- **Planifican juntos.** Gemini propone un plan, Claude lo critica y el plan final lo decide Claude.
- **Se reparten el trabajo por especialidad.** Gemini hace el volumen (explorar el código, implementar, tests, documentación, investigación) y Claude lo que exige más criterio.
- **Se revisan el código mutuamente.** Claude revisa los diffs de Gemini y Gemini hace una revisión adversarial de lo que escribe Claude.
- **Comparten memoria.** Hay un tablero y una memoria del equipo en el propio proyecto, más la memoria de Claude y tu bóveda de Obsidian.

Sin API keys: cada persona usa **su** Claude Pro/Max y **su** Google AI Pro/Ultra, iniciando sesión en las herramientas oficiales.

> Español · [English](README.en.md)

---

## ¿Por qué?

La cuota de Claude se acaba rápido. Con Relevo, el trabajo pesado (leer medio repositorio, escribir código repetitivo, ejecutar tests) lo hace Gemini con tu suscripción de Google. Claude recibe informes compactos y dedica su cuota a decidir y revisar.

## Cómo funciona

```
Tú ──► Claude Code (líder técnico)
          │  herramientas MCP de Relevo
          ▼
        Relevo ──► agy oficial (Gemini) ──► copia aislada del proyecto (git worktree)
          │                                   │
          │◄──── informe compacto + diff ◄────┘
          ▼
   tablero .relevo/ · AGENTS.md · memoria de Claude · Obsidian
```

- **Copia aislada por defecto.** Gemini trabaja en un `git worktree` fuera de tu proyecto. Nada llega a tu código hasta que Claude revisa el diff y lo integra.
  - Si el proyecto **no usa git**, Relevo crea un repositorio "sombra" fuera de tu carpeta, así que nunca aparece un `.git` en tu proyecto.
  - Todo se puede deshacer.
- **Nada de credenciales.** Relevo solo lanza el binario oficial `agy` con la sesión que tú iniciaste. No lee, guarda ni reenvía tokens.
- **Sin dependencias.** Es Node.js puro y funciona en **Windows (sin WSL), macOS y Linux**.

## Requisitos

| | |
|---|---|
| Claude Code | Reciente (probado con 2.1.275), con tu cuenta Claude Pro o Max |
| Node.js | 18 o superior |
| git | Cualquier versión moderna |
| Antigravity CLI (`agy`) | 1.2.6 o superior, con tu cuenta de Google AI Pro o Ultra |

## Instalación

**1. Instala `agy` e inicia sesión una vez.**

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex
```

Después ejecuta `agy` en una terminal nueva: se abre el navegador para entrar con tu cuenta de Google. Si ya usas la app de Antigravity, puede que la sesión ya esté iniciada.

**2. Instala Relevo en Claude Code.**

```
/plugin marketplace add Piratapacorro/relevo
/plugin install relevo@relevo
```

Durante la instalación puedes indicar tu bóveda de Obsidian y los permisos de Gemini. Todo se puede cambiar después en `/plugin`.

**3. Prepara el proyecto.**

```
/relevo:iniciar
```

La primera vez te explicará el aviso sobre las condiciones de Google (ver abajo) y te pedirá que lo aceptes.

## Uso

| Comando | Qué hace |
|---|---|
| `/relevo:equipo <objetivo>` | Flujo completo y autónomo: contexto → plan debatido → reparto → revisión cruzada → tests → memoria |
| `/relevo:preguntar <pregunta>` | Consulta rápida a Gemini (investigar o explorar el código) casi sin gastar cuota de Claude |
| `/relevo:revisar [R-n]` | Gemini revisa de forma adversarial tus cambios actuales (o un trabajo concreto) y Claude filtra los falsos positivos |
| `/relevo:estado` | Estado de `agy`, del tablero y de los trabajos pendientes |
| `/relevo:iniciar` | Prepara el proyecto y comprueba que todo está listo |

Ejemplo:

```
/relevo:equipo añade un formulario de contacto con validación y tests
```

Claude también puede usar las herramientas de Relevo por su cuenta en cualquier conversación, por ejemplo para delegar una exploración grande en Gemini.

## Memoria compartida

| Dónde | Qué |
|---|---|
| `AGENTS.md` | Reglas del equipo. Lo leen Gemini (de forma nativa) y Claude (a través de `@AGENTS.md` en `CLAUDE.md`) |
| `.relevo/tablero.md` | Tareas, responsable y estado |
| `.relevo/decisiones.md` | Registro de decisiones técnicas |
| `.relevo/memoria.md` | Aprendizajes duraderos del proyecto; viajan resumidos en cada encargo a Gemini |
| Memoria de Claude | Claude guarda allí lo que le sirva entre sesiones |
| Obsidian (opcional) | Gemini consulta las notas del proyecto y el equipo guarda allí un resumen de cada sesión, con `[[wikilinks]]` |

Relevo busca en tu bóveda una carpeta con el nombre del proyecto; si no la encuentra, usa la raíz. Para fijarla a mano, crea `.relevo/config.json` con `{"vaultFolder": "MiProyecto"}`. Las notas se escriben directamente en Markdown, así que funciona con Obsidian cerrado.

## Permisos y seguridad

- **`completo`** (por defecto): Gemini puede ejecutar comandos, como tests o builds. Relevo lo lanza con `--dangerously-skip-permissions`, porque en modo no interactivo `agy` descarta el turno entero ante cualquier permiso denegado. Por eso trabaja por defecto en una **copia aislada**. Aun así, un comando puede afectar a tu equipo fuera de esa copia: úsalo en proyectos en los que confíes.
- **`solo-archivos`**: Gemini solo lee y edita archivos. Claude ejecuta los comandos, lo que gasta más cuota de Claude.
- Límite configurable de llamadas a Gemini por sesión (40 por defecto) y un tiempo máximo por tarea.
- Si se agota la cuota de Gemini, Relevo lo detecta enseguida, prueba con un modelo Flash y, si tampoco hay cuota, avisa.

## ⚠️ Aviso sobre las condiciones de uso

- **Anthropic:** usar Claude Code sin modificar, con tu propia suscripción, está permitido. Relevo no usa el Agent SDK ni lanza `claude -p`.
- **Google:** las [condiciones de Antigravity](https://antigravity.google/terms) prohíben usar el servicio «con productos que no son de Google». Su [FAQ](https://antigravity.google/docs/faq/) menciona Claude Code como software de terceros. Google documenta el uso de `agy` en scripts, pero **no ha aclarado** si lanzar el binario oficial desde otra herramienta está permitido. En 2026 ha suspendido cuentas que reutilizaban el login de Antigravity en otras apps. Relevo no hace eso, pero **existe riesgo** y lo asumes tú.
- **Alternativa sin ese riesgo:** configura `agy` con una API key de Google AI Studio (`"modelProvider": "gemini"` en `~/.gemini/antigravity-cli/settings.json` y la variable `GEMINI_API_KEY`).

Relevo no está afiliado a Anthropic ni a Google. Claude, Gemini y Antigravity son marcas de sus propietarios.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| «agy no encontrado» en Windows | Cierra y abre la terminal o Claude Code (el instalador actualiza el PATH), o indica la ruta en la opción `agy_path` |
| `agy` tarda en arrancar | `agy` espera a que se conecten todos los servidores MCP que tengas en Antigravity. Desactiva los que no uses |
| «el turno se descartó» | Tienes permisos `solo-archivos` y Gemini intentó ejecutar un comando: cambia a `completo` o pide la tarea sin comandos |
| Diagnóstico | Arranca Claude Code con la variable `RELEVO_DEBUG=1`. Cada trabajo guarda el prompt, la respuesta y los eventos en `.relevo/jobs/R-n/` |

## Desarrollo

```bash
npm test               # tests con un agy simulado (no gasta cuota)
node test/live.mjs <proyecto-de-prueba>   # prueba real contra agy (gasta un poco de cuota de Gemini)
claude --plugin-dir .  # cargar el plugin sin instalarlo
```

## Licencia

MIT
