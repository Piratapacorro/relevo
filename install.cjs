#!/usr/bin/env node
// Instalador de Relevo para Claude Code (terminal y app de escritorio).
//
// Uso:
//   Windows (PowerShell):  irm https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.cjs | node
//   macOS / Linux:         curl -fsSL https://raw.githubusercontent.com/Piratapacorro/relevo/main/install.cjs | node
//
// Qué hace: añade el marketplace de Relevo y activa el plugin en tu configuración de
// Claude Code (~/.claude/settings.json). Claude Code lo descarga solo al abrir la
// siguiente sesión. No toca nada más, hace copia de seguridad y no maneja credenciales.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'Piratapacorro/relevo';
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) fail(`Relevo necesita Node.js 18 o superior (tienes ${process.versions.node}). Instálalo desde https://nodejs.org`);

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const file = path.join(configDir, 'settings.json');
fs.mkdirSync(configDir, { recursive: true });

let settings = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    settings = raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    fail(`No puedo leer ${file} (no es JSON válido: ${e.message}). Arréglalo o instala Relevo desde Claude Code con /plugin.`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, `${file}.bak-relevo-${stamp}`);
}

settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
settings.extraKnownMarketplaces.relevo = { source: { source: 'github', repo: REPO } };
settings.enabledPlugins = settings.enabledPlugins || {};
settings.enabledPlugins['relevo@relevo'] = true;

const tmp = `${file}.relevo-tmp`;
fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, file);

console.log(`\n${green('✔')} Relevo activado en Claude Code (${file}).`);

// ¿Está la Antigravity CLI (agy)?
const isWin = process.platform === 'win32';
const candidates = isWin
  ? [path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe')]
  : [path.join(os.homedir(), '.local', 'bin', 'agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy'];
let agy = candidates.find((p) => p && fs.existsSync(p));
if (!agy) {
  try {
    agy = execFileSync(isWin ? 'where' : 'which', ['agy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null;
  } catch {
    agy = null;
  }
}

console.log(`\n${bold('Siguientes pasos')}`);
let n = 1;
if (!agy) {
  console.log(`${n++}. ${yellow('Instala la Antigravity CLI (Gemini):')}`);
  console.log(isWin ? '     irm https://antigravity.google/cli/install.ps1 | iex' : '     curl -fsSL https://antigravity.google/cli/install.sh | bash');
  console.log(`${n++}. Abre una terminal NUEVA, escribe ${bold('agy')} e inicia sesión con tu cuenta de Google (AI Pro/Ultra).`);
  console.log('     Si ya usas la app de Antigravity con esa cuenta, puede que ya tengas la sesión iniciada.');
} else {
  console.log(`${n++}. Antigravity CLI encontrada (${agy}). Si nunca la has usado, ejecuta ${bold('agy')} una vez e inicia sesión con tu cuenta de Google.`);
}
console.log(`${n++}. Cierra y vuelve a abrir Claude Code (o la app de Claude) para que descargue Relevo.`);
console.log(`${n++}. Abre tu proyecto y escribe ${bold('/relevo:iniciar')}.`);
console.log('');
