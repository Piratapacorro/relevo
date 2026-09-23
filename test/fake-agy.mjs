#!/usr/bin/env node
// agy simulado para los tests: imita el protocolo stream-json de la CLI real.
// FAKE_AGY_MODE: ok (defecto) | auth | quota | hang | nostdout
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const mode = process.env.FAKE_AGY_MODE || 'ok';
if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n');

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (args.includes('--version')) {
  console.log('agy 1.2.8');
  process.exit(0);
}
if (args[0] === 'models') {
  // Igual que agy 1.2.8: salida de texto "slug<TAB>Nombre", sin --output-format.
  if (args.includes('--output-format')) {
    console.log('Error: flags provided but not defined: -output-format');
    process.exit(0);
  }
  if (mode === 'auth') {
    process.stderr.write('error: authentication required. Run `agy` to sign in.\n');
    process.exit(1);
  }
  console.log('Fetching available models...');
  console.log('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)');
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const first = input.split('\n').find(Boolean);
  const prompt = first ? JSON.parse(first).message.content : '';
  const conv = args.includes('--conversation') ? args[args.indexOf('--conversation') + 1] : 'conv-' + Math.abs(hash(prompt)).toString(36);
  if (mode === 'auth') {
    process.stderr.write('error: authentication required. Run `agy` to sign in.\n');
    process.exit(1);
  }
  out({ event: 'init', conversation_id: conv, init: { cwd: process.cwd(), tools: [], permission_mode: 'default' } });
  if (mode === 'quota') {
    out({ step_update: { conversation_id: conv, step_index: 0, state: 'DONE', step_type: 'error_message', text_delta: 'API error (attempt 1): RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h39m52s.' } });
    setInterval(() => {}, 1000); // se queda reintentando como el agy real
    return;
  }
  if (mode === 'hang') {
    // Escribe algo y se queda colgado (para probar trabajos interrumpidos).
    for (const m of prompt.matchAll(/CREA_ARCHIVO:(\S+)/g)) fs.writeFileSync(path.join(process.cwd(), m[1]), 'a medias\n');
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'grandchild') {
    // Un "nieto" hereda stdout y sigue vivo cuando agy ya ha salido.
    spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit', detached: true }).unref();
  }
  const changed = [];
  for (const m of prompt.matchAll(/CREA_ARCHIVO:(\S+)/g)) {
    fs.mkdirSync(path.dirname(path.join(process.cwd(), m[1])), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), m[1]), 'hola desde gemini\n');
    changed.push(m[1]);
  }
  for (const m of prompt.matchAll(/MODIFICA:(\S+)/g)) {
    fs.appendFileSync(path.join(process.cwd(), m[1]), 'línea añadida por gemini\n');
    changed.push(m[1]);
  }
  out({ step_update: { conversation_id: conv, step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'edit_file' } });
  if (mode === 'nostdout') process.exit(0);
  const response = `He trabajado en la tarea. Ver [agy](file:///%LOCALAPPDATA%/agy/bin/agy.exe).\n\n### RELEVO-REPORT\nstatus: done\nsummary: Tarea simulada completada.\nchanged: ${changed.join(', ') || 'none'}\nverification: not run\nrisks: none\nquestions: none`;
  out({ event: 'result', result: { conversation_id: conv, status: 'SUCCESS', response, duration_seconds: 1, num_turns: 1, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } });
  process.exit(0);
});

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}
