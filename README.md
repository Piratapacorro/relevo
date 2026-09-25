# Relevo

**Claude Code y Gemini trabajando como un equipo, con tus propias suscripciones.**

Relevo es un plugin gratuito para [Claude Code](https://code.claude.com). Hace que Claude trabaje en equipo con Gemini, a través de la [Antigravity CLI](https://antigravity.google/docs/cli/) oficial de Google:

- **Se reparten el trabajo.** Gemini hace lo pesado (leer el código, programar, pasar tests, investigar) y Claude decide y revisa.
- **Se revisan mutuamente.** Nada de lo que hace Gemini llega a tu proyecto sin que Claude lo apruebe.
- **Recuerdan.** Tablero y memoria del equipo en tu proyecto y, si usas Obsidian, un diario de cada sesión en tu bóveda.

**Por qué:** la cuota de Claude se acaba rápido. Con Relevo el trabajo pesado corre a cargo de tu suscripción de Google.

> Español · [English](README.en.md)

---

## Instalación

**Necesitas:**
- **Claude Code** (la app de escritorio de Claude o la terminal) con tu cuenta **Claude Pro o Max**.
- Una cuenta de **Google con AI Pro o Ultra**.

No hace falta ninguna API key ni pegar contraseñas: Relevo usa tus sesiones oficiales.

### Paso 1 · Ejecuta el instalador

<details open>
<summary><b>Windows</b></summary>

1. Pulsa la tecla <kbd>Windows</kbd>, escribe **PowerShell** y ábrelo.
2. Copia esta línea, pégala en PowerShell y pulsa <kbd>Enter</kbd>:

```powershell
irm https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.ps1 | iex
```
</details>

<details>
<summary><b>Mac / Linux</b></summary>

1. Abre la app **Terminal**.
2. Copia esta línea, pégala y pulsa <kbd>Enter</kbd>:

```bash
curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash
```

> Si tu Linux responde `curl: orden no encontrada`, usa esta otra línea:
> ```bash
> wget -qO- https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.sh | bash
> ```
> Si tampoco tienes `wget`, instala curl primero con `sudo apt install curl`.
</details>

El instalador revisa tu equipo y **te pregunta antes de instalar nada**:

| Paso | Qué hace |
|---|---|
| 1/5 | Comprueba curl, git y Node.js 18+. Si faltan, los instala con el gestor de tu sistema (winget en Windows; apt, dnf, pacman… en Linux; Homebrew en Mac). En Linux, `sudo` te pedirá la contraseña de tu ordenador |
| 2/5 | Si no tienes Claude Code (ni la app ni la terminal), lo instala con el instalador oficial de Anthropic |
| 3/5 | Instala la Antigravity CLI oficial de Google (`agy`) si no la tienes |
| 4/5 | Activa Relevo en Claude Code (guarda antes una copia de tu configuración) |
| 5/5 | Comprueba que `agy` tiene tu sesión de Google iniciada |

### Paso 2 · Inicia sesión (solo la primera vez)

**En Google (Gemini).** Si en el paso 5/5 el instalador te lo pide:
1. Se abrirá tu navegador: entra con tu cuenta de **Google AI Pro/Ultra** y acepta.
2. Vuelve a la ventana del instalador.
3. Cuando veas el chat de `agy`, escribe `/exit` y pulsa <kbd>Enter</kbd>.

> Si ya usas la app de Antigravity con esa cuenta, este paso normalmente no hace falta.

**En Claude**, solo si el instalador acaba de instalarte Claude Code: abre una terminal **nueva**, escribe `claude` y entra con tu cuenta **Claude Pro o Max**.

### Paso 3 · Empieza a usarlo

1. **Cierra y vuelve a abrir** la app de Claude (o Claude Code en la terminal). Al arrancar, descarga Relevo.
2. Abre una sesión en la carpeta de tu proyecto y escribe:

```
/relevo:iniciar
```

Claude comprueba que todo está conectado, te explica el aviso sobre las condiciones de Google (solo la primera vez), prepara el proyecto y te pregunta por tu bóveda de Obsidian si la usas.

3. Pide trabajo al equipo:

```
/relevo:equipo añade un formulario de contacto con validación y tests
```

<details>
<summary><b>Otras formas de instalar</b> (si prefieres no usar el instalador)</summary>

**Dentro de Claude Code en la terminal:**
```
/plugin marketplace add Piratapacorro/relevo
/plugin install relevo@relevo
```
En la app de escritorio no existe `/plugin`.

**A mano:**
1. Instala la Antigravity CLI siguiendo [su guía oficial](https://antigravity.google/docs/cli/install/) y ejecuta `agy` una vez para iniciar sesión.
2. Añade esto a `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "relevo": { "source": { "source": "github", "repo": "Piratapacorro/relevo" } } },
  "enabledPlugins": { "relevo@relevo": true }
}
```

Relevo necesita Node.js 18+ y git.
</details>

---

## Comandos

| Comando | Qué hace |
|---|---|
| `/relevo:equipo <objetivo>` | Trabajo en equipo de principio a fin: contexto → plan → reparto → revisión → tests → memoria |
| `/relevo:preguntar <pregunta>` | Pregunta rápida a Gemini (sobre tu código o de investigación) casi sin gastar cuota de Claude |
| `/relevo:revisar` | Gemini revisa con lupa tus cambios actuales y Claude se queda con lo que de verdad importa |
| `/relevo:estado` | Cómo está el equipo: Gemini, tareas y trabajos pendientes |
| `/relevo:iniciar` | Prepara el proyecto y comprueba que todo está conectado |

## Cómo trabajan

- **Copia aislada.** Gemini trabaja en una copia de tu proyecto, fuera de tu carpeta. Nada llega a tu código hasta que Claude lo revisa y lo aprueba.
- **Todo se puede deshacer**, también en proyectos sin git: Relevo nunca crea un `.git` en tu carpeta.
- **Informes cortos.** Gemini devuelve un resumen compacto, así Claude gasta pocos tokens. El detalle queda en `.relevo/jobs/`.
- **Windows, macOS y Linux**, sin WSL y sin dependencias.

## Memoria compartida

| Dónde | Qué guarda |
|---|---|
| `AGENTS.md` | Las reglas del equipo. Las leen Gemini y Claude |
| `.relevo/tablero.md` | Tareas, quién las hace y en qué estado están |
| `.relevo/decisiones.md` | Decisiones técnicas |
| `.relevo/memoria.md` | Lo aprendido del proyecto; Gemini lo recibe en cada encargo |
| Obsidian (opcional) | Gemini consulta tus notas del proyecto, y Relevo escribe solo un **diario** con cada trabajo aprobado o descartado («Relevo - proyecto - fecha»). Funciona con Obsidian cerrado |

Relevo busca en tu bóveda una carpeta con el nombre del proyecto; si no la encuentra, usa la raíz. Para fijarla a mano, crea `.relevo/config.json` con `{"vaultFolder": "MiProyecto"}`.

## Permisos y seguridad

- **Permisos `completo`** (por defecto): Gemini puede ejecutar comandos (tests, builds) dentro de su copia aislada. Úsalo en proyectos en los que confíes.
- **Permisos `solo-archivos`**: Gemini solo lee y edita archivos, y los comandos los ejecuta Claude (gasta más cuota de Claude).
- **Límite de seguridad:** 40 llamadas a Gemini por sesión y un tiempo máximo por tarea.
- **Cuota de Google agotada:** Relevo lo detecta enseguida, prueba con un modelo Flash y te avisa si tampoco queda.

Estos ajustes se cambian en `~/.claude/settings.json`, dentro de `pluginConfigs`. La bóveda de Obsidian basta con decírsela a Claude.

## ⚠️ Aviso sobre las condiciones de uso

- **Anthropic:** usar Claude Code con tu propia suscripción está permitido. Relevo no usa el Agent SDK ni `claude -p`.
- **Google:** las [condiciones de Antigravity](https://antigravity.google/terms) prohíben usar el servicio «con productos que no son de Google», y su [FAQ](https://antigravity.google/docs/faq/) menciona Claude Code.
  - Relevo solo usa el programa oficial `agy` con tu propia sesión, pero Google **no ha aclarado** si eso está permitido.
  - En 2026 suspendió cuentas que reutilizaban el login de Antigravity en otras apps, algo que Relevo no hace.
  - Aun así, **existe riesgo** y lo asumes tú.
- **Alternativa sin ese riesgo:** configura `agy` con una API key de Google AI Studio (`"modelProvider": "gemini"` en `~/.gemini/antigravity-cli/settings.json` y la variable `GEMINI_API_KEY`).

Relevo no está afiliado a Anthropic ni a Google. Claude, Gemini y Antigravity son marcas de sus propietarios.

## Solución de problemas

| Problema | Solución |
|---|---|
| No aparecen los comandos `/relevo:...` | Cierra y vuelve a abrir la app de Claude. Los plugins se cargan al arrancar |
| El instalador dice que falta Node.js o git y no puede instalarlo | Instálalos a mano desde [nodejs.org](https://nodejs.org) (LTS) y [git-scm.com](https://git-scm.com), cierra la terminal y vuelve a ejecutar el instalador |
| Linux: `claude` o `agy` «no encontrado» justo después de instalar | Abre una terminal nueva (el instalador los añade a tu `PATH` en `~/.bashrc`) |
| «Sesión de agy: NO iniciada» | Vuelve a ejecutar el instalador y acepta iniciar sesión, o escribe `agy` en una terminal nueva |
| `agy` tarda en responder | Cada vez que se ejecuta, `agy` arranca los servidores MCP que tengas en Antigravity. Desactiva los que no uses |
| Quiero ver qué hizo Gemini | Mira `.relevo/jobs/R-n/`: el encargo, la respuesta y todos los pasos |

## Desinstalar

En `~/.claude/settings.json`, borra `"relevo@relevo"` de `enabledPlugins` y `"relevo"` de `extraKnownMarketplaces`. En la terminal también puedes usar `claude plugin uninstall relevo@relevo`.

## Desarrollo

```bash
npm test                                  # tests con un agy simulado (no gasta cuota)
node test/live.mjs <proyecto-de-prueba>   # prueba real contra agy (gasta un poco de cuota de Gemini)
claude --plugin-dir .                     # cargar el plugin sin instalarlo
```

## Licencia

MIT
