#!/usr/bin/env node
// Servidor MCP de Relevo (stdio, JSON-RPC 2.0, sin dependencias).
// Claude Code lo arranca desde el plugin; habla con agy mediante server/lib/*.
import { Team, loadConfig } from './lib/team.mjs';

const VERSION = '0.1.1';
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

// stdout es exclusivo del protocolo: cualquier log va a stderr.
console.log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
console.info = console.log;

const S = (type, description, extra = {}) => ({ type, description, ...extra });

const TOOLS = [
  {
    name: 'status',
    description:
      'Estado de Relevo: agy (instalado, sesión, cuota, modelos), permisos, proyecto, tablero y Obsidian. Llámalo al empezar. ' +
      'accept_risk=true SOLO después de que el usuario acepte explícitamente el aviso que devuelve esta herramienta.',
    inputSchema: {
      type: 'object',
      properties: {
        accept_risk: S('boolean', 'Registrar que el usuario aceptó el aviso sobre las condiciones de Google.'),
        check: S('boolean', 'Comprobar sesión, cuota y modelos de agy (por defecto true).'),
      },
    },
  },
  {
    name: 'delegate',
    description:
      'Encarga trabajo a Gemini (Antigravity CLI con la suscripción del usuario). Úsalo para AHORRAR cuota de Claude: explorar código, ' +
      'planificar, implementar, probar, revisar e investigar. Por defecto las tareas que escriben van en una copia aislada (worktree) que luego ' +
      'se integra con integrate. Devuelve un informe compacto; el detalle queda en .relevo/jobs/<id>/.',
    inputSchema: {
      type: 'object',
      properties: {
        task: S('string', 'Qué debe hacer Gemini. Concreto y autocontenido; referencia rutas en vez de pegar código.'),
        role: S('string', 'Papel: explore | plan | implement | test | review | research | free.', { enum: ['explore', 'plan', 'implement', 'test', 'review', 'research', 'free'] }),
        mode: S('string', 'worktree (copia aislada, defecto al escribir) | inplace (carpeta real, reversible; mientras corre NO edites archivos del proyecto) | readonly (defecto al leer).', { enum: ['worktree', 'inplace', 'readonly'] }),
        title: S('string', 'Título corto para el tablero.'),
        files: { type: 'array', items: { type: 'string' }, description: 'Archivos en los que centrarse.' },
        context: S('string', 'Contexto o feedback de Claude (breve).'),
        continue_job: S('string', 'Id (R-n) de un trabajo anterior para continuarlo con feedback: misma conversación y misma copia.'),
        review_of: S('string', 'Con role=review: "working" (cambios actuales del proyecto, defecto) o un id R-n.'),
        model: S('string', 'auto (defecto) | pro | flash | slug exacto de agy.'),
        wait: S('boolean', 'Esperar al resultado (defecto true). false = en segundo plano; luego usa wait.'),
        timeout_minutes: S('number', 'Tiempo máximo para agy (defecto de la configuración).'),
        board_task: S('string', 'Id de tarea del tablero (T1…) que este trabajo resuelve.'),
      },
      required: [],
    },
  },
  {
    name: 'wait',
    description: 'Espera a un trabajo de Gemini lanzado con wait=false y devuelve su informe (o el progreso si sigue en curso).',
    inputSchema: {
      type: 'object',
      properties: { job_id: S('string', 'Id R-n.'), seconds: S('number', 'Máximo a esperar (defecto 600, máx. 1500).') },
      required: ['job_id'],
    },
  },
  {
    name: 'inspect',
    description: 'Detalle acotado de un trabajo: diff (filtrable por path), response completa, prompt enviado o log. Pide solo lo necesario.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: S('string', 'Id R-n.'),
        what: S('string', 'diff | response | prompt | log', { enum: ['diff', 'response', 'prompt', 'log'] }),
        path: S('string', 'Rutas separadas por comas para filtrar el diff.'),
        max_lines: S('number', 'Máximo de líneas (defecto 150, máx. 800).'),
      },
      required: ['job_id'],
    },
  },
  {
    name: 'integrate',
    description: 'Tras revisar: merge aplica al proyecto real el trabajo de la copia aislada (o acepta el inplace); discard lo descarta o lo deshace.',
    inputSchema: {
      type: 'object',
      properties: { job_id: S('string', 'Id R-n.'), action: S('string', 'merge | discard', { enum: ['merge', 'discard'] }) },
      required: ['job_id', 'action'],
    },
  },
  {
    name: 'board',
    description: 'Tablero del equipo en .relevo/: read (tareas + memoria), init (prepara el proyecto, AGENTS.md y CLAUDE.md), task (crear/actualizar tarea), decide (registrar decisión), learn (guardar aprendizaje).',
    inputSchema: {
      type: 'object',
      properties: {
        action: S('string', 'read | init | task | decide | learn', { enum: ['read', 'init', 'task', 'decide', 'learn'] }),
        id: S('string', 'Id de tarea (T1…); vacío para crear.'),
        title: S('string', 'Título de la tarea.'),
        owner: S('string', 'claude | gemini | humano', { enum: ['claude', 'gemini', 'humano'] }),
        status: S('string', 'pendiente | en curso | revisión | hecha | bloqueada | descartada', { enum: ['pendiente', 'en curso', 'revisión', 'hecha', 'bloqueada', 'descartada'] }),
        notes: S('string', 'Nota breve.'),
        text: S('string', 'Texto de la decisión o del aprendizaje (una o dos líneas).'),
        who: S('string', 'Autor (claude, gemini, humano).'),
      },
      required: ['action'],
    },
  },
  {
    name: 'vault',
    description: 'Bóveda de Obsidian del usuario: configure (guardar la ruta de la bóveda que te diga el usuario), brief (notas recientes del proyecto), search (buscar texto), save (guardar nota en Wiki/Output/Raw con frontmatter y [[wikilinks]]).',
    inputSchema: {
      type: 'object',
      properties: {
        action: S('string', 'configure | brief | search | save', { enum: ['configure', 'brief', 'search', 'save'] }),
        path: S('string', 'Con configure: carpeta raíz de la bóveda de Obsidian (la que contiene .obsidian).'),
        query: S('string', 'Texto a buscar.'),
        title: S('string', 'Título de la nota.'),
        content: S('string', 'Contenido Markdown de la nota (usa [[wikilinks]]).'),
        kind: S('string', 'wiki (aprendizaje, defecto) | output (entregable) | raw (material sin procesar)', { enum: ['wiki', 'output', 'raw'] }),
        tags: { type: 'array', items: { type: 'string' }, description: 'Etiquetas extra.' },
      },
      required: ['action'],
    },
  },
];

const INSTRUCTIONS =
  'Relevo coordina a Claude con Gemini (Antigravity CLI, suscripción del usuario). Para ahorrar cuota de Claude, delega en Gemini ' +
  'lecturas amplias, implementación en volumen, tests e investigación (delegate). Flujo de equipo completo: /relevo:equipo.';

const team = new Team(loadConfig());
const controllers = new Map();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function callTool(name, args, { progressToken, signal }) {
  let lastSent = 0;
  const onProgress = (jobId, p) => {
    if (progressToken === undefined) return;
    const now = Date.now();
    if (now - lastSent < 8000) return;
    lastSent = now;
    send({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken, progress: p.steps, message: `${jobId}: ${p.steps} pasos${p.lastTool ? ` · ${p.lastTool}` : ''}` },
    });
  };
  switch (name) {
    case 'status':
      return { text: await team.status(args) };
    case 'delegate':
      return team.delegate(args, { onProgress, signal });
    case 'wait':
      return team.wait(args, { signal });
    case 'inspect':
      return team.inspect(args);
    case 'integrate':
      return team.integrate(args);
    case 'board':
      return team.board(args);
    case 'vault':
      return team.vaultTool(args);
    default:
      return { error: true, text: `Herramienta desconocida: ${name}` };
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        reply(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'relevo', version: VERSION },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'notifications/initialized':
      case 'notifications/roots/list_changed':
        return;
      case 'notifications/cancelled': {
        controllers.get(params?.requestId)?.abort();
        return;
      }
      case 'ping':
        if (isRequest) reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const ac = new AbortController();
        controllers.set(id, ac);
        try {
          const out = await callTool(params?.name, params?.arguments || {}, { progressToken: params?._meta?.progressToken, signal: ac.signal });
          reply(id, { content: [{ type: 'text', text: out.text || '' }], isError: !!out.error });
        } catch (err) {
          reply(id, { content: [{ type: 'text', text: `Error interno de Relevo: ${err?.message || err}` }], isError: true });
        } finally {
          controllers.delete(id);
        }
        return;
      }
      case 'resources/list':
        if (isRequest) reply(id, { resources: [] });
        return;
      case 'prompts/list':
        if (isRequest) reply(id, { prompts: [] });
        return;
      default:
        if (isRequest) fail(id, -32601, `Método no soportado: ${method}`);
    }
  } catch (err) {
    if (isRequest) fail(id, -32603, String(err?.message || err));
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(null, -32700, 'JSON inválido');
      continue;
    }
    if (Array.isArray(msg)) msg.forEach((m) => handle(m));
    else handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', (err) => process.stderr.write(`[relevo] ${err?.stack || err}\n`));
process.on('unhandledRejection', (err) => process.stderr.write(`[relevo] ${err?.stack || err}\n`));
