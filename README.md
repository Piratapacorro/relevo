# Relevo

**Claude Code y Gemini trabajando como un equipo, con tus propias suscripciones.**

Relevo es un plugin gratuito y de código abierto para [Claude Code](https://code.claude.com). Convierte a Claude en el líder técnico de un equipo de dos. El otro miembro es Gemini, a través de la [Antigravity CLI](https://antigravity.google/docs/cli/) oficial de Google (`agy`).

- **Planifican juntos.** Gemini propone un plan, Claude lo critica y el plan final lo decide Claude.
- **Se reparten el trabajo.** Gemini hace el volumen: explorar el código, implementar, tests, documentación e investigación. Claude se queda con lo que exige más criterio.
- **Se revisan mutuamente.** Claude revisa los cambios de Gemini antes de aplicarlos, y Gemini hace una revisión adversarial de lo que escribe Claude.
- **Comparten memoria.** Tienen un tablero y una memoria del equipo en el propio proyecto, la memoria de Claude y, si quieres, tu bóveda de Obsidian.

**Por qué:** la cuota de Claude se acaba rápido. Con Relevo, el trabajo pesado corre por cuenta de tu suscripción de Google, y Claude dedica la suya a decidir y revisar.

> Español · [English](README.en.md)

---

## ¿Qué hay que conectar?

| | ¿Qué hay que hacer? |
|---|---|
| **Claude** | **Nada.** Relevo es un plugin: funciona **dentro** de tu Claude Code (app de escritorio o terminal), que ya usa tu cuenta Claude Pro o Max. |
| **Gemini** | Instalar la Antigravity CLI (`agy`) e **iniciar sesión una vez** con tu cuenta de Google AI Pro o Ultra. Si ya usas la app de Antigravity con esa cuenta, normalmente ya estás dentro. |

No hay API keys ni contraseñas que pegar en ningún sitio. Cada herramienta usa **tu** sesión oficial y Relevo nunca ve tus credenciales.

```
Tú ──► Claude Code (tu cuenta Claude) ──► Relevo ──► agy (tu cuenta Google) ──► Gemini
```

---

## Instalación (5 minutos)

### 1. Comprueba los requisitos

Abre una terminal (en Windows, **PowerShell**) y ejecuta:

```bash
node -v
git --version
```

- Si `node` no existe o su versión es menor que 18, instálalo desde [nodejs.org](https://nodejs.org) (versión LTS).
- Si `git` no existe, instálalo desde [git-scm.com](https://git-scm.com).

### 2. Conecta Gemini (Antigravity CLI)

**a) Instala `agy`:**

```powershell
# Windows (PowerShell)
irm https://antigravity.google/cli/install.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

**b) Inicia sesión.** Abre una terminal **nueva** (la anterior no reconoce aún el comando), escribe `agy` y pulsa Enter.
- Si pide cómo iniciar sesión, elige **Google**.
- Se abrirá el navegador: entra con tu cuenta de **Google AI Pro/Ultra** y acepta.
- Cuando veas el chat de `agy` en la terminal, ya está. Sal con `/exit`.

> Si Windows dice que `agy` no se reconoce, usa la ruta completa: `& "$env:LOCALAPPDATA\agy\bin\agy.exe"`

### 3. Instala Relevo en Claude Code

**Opción A · Recomendada.** Un solo comando que funciona en la app de escritorio y en la terminal. Pégalo en una terminal:

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.cjs | node
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.cjs | node
```

El instalador:
- añade Relevo a tu configuración de Claude Code (`~/.claude/settings.json`) y guarda antes una copia de seguridad;
- comprueba si tienes `agy`;
- te dice qué falta.

**Opción B.** Si usas Claude Code **en la terminal**, escribe esto dentro de Claude Code:

```
/plugin marketplace add Piratapacorro/relevo
/plugin install relevo@relevo
```

> En la **app de escritorio** de Claude no existe el comando `/plugin`: usa la opción A.

### 4. Reinicia y prepara tu proyecto

1. **Cierra y vuelve a abrir** la app de Claude (o Claude Code en la terminal). Al arrancar, descarga Relevo.
2. Abre una sesión en la carpeta de tu proyecto.
3. Escribe:

```
/relevo:iniciar
```

Claude hará lo siguiente:
- comprueba que Gemini está conectado;
- te explica el aviso sobre las condiciones de Google y te pide aceptarlo (solo la primera vez);
- prepara el proyecto;
- te pregunta si usas Obsidian y dónde está tu bóveda.

### 5. ¡A trabajar!

```
/relevo:equipo añade un formulario de contacto con validación y tests
```

---

## Comandos

| Comando | Qué hace |
|---|---|
| `/relevo:equipo <objetivo>` | Flujo completo y autónomo: contexto → plan → reparto → revisión cruzada → tests → memoria |
| `/relevo:preguntar <pregunta>` | Consulta rápida a Gemini (sobre tu código o de investigación) casi sin gastar cuota de Claude |
| `/relevo:revisar [R-n]` | Gemini revisa de forma adversarial tus cambios actuales (o un trabajo concreto) y Claude filtra los falsos positivos |
| `/relevo:estado` | Estado de Gemini, del tablero y de los trabajos pendientes |
| `/relevo:iniciar` | Prepara el proyecto y comprueba que todo está conectado |

Además, en cualquier conversación Claude puede usar las herramientas de Relevo por su cuenta, por ejemplo para pasarle a Gemini la lectura de un proyecto grande.

## Cómo trabajan por dentro

- **Copia aislada.** Gemini trabaja en una copia del proyecto (`git worktree`) fuera de tu carpeta. Nada llega a tu código hasta que Claude revisa el diff y lo integra.
- **También sin git.** En proyectos sin git, Relevo usa un repositorio "sombra" guardado fuera de tu carpeta, así que nunca aparece un `.git` en tu proyecto.
- **Todo se puede deshacer.**
- **Informes compactos.** Gemini devuelve un resumen corto y el detalle se guarda en `.relevo/jobs/`, así Claude gasta pocos tokens.
- **Multiplataforma.** Node.js puro, sin dependencias: Windows (sin WSL), macOS y Linux.

## Memoria compartida

| Dónde | Qué |
|---|---|
| `AGENTS.md` | Reglas del equipo. Gemini lo lee directamente y Claude a través de `@AGENTS.md` en `CLAUDE.md` |
| `.relevo/tablero.md` | Tareas, quién las hace y en qué estado están |
| `.relevo/decisiones.md` | Decisiones técnicas |
| `.relevo/memoria.md` | Lo aprendido del proyecto; Gemini lo recibe resumido en cada encargo |
| Memoria de Claude | Claude guarda allí lo que le sirve entre sesiones |
| Obsidian (opcional) | Gemini consulta las notas del proyecto y el equipo guarda allí un resumen de cada sesión con `[[wikilinks]]`. Funciona con Obsidian cerrado |

Relevo busca en tu bóveda una carpeta con el nombre del proyecto; si no la encuentra, usa la raíz. Para fijarla a mano, crea `.relevo/config.json` con `{"vaultFolder": "MiProyecto"}`.

## Permisos y seguridad

- **`completo`** (por defecto): Gemini puede ejecutar comandos (tests, builds), por eso trabaja en una copia aislada. Aun así, un comando podría afectar a tu equipo fuera de esa copia: úsalo en proyectos en los que confíes.
- **`solo-archivos`**: Gemini solo lee y edita archivos. Claude ejecuta los comandos, así que gasta más cuota de Claude.
- **Límite de seguridad:** 40 llamadas a Gemini por sesión (configurable) y un tiempo máximo por tarea.
- **Cuota de Google agotada:** Relevo lo detecta enseguida, prueba con un modelo Flash y te avisa si tampoco hay cuota.

Estos ajustes se cambian en la configuración del plugin, en la entrada `pluginConfigs` de `~/.claude/settings.json`. La bóveda de Obsidian basta con decírsela a Claude.

## ⚠️ Aviso sobre las condiciones de uso

- **Anthropic:** usar Claude Code sin modificar, con tu propia suscripción, está permitido. Relevo no usa el Agent SDK ni lanza `claude -p`.
- **Google:** las [condiciones de Antigravity](https://antigravity.google/terms) prohíben usar el servicio «con productos que no son de Google», y su [FAQ](https://antigravity.google/docs/faq/) menciona Claude Code como software de terceros. Google documenta el uso de `agy` en scripts, pero **no ha aclarado** si lanzar el binario oficial desde otra herramienta está permitido. En 2026 suspendió cuentas que reutilizaban el login de Antigravity en otras apps. Relevo no hace eso, pero **existe riesgo** y lo asumes tú.
- **Alternativa sin ese riesgo:** configura `agy` con una API key de Google AI Studio (`"modelProvider": "gemini"` en `~/.gemini/antigravity-cli/settings.json` y la variable `GEMINI_API_KEY`).

Relevo no está afiliado a Anthropic ni a Google. Claude, Gemini y Antigravity son marcas de sus propietarios.

## Solución de problemas

| Síntoma | Solución |
|---|---|
| No aparecen los comandos `/relevo:...` | Cierra y vuelve a abrir la app de Claude o Claude Code. Los plugins se cargan al arrancar |
| «/plugin no está disponible» | Estás en la app de escritorio: instala con la **opción A** |
| Windows: «`agy` no se reconoce» | Abre una terminal nueva, o usa `& "$env:LOCALAPPDATA\agy\bin\agy.exe"` |
| «Sesión de agy: NO iniciada» | Escribe `agy` en una terminal e inicia sesión con Google (paso 2b) |
| `agy` tarda en responder | En cada ejecución `agy` arranca los servidores MCP que tengas configurados en Antigravity. Desactiva los que no uses |
| «el turno se descartó» | Tienes permisos `solo-archivos` y Gemini intentó ejecutar un comando |
| Ver qué pasó en un trabajo | Mira `.relevo/jobs/R-n/`: ahí están el encargo, la respuesta y los eventos |

## Desinstalar

Borra `"relevo@relevo"` de `enabledPlugins` y `"relevo"` de `extraKnownMarketplaces` en `~/.claude/settings.json`. En la terminal también puedes usar `claude plugin uninstall relevo@relevo`.

## Desarrollo

```bash
npm test                                  # tests con un agy simulado (no gasta cuota)
node test/live.mjs <proyecto-de-prueba>   # prueba real contra agy (gasta un poco de cuota de Gemini)
claude --plugin-dir .                     # cargar el plugin sin instalarlo
```

## Licencia

MIT
