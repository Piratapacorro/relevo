#!/usr/bin/env node
// Prueba manual contra el agy REAL (gasta un poco de cuota de Gemini).
// Uso: node test/live.mjs <carpeta-proyecto-de-prueba> [datos-plugin]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [project, data] = process.argv.slice(2);
if (!project) {
  console.error('Uso: node test/live.mjs <proyecto> [datos]');
  process.exit(1);
}
const child = spawn(process.execPath, [path.join(here, '..', 'server', 'index.mjs')], {
  env: { ...process.env, CLAUDE_PROJECT_DIR: path.resolve(project), CLAUDE_PLUGIN_DATA: data || path.join(path.resolve(project), '..', 'relevo-data'), RELEVO_TIMEOUT_MIN: '8' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '';
let id = 0;
const waiting = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.method === 'notifications/progress') console.log(`   · progreso: ${msg.params.message}`);
    if (msg.id !== undefined && waiting.has(msg.id)) waiting.get(msg.id)(msg), waiting.delete(msg.id);
  }
});
const req = (method, params) => new Promise((r) => { const n = ++id; waiting.set(n, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const call = async (name, args) => {
  const t0 = Date.now();
  const r = await req('tools/call', { name, arguments: args, _meta: { progressToken: `p${id}` } });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 140)} (${((Date.now() - t0) / 1000).toFixed(1)}s)${r.result?.isError ? ' [ERROR]' : ''}\n${text}`);
  return text;
};

await req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live', version: '1' } });
const steps = (process.env.LIVE_STEPS || 'status,explore,implement,inspect,merge').split(',');
if (steps.includes('status')) await call('status', { accept_risk: true });
if (steps.includes('explore')) await call('delegate', { role: 'explore', task: 'Describe en 5 líneas qué hace este proyecto y cómo se ejecutan sus tests.', model: 'flash' });
let implId = 'R-2';
if (steps.includes('implement')) {
  const out = await call('delegate', {
    role: 'implement',
    title: 'Función resta',
    task: 'Añade en calc.js una función exportada resta(a, b) que devuelva a - b, y añade un test en calc.test.js al estilo de los existentes. Ejecuta los tests con `node --test`.',
    model: 'flash',
  });
  implId = /(R-\d+)/.exec(out)?.[1] || implId;
}
if (steps.includes('inspect')) await call('inspect', { job_id: implId, what: 'diff', max_lines: 60 });
if (steps.includes('merge')) await call('integrate', { job_id: implId, action: 'merge' });
child.stdin.end();
