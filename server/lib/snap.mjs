// Instantáneas, copias aisladas (git worktree) y diffs.
//
// - Proyecto con git: usamos su propio repositorio, pero con un índice temporal
//   propio, así nunca tocamos el índice ni las ramas del usuario al fotografiar.
// - Proyecto sin git: creamos un repositorio "sombra" fuera del proyecto
//   (en los datos del plugin). El proyecto del usuario no recibe ninguna carpeta .git.
//
// Así cualquier trabajo de Gemini se puede revisar como diff y deshacer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './proc.mjs';
import { ensureDir, shortHash, KeyedMutex } from './util.mjs';

const mutex = new KeyedMutex();

// El tablero .relevo/ (a cualquier profundidad) es terreno de Relevo y nunca entra en
// instantáneas ni diffs. Los logs de servidores MCP (p. ej. wordpress-mcp.log) los escriben
// herramientas de agy en la carpeta de trabajo: son ruido, no trabajo de Gemini.
const NOISE = [':(exclude,glob)**/.relevo/**', ':(exclude,glob)**/*mcp*.log'];
const SNAP_PATHSPEC = ['.', ...NOISE];

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Relevo',
  GIT_AUTHOR_EMAIL: 'relevo@localhost',
  GIT_COMMITTER_NAME: 'Relevo',
  GIT_COMMITTER_EMAIL: 'relevo@localhost',
  GIT_TERMINAL_PROMPT: '0',
};

// Exclusiones por defecto para el repositorio sombra (proyectos sin git).
const SHADOW_EXCLUDES = [
  'node_modules', 'vendor', '.venv', 'venv', '__pycache__/', 'dist/', 'build/', '.next/', '.nuxt/',
  '.cache/', 'coverage/', '.relevo/', 'wp-content/uploads/', 'uploads/', '*.zip', '*.rar', '*.7z',
  '*.mp4', '*.mov', '*.avi', '*.mkv', '*.psd', '*.ai', '*.sql', '*.sqlite', '*.db', '*.log', '*.iso',
  '.DS_Store', 'Thumbs.db', 'desktop.ini', 'NTUSER.DAT*', 'ntuser.dat*',
];

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const isSha = (s) => typeof s === 'string' && SHA_RE.test(s);

// Opciones que neutralizan lo que un repositorio podría configurar para ejecutar código
// (hooks, fsmonitor) o para bloquear la automatización (firma GPG, editores).
function safetyFlags(hooksDir) {
  return [
    '-c', 'core.quotepath=false',
    '-c', 'core.longpaths=true',
    '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${hooksDir}`,
    '-c', 'commit.gpgsign=false',
    '-c', 'tag.gpgsign=false',
    '-c', 'core.editor=true',
  ];
}

export async function detectGitRoot(dir) {
  const r = await run('git', ['rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 15000 });
  if (r.code !== 0) return null;
  return path.resolve(r.stdout.trim());
}

function isDangerousRoot(dir) {
  const p = path.resolve(dir);
  return p === path.resolve(os.homedir()) || p === path.parse(p).root;
}

export class Repo {
  /**
   * @param {string} projectDir carpeta del proyecto (la de Claude Code)
   * @param {string} dataDir carpeta persistente del plugin
   */
  static async open(projectDir, dataDir) {
    const repo = new Repo();
    repo.projectDir = path.resolve(projectDir);
    repo.gitRoot = await detectGitRoot(repo.projectDir);
    repo.isGit = !!repo.gitRoot;
    repo.root = repo.gitRoot || repo.projectDir;
    if (!repo.isGit && isDangerousRoot(repo.projectDir)) {
      throw new Error('Claude Code está abierto en tu carpeta personal o en la raíz del disco. Abre la carpeta de un proyecto concreto para trabajar con Relevo.');
    }
    // Todo el estado se separa por carpeta de proyecto (no por repositorio): dos sesiones en
    // subcarpetas distintas de un mismo monorepo no comparten ids, ramas ni copias.
    repo.ns = shortHash(repo.projectDir.toLowerCase(), 8);
    repo.slug = `${path.basename(repo.projectDir).replace(/[^\w.-]+/g, '_').slice(0, 40)}-${repo.ns}`;
    repo.stateDir = ensureDir(path.join(dataDir, 'repos', repo.slug));
    repo.jobsDir = ensureDir(path.join(repo.stateDir, 'jobs'));
    repo.indexFile = path.join(repo.stateDir, 'snapshot.index');
    repo.shadowDir = path.join(repo.stateDir, 'shadow.git');
    repo.hooksDir = ensureDir(path.join(dataDir, 'empty-hooks'));
    repo.worktreesDir = path.join(dataDir, 'worktrees', repo.slug);
    // Subcarpeta del proyecto dentro del repo (si Claude trabaja en un subdirectorio).
    repo.subdir = path.relative(repo.root, repo.projectDir);
    repo.embedded = new Set(); // repositorios git anidados (no se pueden fotografiar)
    repo.warnings = new Set();
    if (!repo.isGit) await repo.initShadow();
    return repo;
  }

  branchName(id) {
    return `relevo/${this.ns}/${id}`;
  }

  refName(id, kind) {
    return `refs/relevo/${this.ns}/${id}/${kind}`;
  }

  worktreePath(id) {
    return path.join(this.worktreesDir, id);
  }

  gitPrefix(noWorkTree = false) {
    if (this.isGit) return [];
    return noWorkTree ? ['--git-dir', this.shadowDir] : ['--git-dir', this.shadowDir, '--work-tree', this.root];
  }

  git(args, opts = {}) {
    const env = { ...process.env, ...IDENTITY, ...(opts.env || {}) };
    return run('git', [...safetyFlags(this.hooksDir), ...this.gitPrefix(opts.noWorkTree), ...args], {
      cwd: opts.cwd || this.root,
      env,
      input: opts.input,
      timeoutMs: opts.timeoutMs ?? 300000,
      binary: opts.binary,
    });
  }

  async gitOk(args, opts) {
    const r = await this.git(args, opts);
    if (r.code !== 0) throw new Error(`git ${args.slice(0, 3).join(' ')} falló: ${(r.stderr || r.stdout || '').toString().trim().slice(0, 500)}`);
    return typeof r.stdout === 'string' ? r.stdout.trim() : r.stdout;
  }

  async initShadow() {
    if (fs.existsSync(path.join(this.shadowDir, 'HEAD'))) return;
    ensureDir(this.shadowDir);
    const r = await run('git', ['init', '--bare', '-q', this.shadowDir], { timeoutMs: 30000 });
    if (r.code !== 0) throw new Error(`No se pudo crear el repositorio sombra: ${r.stderr}`);
    for (const [k, v] of [['core.autocrlf', 'false'], ['core.longpaths', 'true'], ['core.quotepath', 'false']]) {
      await run('git', ['--git-dir', this.shadowDir, 'config', k, v], { timeoutMs: 10000 });
    }
    ensureDir(path.join(this.shadowDir, 'info'));
    fs.writeFileSync(path.join(this.shadowDir, 'info', 'exclude'), SHADOW_EXCLUDES.join('\n') + '\n', 'utf8');
  }

  async headCommit() {
    const r = await this.git(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { timeoutMs: 15000 });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  pathspec() {
    return [...SNAP_PATHSPEC, ...[...this.embedded].map((p) => `:(exclude,top,literal)${p}`)];
  }

  /**
   * `git add -A` robusto: aprende los repositorios anidados (el caso típico es un tema de
   * WordPress con su propio .git dentro de un sitio sin git) y no aborta por un archivo
   * bloqueado por Windows; lo avisa.
   */
  async addAll(env) {
    let r;
    for (let i = 0; i < 6; i++) {
      r = await this.git(['add', '-A', '--ignore-errors', '--', ...this.pathspec()], { env, timeoutMs: 900000 });
      if (r.code === 0) break;
      const nested = [...r.stderr.matchAll(/'([^']+)' does not have a commit checked out/g)].map((m) => m[1].replace(/[\\/]+$/, ''));
      if (!nested.length) break;
      nested.forEach((p) => this.embedded.add(p));
    }
    if (r.code !== 0) {
      if (/unable to index|Permission denied|could not open|failed to insert|short read/i.test(r.stderr)) {
        this.warnings.add(`Algunos archivos no se pudieron leer (bloqueados o sin permiso) y quedan fuera de las instantáneas: ${r.stderr.trim().split('\n')[0].slice(0, 200)}`);
      } else {
        throw new Error(`git add falló: ${r.stderr.trim().slice(0, 500)}`);
      }
    }
    // Repositorios anidados con commits: git los guarda como "gitlink" (carpeta vacía).
    const ls = await this.git(['ls-files', '-s'], { env, timeoutMs: 120000 });
    const declared = new Set(
      [...(fs.existsSync(path.join(this.root, '.gitmodules')) ? fs.readFileSync(path.join(this.root, '.gitmodules'), 'utf8') : '').matchAll(/^\s*path\s*=\s*(.+)$/gm)].map((m) => m[1].trim()),
    );
    const links = [];
    for (const line of ls.stdout.split('\n')) {
      const m = /^160000 [0-9a-f]+ \d\t(.+)$/.exec(line);
      if (m && !declared.has(m[1])) links.push(m[1]);
    }
    if (links.length) {
      links.forEach((p) => this.embedded.add(p));
      await this.git(['rm', '--cached', '-q', '-r', '--ignore-unmatch', '--', ...links], { env });
    }
    if (this.embedded.size) {
      this.warnings.add(
        `Hay repositorios git dentro del proyecto (${[...this.embedded].slice(0, 5).join(', ')}): Gemini NO ve su contenido en la copia aislada y sus cambios no se pueden deshacer. ` +
          'Para trabajar en ellos, abre Claude Code directamente en esa carpeta.',
      );
    }
  }

  /** Fotografía el estado actual (incluye cambios sin confirmar y archivos nuevos no ignorados). */
  snapshot(label) {
    return mutex.run(this.root, async () => {
      const env = { GIT_INDEX_FILE: this.indexFile };
      const head = await this.headCommit();
      if (!fs.existsSync(this.indexFile) && head) await this.gitOk(['read-tree', head], { env });
      await this.addAll(env);
      const tree = await this.gitOk(['write-tree'], { env });
      const parent = head || (await this.lastRef('refs/relevo/last'));
      const commit = await this.gitOk(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `relevo: ${label}`]);
      await this.gitOk(['update-ref', 'refs/relevo/last', commit]);
      return commit;
    });
  }

  async lastRef(ref) {
    const r = await this.git(['rev-parse', '--verify', '-q', ref], { timeoutMs: 15000 });
    return r.code === 0 && isSha(r.stdout.trim()) ? r.stdout.trim() : null;
  }

  async keep(id, kind, sha) {
    if (isSha(sha)) await this.gitOk(['update-ref', this.refName(id, kind), sha]);
  }

  async dropRefs(id) {
    for (const k of ['base', 'tip']) await this.git(['update-ref', '-d', this.refName(id, k)]);
  }

  async createWorktree(id, base) {
    if (!isSha(base)) throw new Error('Base inválida para la copia aislada.');
    return mutex.run(this.root, async () => {
      ensureDir(this.worktreesDir);
      const wt = this.worktreePath(id);
      const branch = this.branchName(id);
      const W = { noWorkTree: true };
      if (fs.existsSync(wt)) await this.destroyWorktreeDir(wt, []);
      await this.git(['worktree', 'prune'], W);
      await this.git(['branch', '-D', branch], W);
      await this.gitOk(['worktree', 'add', '-q', '-b', branch, wt, base], { ...W, timeoutMs: 900000 });
      // Directorio de administración real de esta copia: lo guardamos ahora (momento de confianza)
      // para no redescubrirlo luego desde un archivo .git que Gemini podría reescribir.
      const gd = await run('git', ['rev-parse', '--absolute-git-dir'], { cwd: wt, timeoutMs: 15000 });
      const gitDir = gd.stdout.trim();
      const linked = this.linkHeavyDirs(wt);
      return { path: wt, branch, gitDir, cwd: this.subdir ? path.join(wt, this.subdir) : wt, linked };
    });
  }

  /**
   * La copia aislada no trae lo que git ignora (node_modules, vendor, .env…):
   * enlazamos las dependencias desde el proyecto real para que Gemini pueda
   * ejecutar tests y builds, y copiamos los .env (son pequeños).
   */
  linkHeavyDirs(wt) {
    const linked = [];
    const base = this.subdir ? path.join(this.root, this.subdir) : this.root;
    const dest = this.subdir ? path.join(wt, this.subdir) : wt;
    const rel = (p) => path.relative(wt, p).split(path.sep).join('/');
    for (const name of ['node_modules', 'vendor', '.venv', 'venv']) {
      const src = path.join(base, name);
      const dst = path.join(dest, name);
      try {
        if (fs.statSync(src).isDirectory() && !fs.existsSync(dst)) {
          fs.symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
          linked.push({ rel: rel(dst), kind: 'link' });
        }
      } catch {}
    }
    try {
      for (const f of fs.readdirSync(base)) {
        if (/^\.env(\..+)?$/.test(f) && fs.statSync(path.join(base, f)).isFile() && !fs.existsSync(path.join(dest, f))) {
          fs.copyFileSync(path.join(base, f), path.join(dest, f));
          linked.push({ rel: rel(path.join(dest, f)), kind: 'copy' });
        }
      }
    } catch {}
    return linked;
  }

  /** Confirma lo que haya hecho Gemini dentro de su copia y devuelve el commit final. */
  async commitWorktree(wt) {
    // --git-dir explícito: no nos fiamos del archivo .git de la copia (Gemini puede escribirlo).
    const prefix = [...safetyFlags(this.hooksDir), '--git-dir', wt.gitDir, '--work-tree', wt.path];
    const g = (args, o = {}) => run('git', [...prefix, ...args], { cwd: wt.path, env: { ...process.env, ...IDENTITY }, timeoutMs: 600000, ...o });
    const excludes = (wt.linked || []).map((l) => `:(exclude,top,literal)${l.rel || l}`);
    const add = await g(['add', '-A', '--ignore-errors', '--', ...SNAP_PATHSPEC, ...excludes]);
    // "paths are ignored" es solo un aviso: nombramos (para excluirlos) enlaces que git ya ignora.
    if (add.code !== 0 && !/unable to index|Permission denied|paths are ignored by one of your \.gitignore/i.test(add.stderr)) {
      throw new Error(`No se pudo recoger el trabajo de la copia aislada: ${add.stderr.trim().slice(0, 300)}`);
    }
    // Solo confirmamos si hay algo preparado (en macOS/Linux el enlace de node_modules
    // aparece como "sin seguimiento" y haría fallar un commit vacío).
    const staged = await g(['diff', '--cached', '--quiet']);
    if (staged.code === 1) {
      const c = await g(['commit', '-q', '--no-verify', '--no-gpg-sign', '-m', 'relevo: trabajo de Gemini']);
      if (c.code !== 0) throw new Error(`No se pudo confirmar el trabajo de la copia aislada: ${c.stderr.trim().slice(0, 300)}`);
    }
    const h = await g(['rev-parse', 'HEAD']);
    const tip = h.stdout.trim();
    if (!isSha(tip)) throw new Error('No se pudo leer el commit de la copia aislada.');
    return tip;
  }

  /**
   * Borra una copia aislada SIN seguir enlaces: primero quita los enlaces a node_modules/vendor
   * (en Windows git sigue las junctions y vaciaría las dependencias reales), después borra.
   */
  async destroyWorktreeDir(wt, linked) {
    for (const l of linked || []) {
      const p = path.join(wt, l.rel || l);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink() || isJunction(p)) fs.unlinkSync(p);
      } catch {}
    }
    unlinkAllLinks(wt);
    if (hasLinks(wt)) throw new Error(`Quedan enlaces dentro de ${wt}; no borro la copia para no tocar tus dependencias reales.`);
    fs.rmSync(wt, { recursive: true, force: true });
  }

  async removeWorktree(wt) {
    if (!wt?.path) return;
    return mutex.run(this.root, async () => {
      const W = { noWorkTree: true };
      if (fs.existsSync(wt.path)) await this.destroyWorktreeDir(wt.path, wt.linked);
      await this.git(['worktree', 'prune'], W);
      if (wt.branch) await this.git(['branch', '-D', wt.branch], W);
    });
  }

  async diffStat(a, b) {
    if (!isSha(a) || !isSha(b) || a === b) return { files: [], shortstat: 'sin cambios' };
    const ns = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', a, b, '--']);
    const st = await this.git(['diff', '--no-ext-diff', '--no-renames', '--name-status', a, b, '--']);
    const status = new Map();
    for (const line of st.stdout.split('\n')) {
      const m = /^([AMDTUX])\t(.+)$/.exec(line.trim());
      if (m) status.set(m[2], m[1]);
    }
    const files = [];
    for (const line of ns.stdout.split('\n')) {
      const m = /^(\S+)\t(\S+)\t(.+)$/.exec(line);
      if (!m) continue;
      files.push({ path: m[3], status: status.get(m[3]) || 'M', added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]) });
    }
    const ss = await this.git(['diff', '--no-ext-diff', '--shortstat', a, b, '--']);
    return { files, shortstat: ss.stdout.trim() || 'sin cambios' };
  }

  async diffText(a, b, paths = []) {
    if (!isSha(a) || !isSha(b) || a === b) return '';
    const specs = paths.length ? paths.map((p) => `:(top,literal)${String(p).replace(/\\/g, '/').replace(/^\.?\//, '')}`) : ['.'];
    const r = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', a, b, '--', ...specs]);
    return r.stdout;
  }

  /** Aplica el trabajo de la copia aislada (base→tip) sobre la carpeta real del proyecto. */
  async applyToMain(base, tip) {
    if (!isSha(base) || !isSha(tip)) return { ok: false, method: 'sin datos', conflicts: [], message: 'Faltan las instantáneas del trabajo.' };
    if (base === tip) return { ok: true, method: 'nada que aplicar', conflicts: [] };
    return mutex.run(this.root, async () => {
      const patch = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', '--full-index', base, tip, '--'], { binary: true });
      if (patch.code !== 0) return { ok: false, method: 'diff', conflicts: [], message: patch.stderr.toString() };
      if (!patch.stdout.length) return { ok: true, method: 'nada que aplicar', conflicts: [] };
      const check = await this.git(['apply', '--check', '--whitespace=nowarn', '-'], { input: patch.stdout });
      if (check.code === 0) {
        const a = await this.git(['apply', '--whitespace=nowarn', '-'], { input: patch.stdout });
        if (a.code === 0) return { ok: true, method: 'aplicado limpio', conflicts: [] };
      }
      // Fusión a tres bandas con nuestro índice temporal (el índice del usuario no se toca).
      const env = { GIT_INDEX_FILE: this.indexFile };
      await this.addAll(env);
      const three = await this.git(['apply', '--3way', '--whitespace=nowarn', '-'], { input: patch.stdout, env });
      const out = `${three.stdout}\n${three.stderr}`;
      const conflicts = [
        ...[...out.matchAll(/Applied patch to '([^']+)' with conflicts/g)].map((m) => m[1]),
        ...[...out.matchAll(/^U (.+)$/gm)].map((m) => m[1].trim()),
      ].filter((v, i, a) => a.indexOf(v) === i);
      if (three.code === 0) return { ok: true, method: 'fusión a tres bandas', conflicts: [] };
      return { ok: conflicts.length > 0, partial: conflicts.length > 0, method: 'fusión con conflictos', conflicts, message: out.trim().slice(0, 1500) };
    });
  }

  /**
   * Deshace en la carpeta real lo que cambió entre base y tip, archivo a archivo,
   * sin pisar archivos que hayan vuelto a cambiar después (los informa).
   */
  async restore(base, tip) {
    if (!isSha(base) || !isSha(tip)) return { restored: [], skipped: [], error: 'Faltan las instantáneas del trabajo.' };
    return mutex.run(this.root, async () => {
      const st = await this.git(['diff', '--no-ext-diff', '--no-renames', '--name-status', base, tip, '--']);
      const restored = [];
      const skipped = [];
      for (const line of st.stdout.split('\n')) {
        const m = /^([AMDT])\t(.+)$/.exec(line.trim());
        if (!m) continue;
        const [, kind, rel] = m;
        const abs = path.resolve(this.root, rel);
        if (path.relative(this.root, abs).startsWith('..')) continue;
        const expectTip = kind === 'D' ? null : await this.blobId(`${tip}:${rel}`);
        const current = fs.existsSync(abs) ? await this.hashFile(abs) : null;
        if (current !== expectTip) {
          skipped.push(rel);
          continue;
        }
        if (kind === 'A') {
          fs.rmSync(abs, { force: true });
        } else {
          // --filters aplica fin de línea (CRLF) y filtros como LFS, igual que un checkout.
          const blob = await this.git(['cat-file', '--filters', `${base}:${rel}`], { binary: true });
          if (blob.code !== 0) {
            skipped.push(rel);
            continue;
          }
          ensureDir(path.dirname(abs));
          fs.writeFileSync(abs, blob.stdout);
        }
        restored.push(rel);
      }
      return { restored, skipped };
    });
  }

  async blobId(spec) {
    const r = await this.git(['rev-parse', '--verify', '-q', spec]);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async hashFile(abs) {
    const r = await this.git(['hash-object', '--', abs]);
    return r.code === 0 ? r.stdout.trim() : null;
  }
}

function isJunction(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return true;
    return st.isDirectory() && fs.realpathSync.native(p).toLowerCase() !== path.resolve(p).toLowerCase() && fs.readlinkSync(p) !== undefined;
  } catch {
    return false;
  }
}

// Recorre TODA la copia (sin límite de profundidad) quitando enlaces, sin entrar nunca en ellos.
function unlinkAllLinks(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink() || (e.isDirectory() && isJunction(p))) {
      try { fs.unlinkSync(p); } catch { try { fs.rmdirSync(p); } catch {} }
    } else if (e.isDirectory() && e.name !== '.git') {
      unlinkAllLinks(p);
    }
  }
}

function hasLinks(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink() || (e.isDirectory() && isJunction(p))) return true;
    if (e.isDirectory() && e.name !== '.git' && hasLinks(p)) return true;
  }
  return false;
}
