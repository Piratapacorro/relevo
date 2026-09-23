// Integración con la CLI oficial de Antigravity (agy).
// Relevo SOLO lanza el binario oficial con la sesión que el usuario inició él mismo.
// Nunca lee, guarda ni reenvía credenciales.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSafe, killTree, run } from './proc.mjs';
import { IS_WIN, readText, appendText } from './util.mjs';

const EXE = IS_WIN ? 'agy.exe' : 'agy';

function pathDirs(extra = '') {
  return [process.env.PATH || process.env.Path || '', extra]
    .join(path.delimiter)
    .split(path.delimiter)
    .map((d) => d.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

// En Windows el instalador escribe el PATH en el registro y los procesos ya abiertos
// no lo ven (issue #240): lo leemos directamente.
async function windowsRegistryPath() {
  if (!IS_WIN) return '';
  const r = await run('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { timeoutMs: 5000 });
  const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(r.stdout || '');
  if (!m) return '';
  return m[1].replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`);
}

export async function resolveAgy(configured) {
  const tried = [];
  const check = (p) => {
    if (!p) return null;
    tried.push(p);
    try {
      return fs.statSync(p).isFile() ? p : null;
    } catch {
      return null;
    }
  };
  if (configured && configured.trim()) {
    const p = configured.trim().replace(/^"|"$/g, '');
    if (IS_WIN && /\.(cmd|bat)$/i.test(p)) {
      return { bin: null, tried: [p], problem: 'La ruta configurada es un .cmd/.bat; indica el agy.exe real.' };
    }
    const found = check(p);
    if (found) return { bin: found, tried };
  }
  const home = os.homedir();
  const candidates = IS_WIN
    ? [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'antigravity-cli', 'agy.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'agy'),
        path.join(home, '.agy', 'bin', 'agy'),
        '/opt/homebrew/bin/agy',
        '/usr/local/bin/agy',
        '/usr/bin/agy',
      ];
  for (const c of candidates) {
    const f = check(c);
    if (f) return { bin: f, tried };
  }
  for (const dir of pathDirs(await windowsRegistryPath())) {
    const f = check(path.join(dir, EXE));
    if (f) return { bin: f, tried };
  }
  return { bin: null, tried };
}

export function agyEnv() {
  return {
    ...process.env,
    AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}

// agy arranca los servidores MCP del usuario incluso para `models`, y algunos (WordPress)
// escriben su log en la carpeta actual: las consultas rápidas se lanzan desde una carpeta neutra.
const NEUTRAL_CWD = os.tmpdir();

export async function agyVersion(bin) {
  const r = await run(bin, ['--version'], { cwd: NEUTRAL_CWD, env: agyEnv(), timeoutMs: 30000 });
  const m = /(\d+\.\d+\.\d+)/.exec(`${r.stdout}\n${r.stderr}`);
  return { version: m ? m[1] : null, ok: r.code === 0 && !!m, raw: (r.stdout || r.stderr).trim().slice(0, 200) };
}

export function versionAtLeast(v, min) {
  if (!v) return false;
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

/**
 * `agy models` (texto: "slug<TAB>Nombre" por línea) consulta el servidor con la sesión
 * del usuario: sirve a la vez para listar modelos y para saber si hay sesión, sin gastar cuota.
 * Ojo: `agy -p "/usage"` NO es gratis en 1.2.8 (lanza un turno del modelo), no lo usamos.
 */
export async function listModels(bin) {
  const r = await run(bin, ['models'], { cwd: NEUTRAL_CWD, env: agyEnv(), timeoutMs: 90000 });
  const text = `${r.stdout}\n${r.stderr}`;
  const all = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = /^\s*([a-z0-9][a-z0-9.\-_]*)\t/i.exec(line);
    if (m) all.push(m[1]);
  }
  // Solo modelos Gemini: los de terceros dentro de agy quedan sujetos a otras condiciones.
  const models = all.filter((m) => /^gemini/i.test(m));
  const authRequired = AUTH_RE.test(text) || (r.code !== 0 && !all.length && /auth|sign|login|credential/i.test(text));
  return { models, all, ok: r.code === 0 && all.length > 0, authRequired, code: r.code, raw: text.trim().slice(0, 800) };
}

// Elige el mejor Flash disponible como modelo de reserva cuando se agota la cuota.
export function pickFlash(models, exclude) {
  const flash = models.filter((m) => /gemini/i.test(m) && /flash/i.test(m) && !/lite/i.test(m) && m !== exclude);
  const score = (m) => {
    const v = /gemini-(\d+(?:\.\d+)?)/i.exec(m);
    return (v ? parseFloat(v[1]) * 10 : 0) + (/high/.test(m) ? 2 : /medium/.test(m) ? 1 : 0);
  };
  return flash.sort((a, b) => score(b) - score(a))[0] || null;
}

export const AUTH_RE = /authentication required|not (?:logged|signed) in|please (?:log|sign) ?in|login required|unauthenticated|sign in to (?:continue|use)/i;
export const QUOTA_RE = /RESOURCE_EXHAUSTED|\b429\b|Individual quota reached|quota (?:exceeded|reached|exhausted)|rate limit(?:ed)? exceeded/i;
const RESET_RE = /Resets in ((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+s)?)/i;
const PARTIAL_RE = /returning partial output/i;
const DENIED_RE = /auto-denied|no output produced|cannot prompt for/i;

export function classify({ exitCode, envelope, stderr, killedByWatchdog, stepErrors = [] }) {
  const errText = [envelope?.error ? JSON.stringify(envelope.error) : '', stderr || '', ...stepErrors].join('\n');
  const response = typeof envelope?.response === 'string' ? envelope.response : '';
  const agyError = /AGY_ERROR:\s*(\{.*\})/.exec(stderr || '');
  const reset = RESET_RE.exec(errText);
  // La cuota va primero: si la detectamos en el stream, matamos agy a propósito.
  if (QUOTA_RE.test(errText)) {
    return { kind: 'quota', message: `Cuota de Gemini agotada${reset ? ` (se renueva en ${reset[1].trim()})` : ''}.`, resetIn: reset?.[1]?.trim() || null };
  }
  if (killedByWatchdog) return { kind: 'timeout', message: 'agy no terminó a tiempo; lo he detenido.' };
  if (AUTH_RE.test(errText)) {
    return { kind: 'auth', message: 'agy no tiene la sesión iniciada. Ejecuta `agy` en una terminal e inicia sesión con tu cuenta de Google.' };
  }
  if (Array.isArray(envelope?.denied_actions) && envelope.denied_actions.length) {
    const names = envelope.denied_actions.map((d) => d.display_name || d.action).join(', ');
    return { kind: 'denied', message: `agy necesitaba permisos que no tiene en modo headless (${names}); el turno se descartó.` };
  }
  if (DENIED_RE.test(stderr || '') && !response.trim()) {
    return { kind: 'denied', message: 'agy intentó una acción sin permiso y el turno se descartó.' };
  }
  if (!envelope) {
    return { kind: 'crash', message: `agy terminó sin resultado (código ${exitCode}). ${agyError ? 'AGY_ERROR ' + agyError[1].slice(0, 300) : (stderr || '').trim().slice(-400)}` };
  }
  if (envelope.status && envelope.status !== 'SUCCESS') {
    return { kind: 'error', message: `agy terminó con estado ${envelope.status}. ${errText.trim().slice(0, 400)}` };
  }
  if (exitCode !== 0 && exitCode !== null) {
    return { kind: 'error', message: `agy salió con código ${exitCode}. ${agyError ? agyError[1].slice(0, 300) : (stderr || '').trim().slice(-400)}` };
  }
  if (PARTIAL_RE.test(stderr || '')) {
    return { kind: 'partial', message: 'Se agotó el tiempo de agy; la respuesta es parcial.' };
  }
  if (!response.trim()) return { kind: 'empty', message: 'agy terminó sin texto de respuesta.' };
  return null;
}

// Si stdout se pierde, la respuesta sigue en el transcript de agy (formato no documentado).
export function readTranscriptAnswer(conversationId) {
  if (!conversationId || !/^[\w-]+$/.test(conversationId)) return null;
  const roots = [path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'), path.join(os.homedir(), '.gemini', 'antigravity', 'brain')];
  for (const root of roots) {
    const file = path.join(root, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    const text = readText(file, null);
    if (!text) continue;
    let last = null;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.source === 'MODEL' && e.type === 'PLANNER_RESPONSE' && e.status === 'DONE' && e.content) last = e.content;
      } catch {}
    }
    if (last) return last;
  }
  return null;
}

/**
 * Ejecuta un turno de agy en modo headless con stream-json por stdin/stdout
 * (evita el límite de longitud de la línea de comandos de Windows).
 */
export function runAgy({ bin, cwd, prompt, model, effort, conversationId, skipPermissions, timeoutMin = 20, addDirs = [], eventsFile, onProgress, signal }) {
  return new Promise((resolve) => {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', `${Math.max(1, Math.round(timeoutMin))}m`, '--disable-slash-commands'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (conversationId) args.push('--conversation', conversationId);
    if (skipPermissions) args.push('--dangerously-skip-permissions');
    for (const d of addDirs) if (d) args.push('--add-dir', d);

    const started = Date.now();
    let child;
    try {
      child = spawnSafe(bin, args, { cwd, env: agyEnv() });
    } catch (err) {
      resolve({ exitCode: -1, envelope: null, stderr: String(err?.message || err), conversationId: null, steps: 0, durationMs: 0, error: { kind: 'crash', message: `No se pudo lanzar agy: ${err?.message || err}` } });
      return;
    }

    let buf = '';
    let stderr = '';
    let envelope = null;
    let convId = conversationId || null;
    let steps = 0;
    let lastTool = '';
    const stepErrors = [];
    let killedByWatchdog = false;
    let quotaKilled = false;
    let settled = false;

    let exitTimer = null;
    let forceTimer = null;
    // Si un nieto (servidor MCP, dev server…) hereda stdout, 'close' nunca llega:
    // tras matar el árbol, o 3 s después de que agy salga, cerramos igualmente.
    const forceFinish = (code, delay) => {
      clearTimeout(forceTimer);
      forceTimer = setTimeout(() => {
        try { child.stdout.destroy(); } catch {}
        try { child.stderr.destroy(); } catch {}
        finish(code);
      }, delay);
    };
    const watchdogMs = (Math.max(1, timeoutMin) * 60 + 90) * 1000;
    const watchdog = setTimeout(() => {
      killedByWatchdog = true;
      killTree(child);
      forceFinish(null, 5000);
    }, watchdogMs);
    const onAbort = () => {
      killedByWatchdog = true;
      killTree(child);
      forceFinish(null, 5000);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (eventsFile) {
        try { appendText(eventsFile, trimmed + '\n'); } catch {}
      }
      let ev;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (ev.event === 'init' && ev.conversation_id) {
        convId = ev.conversation_id;
        if (process.env.RELEVO_DEBUG) process.stderr.write(`[relevo] agy init tras ${Date.now() - started}ms\n`);
      }
      if (ev.event === 'result' && ev.result) {
        envelope = ev.result;
        if (envelope.conversation_id) convId = envelope.conversation_id;
      }
      const st = ev.step_update;
      if (st) {
        if (st.conversation_id) convId = convId || st.conversation_id;
        if (st.state === 'DONE') steps++;
        if (st.tool_name) lastTool = st.tool_name;
        if (st.step_type === 'error_message' && st.text_delta) {
          stepErrors.push(String(st.text_delta));
          // agy reintenta la cuota agotada hasta el timeout (issue #1018): cortamos ya.
          if (QUOTA_RE.test(st.text_delta) && !quotaKilled) {
            quotaKilled = true;
            killTree(child);
            forceFinish(null, 5000);
          }
        }
        onProgress?.({ steps, lastTool, elapsedMs: Date.now() - started });
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      if (stderr.length < 200000) stderr += d;
    });

    const finish = (exitCode, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      clearTimeout(exitTimer);
      clearTimeout(forceTimer);
      signal?.removeEventListener?.('abort', onAbort);
      if (buf.trim()) handleLine(buf);
      let fallbackResponse = null;
      if (!envelope && convId) fallbackResponse = readTranscriptAnswer(convId);
      if (!envelope && fallbackResponse) envelope = { status: 'SUCCESS', response: fallbackResponse, conversation_id: convId, recovered_from_transcript: true };
      const error = spawnError
        ? { kind: 'crash', message: `No se pudo lanzar agy: ${spawnError.message}` }
        : classify({ exitCode, envelope, stderr, killedByWatchdog, stepErrors });
      resolve({ exitCode, envelope, stderr, conversationId: convId, steps, lastTool, durationMs: Date.now() - started, error });
    };

    child.on('error', (err) => finish(-1, err));
    child.on('exit', (code) => {
      exitTimer = setTimeout(() => {
        try { child.stdout.destroy(); } catch {}
        try { child.stderr.destroy(); } catch {}
        finish(code);
      }, 3000);
    });
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    // Un turno por línea NDJSON; cerrar stdin termina la sesión tras el resultado.
    child.stdin.end(JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n');
  });
}
