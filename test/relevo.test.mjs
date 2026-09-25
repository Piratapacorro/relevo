// Tests de extremo a extremo: arrancan el servidor MCP real y hablan con él
// por stdio, usando un agy simulado. Ejecuta: node --test test/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', 'server', 'index.mjs');
const FAKE = path.join(here, 'fake-agy.mjs');

const tmpDirs = [];
function tmp(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `relevo-${name}-`));
  tmpDirs.push(d);
  return d;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
}

const servers = [];
after(async () => {
  servers.forEach((s) => s.close());
  await new Promise((r) => setTimeout(r, 1500));
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
});

function startServer(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, RELEVO_AGY_PATH: FAKE, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      if (msg.id !== undefined && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const call = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    if (r.error) throw new Error(r.error.message);
    return { text: r.result.content[0].text, isError: r.result.isError };
  };
  const api = {
    request,
    call,
    stderr: () => stderr,
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
  servers.push(api);
  return api;
}

async function ready(env) {
  const s = startServer(env);
  const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'relevo');
  return s;
}

test('protocolo MCP: initialize y lista de herramientas', async () => {
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p') });
  const list = await s.request('tools/list', {});
  const names = list.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['board', 'delegate', 'inspect', 'integrate', 'status', 'vault', 'wait']);
  const unknown = await s.request('metodo/raro', {});
  assert.equal(unknown.error.code, -32601);
  s.close();
});

test('consentimiento: sin aceptar no delega; status informa del riesgo', async () => {
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p') });
  const st = await s.call('status');
  assert.match(st.text, /CONSENTIMIENTO PENDIENTE/);
  assert.match(st.text, /Sesión de agy: iniciada/);
  assert.match(st.text, /gemini-3\.8-flash-high/);
  const d = await s.call('delegate', { task: 'hola' });
  assert.equal(d.isError, true);
  assert.match(d.text, /consentimiento/i);
  const ok = await s.call('status', { accept_risk: true, check: false });
  assert.doesNotMatch(ok.text, /CONSENTIMIENTO PENDIENTE/);
  s.close();
});

test('proyecto git: copia aislada con cambios sin confirmar, diff e integración', async () => {
  const proj = tmp('git');
  git(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'original\n');
  git(proj, 'add', '.');
  git(proj, 'commit', '-q', '-m', 'init');
  fs.appendFileSync(path.join(proj, 'a.txt'), 'cambio de claude sin confirmar\n');
  fs.writeFileSync(path.join(proj, 'nuevo-sin-git.txt'), 'untracked\n');
  const data = tmp('data');
  const log = path.join(data, 'agy.log');
  const s = await ready({ CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: proj, FAKE_AGY_LOG: log });
  await s.call('status', { accept_risk: true, check: false });

  const d = await s.call('delegate', { task: 'CREA_ARCHIVO:src/nuevo.js MODIFICA:a.txt', role: 'implement', title: 'prueba' });
  assert.equal(d.isError, false, d.text);
  assert.match(d.text, /R-1/);
  assert.match(d.text, /src\/nuevo\.js/);
  assert.match(d.text, /copia aislada/);
  assert.ok(!fs.existsSync(path.join(proj, 'src', 'nuevo.js')), 'el proyecto real no debe cambiar antes de integrar');

  // Gemini vio los cambios sin confirmar y el archivo no versionado de Claude
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const run = calls.find((c) => c.args.includes('stream-json'));
  assert.match(fs.readFileSync(path.join(run.cwd, 'a.txt'), 'utf8'), /cambio de claude sin confirmar/);
  assert.ok(fs.existsSync(path.join(run.cwd, 'nuevo-sin-git.txt')), 'la copia incluye archivos nuevos no versionados');

  const diff = await s.call('inspect', { job_id: 'R-1', what: 'diff' });
  assert.match(diff.text, /hola desde gemini/);
  assert.match(diff.text, /línea añadida por gemini/);
  assert.doesNotMatch(diff.text, /^\+cambio de claude/m, 'lo de Claude es la base, no un cambio de Gemini');

  // Continuar con feedback: misma conversación
  const d2 = await s.call('delegate', { continue_job: 'R-1', task: 'MODIFICA:src/nuevo.js' });
  assert.match(d2.text, /ronda 2/);
  const calls2 = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls2.at(-1).args.includes('--conversation'), 'la ronda 2 debe continuar la conversación');

  const m = await s.call('integrate', { job_id: 'R-1', action: 'merge' });
  assert.equal(m.isError, false, m.text);
  // Git aplica la configuración de fin de línea del usuario (CRLF con autocrlf en Windows).
  const nuevo = fs.readFileSync(path.join(proj, 'src', 'nuevo.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(nuevo, 'hola desde gemini\nlínea añadida por gemini\n');
  const a = fs.readFileSync(path.join(proj, 'a.txt'), 'utf8');
  assert.match(a, /cambio de claude sin confirmar/);
  assert.match(a, /línea añadida por gemini/);
  assert.equal(git(proj, 'diff', '--cached').trim(), '', 'el índice del usuario no se toca');
  assert.doesNotMatch(git(proj, 'branch', '--list'), /relevo/);
  assert.equal(git(proj, 'log', '--oneline').trim().split('\n').length, 1, 'no se crean commits en la rama del usuario');
  s.close();
});

test('proyecto sin git: trabajo en la carpeta real y deshacer', async () => {
  const proj = tmp('nogit');
  fs.writeFileSync(path.join(proj, 'b.txt'), 'b original\n');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj });
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'MODIFICA:b.txt CREA_ARCHIVO:c.txt', mode: 'inplace' });
  assert.equal(d.isError, false, d.text);
  assert.match(fs.readFileSync(path.join(proj, 'b.txt'), 'utf8'), /gemini/);
  assert.ok(fs.existsSync(path.join(proj, 'c.txt')));
  const u = await s.call('integrate', { job_id: 'R-1', action: 'discard' });
  assert.match(u.text, /2 archivos restaurados/);
  assert.equal(fs.readFileSync(path.join(proj, 'b.txt'), 'utf8'), 'b original\n');
  assert.ok(!fs.existsSync(path.join(proj, 'c.txt')));
  assert.ok(!fs.existsSync(path.join(proj, '.git')), 'nunca se crea .git en el proyecto del usuario');
  s.close();
});

test('proyecto sin git: copia aislada mediante repositorio sombra', async () => {
  const proj = tmp('shadow');
  fs.writeFileSync(path.join(proj, 'x.txt'), 'x\n');
  fs.mkdirSync(path.join(proj, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'node_modules', 'dep', 'i.js'), '1');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj });
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'CREA_ARCHIVO:y.txt' });
  assert.equal(d.isError, false, d.text);
  assert.ok(!fs.existsSync(path.join(proj, 'y.txt')));
  assert.doesNotMatch(d.text, /node_modules/, 'las dependencias enlazadas no aparecen en el diff');
  const m = await s.call('integrate', { job_id: 'R-1', action: 'merge' });
  assert.equal(m.isError, false, m.text);
  assert.ok(fs.existsSync(path.join(proj, 'y.txt')));
  assert.ok(fs.existsSync(path.join(proj, 'node_modules', 'dep', 'i.js')), 'borrar la copia no borra node_modules real');
  s.close();
});

test('cuota agotada: se detecta pronto y no se queda colgado', async () => {
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p'), FAKE_AGY_MODE: 'quota' });
  await s.call('status', { accept_risk: true, check: false });
  const t0 = Date.now();
  const d = await s.call('delegate', { task: 'algo', role: 'research' });
  assert.match(d.text, /Cuota de Gemini agotada/);
  assert.match(d.text, /2h39m52s/);
  assert.ok(Date.now() - t0 < 30000, 'debe cortar sin esperar al timeout');
  s.close();
});

test('sesión de agy no iniciada: aviso claro', async () => {
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p'), FAKE_AGY_MODE: 'auth' });
  const st = await s.call('status');
  assert.match(st.text, /Sesión de agy: NO iniciada/);
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'x', role: 'research' });
  assert.match(d.text, /no tiene la sesión iniciada/);
  s.close();
});

test('stdout perdido y sin transcript: fallo explicado, sin cuelgue', async () => {
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p'), FAKE_AGY_MODE: 'nostdout' });
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'x', role: 'research' });
  assert.match(d.text, /terminó sin resultado|sin texto/);
  s.close();
});

test('tablero, AGENTS.md, CLAUDE.md y revisión del trabajo actual', async () => {
  const proj = tmp('board');
  git(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'app.js'), 'let a = 1;\n');
  git(proj, 'add', '.');
  git(proj, 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '# Reglas\n');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj });
  await s.call('status', { accept_risk: true, check: false });
  const init = await s.call('board', { action: 'init' });
  assert.match(init.text, /AGENTS\.md/);
  assert.match(fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  assert.match(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), /relevo:start/);
  await s.call('board', { action: 'init' }); // idempotente
  assert.equal((fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8').match(/@AGENTS\.md/g) || []).length, 1);
  const t = await s.call('board', { action: 'task', title: 'Formulario de contacto', owner: 'gemini' });
  assert.match(t.text, /T1/);
  await s.call('board', { action: 'decide', text: 'Usamos fetch nativo' });
  await s.call('board', { action: 'learn', text: 'Los tests se lanzan con npm test' });
  const r = await s.call('board', { action: 'read' });
  assert.match(r.text, /Formulario de contacto/);
  assert.match(r.text, /npm test/);

  fs.writeFileSync(path.join(proj, 'app.js'), 'let a = 2; // cambio de claude\n');
  const rev = await s.call('delegate', { task: 'Revisa los cambios', role: 'review', board_task: 'T1' });
  assert.equal(rev.isError, false, rev.text);
  const diffFile = path.join(proj, '.relevo', 'jobs', 'R-1', 'review.diff');
  assert.match(fs.readFileSync(diffFile, 'utf8'), /cambio de claude/);
  const prompt = fs.readFileSync(path.join(proj, '.relevo', 'jobs', 'R-1', 'prompt.md'), 'utf8');
  assert.match(prompt, /npm test/, 'la memoria del equipo viaja en el prompt');
  assert.match(fs.readFileSync(path.join(proj, '.relevo', 'tablero.md'), 'utf8'), /T1/);
  s.close();
});

test('Obsidian: carpeta del proyecto, guardar, buscar y resumen (ruta con tilde)', async () => {
  const vaultRoot = path.join(tmp('vault'), 'Mi Bóveda');
  fs.mkdirSync(path.join(vaultRoot, 'Signopack', 'Wiki'), { recursive: true });
  fs.writeFileSync(path.join(vaultRoot, 'Signopack', 'Wiki', 'Clientes.md'), '# Clientes\nLista de clientes de cartelería.\n');
  const projParent = tmp('proj');
  const proj = path.join(projParent, 'signopack_local');
  fs.mkdirSync(proj);
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj, RELEVO_VAULT_PATH: vaultRoot });
  const b = await s.call('vault', { action: 'brief' });
  assert.match(b.text, /Signopack/);
  assert.match(b.text, /Clientes/);
  const sv = await s.call('vault', { action: 'save', title: 'Relevo: sesión formulario', content: 'Hecho con [[Clientes]].', tags: ['web'] });
  assert.match(sv.text, /Signopack\/Wiki\/Relevo  sesión formulario\.md|Signopack\/Wiki\/Relevo sesión formulario\.md/);
  const q = await s.call('vault', { action: 'search', query: 'cartelería' });
  assert.match(q.text, /Clientes\.md:2/);
  s.close();
});

// ---------- Regresiones de la revisión de seguridad/errores ----------

test('regresión: un meta.json plantado en el repo no controla nada', async () => {
  const proj = tmp('plant');
  const victim = tmp('victim');
  fs.writeFileSync(path.join(victim, 'importante.txt'), 'no me borres');
  fs.mkdirSync(path.join(proj, '.relevo', 'jobs', 'R-1'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.relevo', 'jobs', 'R-1', 'meta.json'), JSON.stringify({ id: 'R-1', status: 'done', mode: 'worktree', role: 'implement', base: 'x', tip: 'x', worktree: { path: victim, branch: 'main' } }));
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj });
  const r = await s.call('integrate', { job_id: 'R-1', action: 'discard' });
  assert.match(r.text, /No existe el trabajo R-1/);
  assert.ok(fs.existsSync(path.join(victim, 'importante.txt')));
  const bad = await s.call('inspect', { job_id: '../../x', what: 'diff' });
  assert.match(bad.text, /No existe/);
  s.close();
});

test('regresión: commit.gpgsign del usuario no rompe la copia aislada', async () => {
  const gcfg = path.join(tmp('gcfg'), 'gitconfig');
  fs.writeFileSync(gcfg, '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = gpg-que-no-existe\n[user]\n\tname = U\n\temail = u@u\n');
  const proj = tmp('gpg');
  git(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, 'add', '.');
  git(proj, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj, GIT_CONFIG_GLOBAL: gcfg });
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'CREA_ARCHIVO:b.txt' });
  assert.equal(d.isError, false, d.text);
  assert.doesNotMatch(d.text, /Problema/);
  assert.match(d.text, /b\.txt/);
  s.close();
});

test('regresión: repo git anidado (tema WordPress) en proyecto sin git', async () => {
  const site = tmp('wp');
  fs.writeFileSync(path.join(site, 'wp-config.php'), '<?php\n');
  const theme = path.join(site, 'wp-content', 'themes', 'mitema');
  fs.mkdirSync(theme, { recursive: true });
  git(theme, 'init', '-q', '-b', 'main'); // sin commits: antes rompía todas las instantáneas
  fs.writeFileSync(path.join(theme, 'style.css'), 'body{}\n');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: site });
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'MODIFICA:wp-config.php', mode: 'inplace' });
  assert.equal(d.isError, false, d.text);
  assert.match(d.text, /repositorios git dentro del proyecto/);
  assert.match(d.text, /wp-content\/themes\/mitema/);
  assert.match(d.text, /wp-config\.php/);
  s.close();
});

test('regresión: agy sale pero un nieto retiene stdout → el trabajo termina igual', async () => {
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p'), FAKE_AGY_MODE: 'grandchild' });
  await s.call('status', { accept_risk: true, check: false });
  const t0 = Date.now();
  const d = await s.call('delegate', { task: 'hola', role: 'research' });
  assert.match(d.text, /✔ done/);
  assert.ok(Date.now() - t0 < 20000, `tardó ${Date.now() - t0}ms`);
  assert.doesNotMatch(d.text, /%LOCALAPPDATA%\/agy\/bin\/agy\.exe\)/, 'enlaces con % no rompen el informe');
  s.close();
});

test('regresión: trabajo interrumpido (se cierra Claude Code) se recupera al integrar', async () => {
  const proj = tmp('interrupt');
  git(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, 'add', '.');
  git(proj, 'commit', '-q', '-m', 'init');
  const data = tmp('data');
  const s1 = await ready({ CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: proj, FAKE_AGY_MODE: 'hang' });
  await s1.call('status', { accept_risk: true, check: false });
  const d = await s1.call('delegate', { task: 'CREA_ARCHIVO:medio.txt', wait: false });
  assert.match(d.text, /R-1 lanzado/);
  await new Promise((r) => setTimeout(r, 4000));
  s1.close(); // simula cerrar Claude Code a mitad
  await new Promise((r) => setTimeout(r, 1500));
  const s2 = await ready({ CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: proj });
  const w = await s2.call('wait', { job_id: 'R-1', seconds: 5 });
  assert.match(w.text, /interrump/);
  const m = await s2.call('integrate', { job_id: 'R-1', action: 'merge' });
  assert.equal(m.isError, false, m.text);
  assert.match(m.text, /integrado/);
  assert.ok(fs.existsSync(path.join(proj, 'medio.txt')), 'el trabajo a medias se recupera, no se pierde');
  // el siguiente id no reutiliza R-1
  await s2.call('status', { accept_risk: true, check: false });
  const d2 = await s2.call('delegate', { task: 'x', role: 'research' });
  assert.match(d2.text, /R-2/);
  s2.close();
});

// ---------- v0.1.1 ----------

test('los logs de MCP que agy deja en la carpeta real se limpian (y los previos no se tocan)', async () => {
  const proj = tmp('mcplog');
  fs.writeFileSync(path.join(proj, 'otro-mcp.log'), 'del usuario\n');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj, FAKE_AGY_MCPLOG: '1' });
  await s.call('status', { accept_risk: true, check: false });
  const d = await s.call('delegate', { task: 'explora', role: 'explore' });
  assert.equal(d.isError, false, d.text);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!fs.existsSync(path.join(proj, 'wordpress-mcp.log')), 'el log nuevo se borra');
  assert.ok(fs.existsSync(path.join(proj, 'otro-mcp.log')), 'un log que ya existía no se toca');
  s.close();
});

test('la bóveda de Obsidian se configura hablando con Claude (vault configure)', async () => {
  const vaultRoot = path.join(tmp('vault2'), 'Mi Bóveda');
  fs.mkdirSync(path.join(vaultRoot, '.obsidian'), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, 'Wiki'), { recursive: true });
  const data = tmp('data');
  const s = await ready({ CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: tmp('p') });
  const bad = await s.call('vault', { action: 'configure', path: tmp('no-vault') });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /no parece una bóveda/);
  const ok = await s.call('vault', { action: 'configure', path: vaultRoot });
  assert.equal(ok.isError, false, ok.text);
  assert.match(ok.text, /Bóveda guardada/);
  s.close();
  // Persiste para las siguientes sesiones
  const s2 = await ready({ CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: tmp('p') });
  const st = await s2.call('status', { check: false });
  assert.match(st.text, /Obsidian: .*Mi Bóveda/);
  assert.match(st.text, /Límite de seguridad de Relevo: 0\/40/);
  s2.close();
});

test('instalador: añade Relevo a settings.json sin tocar lo demás y con copia de seguridad', () => {
  const cfg = tmp('cfg');
  const original = { theme: 'dark', enabledPlugins: { 'otro@mk': true }, permissions: { allow: ['Bash(ls)'] } };
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(original));
  const out = execFileSync(process.execPath, [path.join(here, '..', 'install.cjs')], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8' });
  assert.match(out, /Relevo activado/);
  const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.deepEqual(s.extraKnownMarketplaces.relevo, { source: { source: 'github', repo: 'Piratapacorro/relevo' } });
  assert.equal(s.enabledPlugins['relevo@relevo'], true);
  assert.equal(s.enabledPlugins['otro@mk'], true);
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.permissions, original.permissions);
  assert.ok(fs.readdirSync(cfg).some((f) => f.startsWith('settings.json.bak-relevo-')), 'hay copia de seguridad');
  // settings.json corrupto: no lo pisa
  const cfg2 = tmp('cfg2');
  fs.writeFileSync(path.join(cfg2, 'settings.json'), '{ esto no es json');
  assert.throws(() => execFileSync(process.execPath, [path.join(here, '..', 'install.cjs')], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg2 }, stdio: 'pipe' }));
  assert.equal(fs.readFileSync(path.join(cfg2, 'settings.json'), 'utf8'), '{ esto no es json');
});

// ---------- v0.1.3 ----------

test('status: las consultas rápidas a agy no se lanzan desde la carpeta del proyecto, y el consentimiento aceptado se dice claro', async () => {
  const proj = tmp('neutral');
  const data = tmp('data');
  const log = path.join(data, 'agy.log');
  const s = await ready({ CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: proj, FAKE_AGY_LOG: log });
  await s.call('status', { accept_risk: true });
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const quick = calls.filter((c) => c.args[0] === 'models' || c.args.includes('--version'));
  assert.ok(quick.length >= 2, 'se consultó versión y modelos');
  for (const c of quick) assert.notEqual(path.resolve(c.cwd).toLowerCase(), path.resolve(proj).toLowerCase(), `${c.args[0]} no debe correr en el proyecto`);
  const st = await s.call('status', { check: false });
  assert.match(st.text, /ya aceptado/);
  assert.doesNotMatch(st.text, /CONSENTIMIENTO PENDIENTE/);
  s.close();
});

// ---------- v0.1.4 ----------

test('Obsidian: cada trabajo integrado o descartado se anota solo en el diario del día', async () => {
  const vaultRoot = path.join(tmp('vault3'), 'Bóveda');
  fs.mkdirSync(path.join(vaultRoot, '.obsidian'), { recursive: true });
  const proj = path.join(tmp('pp'), 'webdemo');
  fs.mkdirSync(proj);
  fs.mkdirSync(path.join(vaultRoot, 'webdemo', 'Wiki'), { recursive: true });
  git(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n');
  git(proj, 'add', '.');
  git(proj, 'commit', '-q', '-m', 'init');
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: proj, RELEVO_VAULT_PATH: vaultRoot });
  await s.call('status', { accept_risk: true, check: false });
  await s.call('delegate', { task: 'CREA_ARCHIVO:uno.txt', title: 'Primer cambio' });
  const m = await s.call('integrate', { job_id: 'R-1', action: 'merge' });
  assert.match(m.text, /Anotado en Obsidian: webdemo\/Wiki\/Relevo - webdemo - \d{4}-\d{2}-\d{2}\.md/);
  await s.call('delegate', { task: 'CREA_ARCHIVO:dos.txt', title: 'Segundo cambio' });
  await s.call('integrate', { job_id: 'R-2', action: 'discard' });
  const wiki = path.join(vaultRoot, 'webdemo', 'Wiki');
  const notes = fs.readdirSync(wiki).filter((f) => f.startsWith('Relevo - webdemo'));
  assert.equal(notes.length, 1, 'una sola nota por día');
  const text = fs.readFileSync(path.join(wiki, notes[0]), 'utf8');
  assert.match(text, /^---\nfecha:/);
  assert.match(text, /R-1 · implementar · integrado/);
  assert.match(text, /Primer cambio/);
  assert.match(text, /uno\.txt/);
  assert.match(text, /R-2 · implementar · descartado/);
  s.close();
});

test('opciones del plugin leídas de un settings.json con BOM (Bloc de notas / PowerShell 5.1)', async () => {
  const cfg = tmp('cfgbom');
  const vaultRoot = tmp('vbom');
  fs.mkdirSync(path.join(vaultRoot, '.obsidian'));
  const settings = { pluginConfigs: { 'relevo@relevo': { options: { vault_path: vaultRoot, max_runs: 7 } } } };
  fs.writeFileSync(path.join(cfg, 'settings.json'), '﻿' + JSON.stringify(settings));
  const s = await ready({ CLAUDE_PLUGIN_DATA: tmp('data'), CLAUDE_PROJECT_DIR: tmp('p'), CLAUDE_CONFIG_DIR: cfg });
  const st = await s.call('status', { check: false });
  assert.match(st.text, /0\/7 llamadas/);
  assert.ok(st.text.includes(`Obsidian: ${vaultRoot}`), 'usa la bóveda configurada en settings.json');
  s.close();
});
