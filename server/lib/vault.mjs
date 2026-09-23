// Integración con una bóveda de Obsidian leyendo/escribiendo Markdown directamente.
// Funciona con Obsidian cerrado y sin plugins: Obsidian detecta los cambios solo.
import fs from 'node:fs';
import path from 'node:path';
import { isInside, safeFileName, today, ensureDir } from './util.mjs';

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.relevo']);

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Localiza la carpeta del proyecto dentro de la bóveda:
 * 1) la indicada en .relevo/config.json (vaultFolder), 2) una carpeta de primer nivel
 * cuyo nombre coincida con el del proyecto, 3) la raíz de la bóveda.
 */
export function resolveVaultDir(vaultPath, projectName, override) {
  if (!vaultPath) return null;
  const root = path.resolve(vaultPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { root, dir: null, error: `No existe la bóveda: ${root}` };
  if (override) {
    const dir = path.resolve(root, override);
    if (isInside(root, dir) && fs.existsSync(dir)) return { root, dir, how: 'configurada en .relevo/config.json' };
  }
  const p = norm(projectName);
  let best = null;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const n = norm(e.name);
    if (n.length < 4) continue;
    if (n === p) return { root, dir: path.join(root, e.name), how: 'misma carpeta que el proyecto' };
    if ((p.startsWith(n) || n.startsWith(p)) && (!best || n.length > norm(best).length)) best = e.name;
  }
  if (best) return { root, dir: path.join(root, best), how: 'nombre parecido al del proyecto' };
  return { root, dir: root, how: 'raíz de la bóveda' };
}

function* walkMd(dir, depth = 0, maxDepth = 6) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && depth < maxDepth) yield* walkMd(path.join(dir, e.name), depth + 1, maxDepth);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      yield path.join(dir, e.name);
    }
  }
}

function firstLine(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').slice(0, 2000).replace(/^---[\s\S]*?\n---\s*\n/, '');
    const line = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('---'));
    return (line || '').replace(/^#+\s*/, '').slice(0, 110);
  } catch {
    return '';
  }
}

export function brief(v, maxNotes = 40) {
  if (!v?.dir) return v?.error || 'Bóveda de Obsidian no configurada.';
  const notes = [];
  for (const f of walkMd(v.dir)) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    notes.push({ f, m: st.mtimeMs });
    if (notes.length > 5000) break;
  }
  notes.sort((a, b) => b.m - a.m);
  const rel = (f) => path.relative(v.dir, f).split(path.sep).join('/');
  const lines = [`Obsidian: ${v.dir} (${v.how}) · ${notes.length} notas`];
  for (const n of notes.slice(0, maxNotes)) {
    lines.push(`- ${rel(n.f)} (${new Date(n.m).toISOString().slice(0, 10)}) — ${firstLine(n.f)}`);
  }
  if (notes.length > maxNotes) lines.push(`… ${notes.length - maxNotes} notas más (usa search).`);
  return lines.join('\n');
}

export function search(v, query, maxHits = 20) {
  if (!v?.dir) return v?.error || 'Bóveda de Obsidian no configurada.';
  const q = String(query || '').trim();
  if (!q) return 'Indica qué buscar.';
  const needle = norm(q);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  let scanned = 0;
  for (const f of walkMd(v.dir)) {
    if (++scanned > 5000 || hits.length >= maxHits) break;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const rel = path.relative(v.dir, f).split(path.sep).join('/');
    if (norm(path.basename(f, '.md')).includes(needle)) hits.push(`${rel} (título)`);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      const l = lines[i].toLowerCase();
      if (words.every((w) => l.includes(w))) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
    }
  }
  return hits.length ? hits.join('\n') : `Sin resultados para "${q}".`;
}

export function save(v, { title, content, kind = 'wiki', tags = [], projectName }) {
  if (!v?.dir) throw new Error(v?.error || 'Bóveda de Obsidian no configurada (userConfig vault_path).');
  const wanted = { wiki: 'Wiki', output: 'Output', raw: 'Raw' }[kind] || 'Wiki';
  let folder = null;
  try {
    const found = fs.readdirSync(v.dir, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.toLowerCase() === wanted.toLowerCase());
    folder = path.join(v.dir, found ? found.name : wanted);
  } catch {
    folder = path.join(v.dir, wanted);
  }
  ensureDir(folder);
  const name = safeFileName(title);
  const file = path.join(folder, `${name}.md`);
  if (!isInside(v.root, file)) throw new Error('Ruta de nota fuera de la bóveda.');
  const body = String(content || '').trim();
  if (fs.existsSync(file)) {
    fs.appendFileSync(file, `\n\n## Actualización ${today()}\n\n${body}\n`, 'utf8');
  } else {
    const tagList = ['relevo', ...tags.map((t) => String(t).replace(/[^\w\-/áéíóúñü]/gi, ''))].filter(Boolean);
    const fm = ['---', `fecha: ${today()}`, 'origen: relevo', `proyecto: "${String(projectName || '').replace(/"/g, "'")}"`, `tags: [${[...new Set(tagList)].join(', ')}]`, '---', ''];
    fs.writeFileSync(file, `${fm.join('\n')}\n# ${name}\n\n${body}\n`, 'utf8');
  }
  return path.relative(v.root, file).split(path.sep).join('/');
}
