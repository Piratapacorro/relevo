// Lógica del equipo: delegar en Gemini, esperar, inspeccionar, integrar.
// Todo lo que devuelve está pensado para gastar el mínimo de tokens de Claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAgy, agyVersion, versionAtLeast, listModels, pickFlash, runAgy } from './agy.mjs';
import { Repo, isSha } from './snap.mjs';
import { Board } from './board.mjs';
import { ROLES, buildPrompt, extractReport } from './prompts.mjs';
import * as vault from './vault.mjs';
import { readJson, writeJson, writeText, readText, ensureDir, nowIso, formatDuration, truncateMiddle, limitLines, isInside, KeyedMutex } from './util.mjs';

const MIN_AGY = '1.2.6';
const MODES = ['worktree', 'inplace', 'readonly'];
const ID_RE = /^R-\d{1,6}$/;
const DEBUG = !!process.env.RELEVO_DEBUG;
const T0 = Date.now();
const dbg = (...a) => DEBUG && process.stderr.write(`[relevo +${((Date.now() - T0) / 1000).toFixed(1)}s] ${a.join(' ')}\n`);

function clean(v) {
  const s = (v ?? '').toString().trim();
  return s.startsWith('${') ? '' : s; // placeholder sin sustituir
}

/**
 * Opciones del plugin que el usuario guardó en /plugin (settings.json → pluginConfigs).
 * Las leemos directamente para no depender de la sustitución ${user_config.*}, que en
 * algunas versiones de Claude Code tumba el servidor si un campo opcional está vacío.
 */
function pluginOptions() {
  const dir = clean(process.env.CLAUDE_CONFIG_DIR) || path.join(os.homedir(), '.claude');
  const settings = readJson(path.join(dir, 'settings.json'), {}) || {};
  const all = settings.pluginConfigs || {};
  const key = Object.keys(all).find((k) => k === 'relevo' || k.startsWith('relevo@'));
  return (key && all[key]?.options) || {};
}

export function loadConfig(env = process.env) {
  const o = pluginOptions();
  const pick = (envKey, optKey) => clean(env[envKey]) || clean(o[optKey]);
  const num = (v, d, min, max) => {
    const n = Number(clean(v));
    return clean(v) !== '' && Number.isFinite(n) && n >= min && n <= max ? n : d;
  };
  const perms = pick('RELEVO_PERMISSIONS', 'permissions').toLowerCase();
  return {
    agyPath: pick('RELEVO_AGY_PATH', 'agy_path'),
    vaultPath: pick('RELEVO_VAULT_PATH', 'vault_path'),
    permissions: perms.startsWith('solo') || perms === 'files' ? 'solo-archivos' : 'completo',
    maxRuns: num(pick('RELEVO_MAX_RUNS', 'max_runs'), 40, 1, 500),
    timeoutMin: num(pick('RELEVO_TIMEOUT_MIN', 'timeout_min'), 20, 2, 180),
    model: pick('RELEVO_MODEL', 'model'),
    fallbackModel: clean(env.RELEVO_FALLBACK_MODEL) || 'auto',
    concurrency: num(env.RELEVO_CONCURRENCY, 2, 1, 4),
    dataDir: clean(env.CLAUDE_PLUGIN_DATA) || path.join(os.homedir(), '.relevo'),
    projectDir: path.resolve(clean(env.RELEVO_PROJECT_DIR) || clean(env.CLAUDE_PROJECT_DIR) || process.cwd()),
  };
}

class Semaphore {
  constructor(n) {
    this.n = n;
    this.queue = [];
  }
  async acquire() {
    if (this.n > 0) {
      this.n--;
      return;
    }
    await new Promise((r) => this.queue.push(r));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.n++;
  }
}

export class Team {
  constructor(config = loadConfig()) {
    this.config = config;
    ensureDir(config.dataDir);
    this.runs = 0;
    this.sem = new Semaphore(config.concurrency);
    this.inplaceLock = new KeyedMutex();
    this.pending = new Map(); // id -> Promise del trabajo en segundo plano
    this.progress = new Map(); // id -> { steps, lastTool, elapsedMs }
    this.agy = null;
    this.models = null;
    this.repo = null;
    this.baselineSha = null;
  }

  // ---------- contexto ----------

  consentFile() {
    return path.join(this.config.dataDir, 'consent.json');
  }

  hasConsent() {
    return readJson(this.consentFile(), {})?.accepted === true;
  }

  async getAgy(force = false) {
    if (this.agy && !force) return this.agy;
    const r = await resolveAgy(this.config.agyPath);
    if (!r.bin) {
      this.agy = { bin: null, problem: r.problem || 'No encuentro agy.', tried: r.tried };
      return this.agy;
    }
    const v = await agyVersion(r.bin);
    this.agy = { bin: r.bin, version: v.version, ok: v.ok, old: v.version && !versionAtLeast(v.version, MIN_AGY) };
    return this.agy;
  }

  async getModels() {
    if (this.models) return this.models;
    const cacheFile = path.join(this.config.dataDir, 'models.json');
    const cached = readJson(cacheFile, null);
    if (cached?.models?.length && Date.now() - cached.at < 12 * 3600 * 1000) return (this.models = cached.models);
    const a = await this.getAgy();
    if (!a.bin) return [];
    const m = await listModels(a.bin);
    if (m.ok) writeJson(cacheFile, { at: Date.now(), models: m.models });
    this.models = m.models;
    return this.models;
  }

  /** Contexto del proyecto de esta sesión de Claude Code (siempre la misma carpeta). */
  async ctx() {
    const projectDir = this.config.projectDir;
    if (!this.repo) this.repo = await Repo.open(projectDir, this.config.dataDir);
    const board = new Board(projectDir);
    const projCfg = readJson(path.join(board.dir, 'config.json'), {}) || {};
    const projectName = path.basename(projectDir);
    const v = vault.resolveVaultDir(this.config.vaultPath, projectName, typeof projCfg.vaultFolder === 'string' ? projCfg.vaultFolder : '');
    return { projectDir, projectName, repo: this.repo, board, vault: v };
  }

  // Punto de partida para revisar "lo que ha cambiado" (review_of=working).
  async baseline(c) {
    if (c.repo.isGit) return (await c.repo.headCommit()) || null;
    if (!this.baselineSha) this.baselineSha = await c.repo.snapshot('inicio de sesión');
    return this.baselineSha;
  }

  // Salidas visibles (prompt, respuesta, eventos, diff a revisar) en el proyecto…
  outDir(c, id) {
    return path.join(c.board.jobsDir, id);
  }

  // …pero los METADATOS de control viven fuera del proyecto: un repositorio clonado
  // no puede plantar un meta.json que haga a Relevo borrar o sobrescribir cosas.
  metaFile(c, id) {
    return path.join(c.repo.jobsDir, `${id}.json`);
  }

  nextJobId(c) {
    const seqFile = path.join(c.repo.stateDir, 'seq.json');
    let seq = readJson(seqFile, {})?.seq || 0;
    for (const f of fs.readdirSync(c.repo.jobsDir)) {
      const m = /^R-(\d+)\.json$/.exec(f);
      if (m) seq = Math.max(seq, Number(m[1]));
    }
    seq += 1;
    writeJson(seqFile, { seq });
    return `R-${seq}`;
  }

  loadJob(c, id) {
    if (!ID_RE.test(String(id || ''))) return null;
    const meta = readJson(this.metaFile(c, id), null);
    if (!meta || meta.id !== id || !MODES.includes(meta.mode) || !ROLES[meta.role]) return null;
    for (const k of ['base', 'tip', 'roundBase']) if (meta[k] !== undefined && meta[k] !== null && !isSha(meta[k])) return null;
    if (meta.worktree) {
      const expected = c.repo.worktreePath(id);
      if (path.resolve(meta.worktree.path || '') !== path.resolve(expected) || meta.worktree.branch !== c.repo.branchName(id)) return null;
    }
    if (meta.status === 'running' && !this.pending.has(id)) {
      meta.status = 'failed';
      meta.error = { kind: 'interrupted', message: 'El trabajo se interrumpió (se reinició Claude Code o el servidor). Puedes integrarlo tras revisarlo o descartarlo.' };
      this.saveJob(c, meta);
    }
    return meta;
  }

  saveJob(c, meta) {
    meta.updated = nowIso();
    writeJson(this.metaFile(c, meta.id), meta);
  }

  // ---------- herramientas ----------

  async status({ accept_risk, check = true } = {}) {
    if (accept_risk === true) writeJson(this.consentFile(), { accepted: true, at: nowIso() });
    const lines = [];
    const a = await this.getAgy(true);
    if (!a.bin) {
      lines.push(`agy: NO ENCONTRADO. ${a.problem}`);
      lines.push(installHelp());
    } else {
      lines.push(`agy ${a.version || '?'} en ${a.bin}${a.old ? ` · ⚠ versión antigua, actualiza a ≥${MIN_AGY} (agy update)` : ''}`);
      if (check) {
        // `agy models` consulta el servidor con la sesión del usuario y no gasta cuota.
        const m = await listModels(a.bin);
        if (m.ok) {
          this.models = m.models;
          writeJson(path.join(this.config.dataDir, 'models.json'), { at: Date.now(), models: m.models });
          lines.push('Sesión de agy: iniciada ✔');
          lines.push(`Modelos Gemini: ${m.models.slice(0, 12).join(', ')}`);
        } else if (m.authRequired) {
          lines.push('Sesión de agy: NO iniciada → abre una terminal, ejecuta `agy` e inicia sesión con tu cuenta de Google (se abre el navegador).');
        } else {
          lines.push(`Sesión de agy: no verificada (${m.raw.slice(0, 200)})`);
        }
      }
    }
    lines.push(`Permisos de Gemini: ${this.config.permissions}${this.config.permissions === 'completo' ? ' (ejecuta comandos; por defecto en copia aislada)' : ' (solo edita archivos)'}`);
    try {
      const c = await this.ctx();
      lines.push(`Proyecto: ${c.projectDir} · ${c.repo.isGit ? 'git' : 'sin git (Relevo usa un repositorio sombra fuera del proyecto)'}`);
      lines.push(c.board.exists() ? c.board.summary(8) : 'Tablero: sin inicializar (usa board action=init o /relevo:iniciar)');
      lines.push(c.vault?.dir ? `Obsidian: ${c.vault.dir} (${c.vault.how})` : `Obsidian: ${c.vault?.error || 'no configurado (opción vault_path del plugin)'}`);
      for (const w of c.repo.warnings) lines.push(`⚠ ${w}`);
    } catch (err) {
      lines.push(`Proyecto: ⚠ ${err.message}`);
    }
    lines.push(`Llamadas a Gemini en esta sesión: ${this.runs}/${this.config.maxRuns}`);
    const running = [...this.pending.keys()];
    if (running.length) lines.push(`En curso: ${running.join(', ')}`);
    if (!this.hasConsent()) {
      lines.push(
        'CONSENTIMIENTO PENDIENTE: antes de delegar, el usuario debe aceptar el aviso. Relevo lanza el agy oficial con SU sesión de Google; ' +
          'las condiciones de Antigravity prohíben usar su servicio "con productos de terceros" y Google no ha aclarado si esto está permitido: existe riesgo de suspensión de la cuenta. ' +
          'Explícaselo con tus palabras y, SOLO si acepta explícitamente, llama a status con accept_risk=true.',
      );
    }
    return lines.join('\n');
  }

  async delegate(args, { onProgress, signal } = {}) {
    const a = await this.getAgy();
    if (!a.bin) return { error: true, text: `agy no está instalado o no lo encuentro.\n${installHelp()}` };
    if (!this.hasConsent()) return { error: true, text: 'Falta el consentimiento del usuario sobre el riesgo de las condiciones de Google. Llama a status para ver el aviso.' };
    if (this.runs >= this.config.maxRuns) {
      return { error: true, text: `Límite de ${this.config.maxRuns} llamadas a Gemini por sesión alcanzado (protege tu cuota y tu cuenta). El usuario puede subirlo en la configuración del plugin (max_runs).` };
    }
    const c = await this.ctx();
    c.board.ensure();
    await this.baseline(c);

    let meta;
    if (args.continue_job) {
      meta = this.loadJob(c, args.continue_job);
      if (!meta) return { error: true, text: `No existe el trabajo ${args.continue_job}.` };
      if (this.pending.has(meta.id)) return { error: true, text: `${meta.id} sigue en curso; usa wait.` };
      if (['integrated', 'discarded'].includes(meta.status)) return { error: true, text: `${meta.id} ya está ${meta.status === 'integrated' ? 'integrado' : 'descartado'}; crea un trabajo nuevo.` };
      if (!isSha(meta.base)) return { error: true, text: `${meta.id} no llegó a arrancar; crea un trabajo nuevo.` };
      if (meta.mode === 'worktree' && !fs.existsSync(meta.worktree?.path || '')) return { error: true, text: `La copia aislada de ${meta.id} ya no existe; crea un trabajo nuevo.` };
      meta.round = (meta.round || 1) + 1;
    } else {
      if (!args.task || !String(args.task).trim()) return { error: true, text: 'Falta la tarea (task).' };
      const role = ROLES[args.role] ? args.role : 'implement';
      const mode = MODES.includes(args.mode) ? args.mode : ROLES[role].writes ? 'worktree' : 'readonly';
      meta = {
        id: this.nextJobId(c),
        title: String(args.title || args.task).split('\n')[0].slice(0, 90),
        role,
        mode,
        task: String(args.task),
        created: nowIso(),
        round: 1,
        board_task: /^T\d{1,4}$/.test(String(args.board_task || '')) ? args.board_task : null,
      };
    }
    meta.status = 'running';
    meta.error = null;
    ensureDir(this.outDir(c, meta.id));
    this.saveJob(c, meta);
    if (meta.board_task) c.board.upsertTask({ id: meta.board_task, status: 'en curso', job: meta.id, owner: 'gemini' });

    const work = this.execute(c, meta, args, { onProgress, signal }).finally(() => this.pending.delete(meta.id));
    this.pending.set(meta.id, work);
    if (args.wait === false) {
      return { text: `${meta.id} lanzado en segundo plano (${ROLES[meta.role].label}, ${meta.mode}). Usa wait con job_id=${meta.id}.` };
    }
    await work;
    return { text: this.formatResult(c, this.loadJob(c, meta.id)) };
  }

  async execute(c, meta, args, { onProgress, signal }) {
    await this.sem.acquire();
    try {
      const work = async () => {
        const outDir = this.outDir(c, meta.id);
        dbg(meta.id, 'inicio');
        // 1) instantánea de partida y carpeta de trabajo (se guardan YA, por si se interrumpe)
        if (meta.round === 1) {
          meta.base = await c.repo.snapshot(`${meta.id} base`);
          await c.repo.keep(meta.id, 'base', meta.base);
          this.saveJob(c, meta);
          if (meta.mode === 'worktree') {
            meta.worktree = await c.repo.createWorktree(meta.id, meta.base);
            this.saveJob(c, meta);
          }
        }
        const cwd = meta.mode === 'worktree' ? meta.worktree.cwd : c.projectDir;
        dbg(meta.id, 'instantánea/copia lista');

        // 2) diff a revisar (papel review)
        let diffFile = null;
        if (meta.role === 'review' && meta.round === 1) {
          const target = args.review_of || 'working';
          let from;
          let to;
          if (target === 'working') {
            from = await this.baseline(c);
            to = meta.base;
          } else {
            const other = this.loadJob(c, target);
            if (!other) throw new Error(`review_of: no existe el trabajo ${target}`);
            from = other.base;
            to = other.tip;
          }
          const diff = from ? await c.repo.diffText(from, to) : '';
          diffFile = path.join(outDir, 'review.diff');
          writeText(diffFile, diff || '(sin cambios)\n');
          meta.reviewOf = target;
        }

        // 3) prompt
        const memory = c.board.memoryDigest();
        const prompt = buildPrompt({
          role: meta.role,
          mode: meta.mode,
          task: meta.round > 1 ? String(args.task || args.context || 'Aplica el feedback.') : meta.task,
          context: [meta.round > 1 && args.task ? args.context : meta.round === 1 ? args.context : '', meta.round === 1 && memory ? `MEMORIA DEL EQUIPO (resumen):\n${memory}` : ''].filter(Boolean).join('\n\n'),
          files: Array.isArray(args.files) ? args.files.map(String).slice(0, 40) : undefined,
          vaultDir: c.vault?.dir || null,
          diffFile,
          filesOnly: this.config.permissions === 'solo-archivos',
          round: meta.round,
          projectName: c.projectName,
        });
        writeText(path.join(outDir, meta.round > 1 ? `prompt-${meta.round}.md` : 'prompt.md'), prompt);
        dbg(meta.id, 'prompt listo');

        // 4) modelo
        const choice = args.model ?? meta.modelChoice;
        const model = await this.chooseModel(choice);
        meta.modelChoice = choice;
        dbg(meta.id, 'modelo', model || '(defecto)');

        // 5) ejecutar agy (con reserva si se agota la cuota)
        const addDirs = [cwd, c.vault?.dir].filter(Boolean);
        const exec = (m) => {
          this.runs++;
          return runAgy({
            bin: this.agy.bin,
            cwd,
            prompt,
            model: m || undefined,
            conversationId: meta.round > 1 ? meta.conversationId : undefined,
            skipPermissions: this.config.permissions === 'completo',
            timeoutMin: Number(args.timeout_minutes) > 0 ? Math.min(Number(args.timeout_minutes), 180) : this.config.timeoutMin,
            addDirs,
            eventsFile: path.join(outDir, 'events.ndjson'),
            signal,
            onProgress: (p) => {
              this.progress.set(meta.id, p);
              onProgress?.(meta.id, p);
            },
          });
        };
        let res = await exec(model);
        meta.model = model || '(predeterminado de agy)';
        if (res.error?.kind === 'quota' && this.config.fallbackModel !== 'none' && this.runs < this.config.maxRuns) {
          const models = await this.getModels();
          const fb = this.config.fallbackModel === 'auto' ? pickFlash(models, model) : this.config.fallbackModel;
          if (fb && fb !== model) {
            meta.fallbackFrom = meta.model;
            res = await exec(fb);
            meta.model = fb;
          }
        }
        dbg(meta.id, 'agy terminó', `${res.durationMs}ms`, res.error?.kind || 'ok');
        if (res.conversationId) meta.conversationId = res.conversationId;
        meta.steps = (meta.steps || 0) + (res.steps || 0);
        meta.durationMs = (meta.durationMs || 0) + (res.durationMs || 0);
        meta.usage = res.envelope?.usage || meta.usage;
        writeText(path.join(outDir, 'stderr.log'), res.stderr || '');
        const response = res.envelope?.response || '';
        if (meta.round > 1) writeText(path.join(outDir, `response-${meta.round}.md`), response);
        writeText(path.join(outDir, 'response.md'), response);

        // 6) recoger cambios
        await this.collect(c, meta);
        meta.report = extractReport(response)?.fields || null;
        meta.error = res.error || null;
        if (meta.error && response.trim() && ['partial', 'empty'].includes(meta.error.kind)) meta.status = 'done';
        else meta.status = meta.error ? 'failed' : 'done';
        meta.ended = nowIso();
        if (meta.mode === 'readonly' && meta.files.length) meta.warning = 'Gemini modificó archivos pese a estar en modo solo lectura; revisa el diff y usa integrate action=discard si no los quieres.';
        this.saveJob(c, meta);
        if (meta.board_task) {
          const st = meta.status === 'failed' ? 'bloqueada' : ROLES[meta.role].writes && meta.files.length ? 'revisión' : 'hecha';
          c.board.upsertTask({ id: meta.board_task, status: st });
        }
        dbg(meta.id, 'diff listo');
      };
      if (meta.mode === 'inplace') await this.inplaceLock.run(c.projectDir, work);
      else await work();
    } catch (err) {
      meta.status = 'failed';
      meta.error = { kind: 'internal', message: String(err?.message || err).slice(0, 800) };
      meta.ended = nowIso();
      this.saveJob(c, meta);
    } finally {
      this.sem.release();
    }
  }

  /** Calcula el estado final (tip) y la lista de archivos cambiados. */
  async collect(c, meta) {
    if (meta.mode === 'worktree') meta.tip = await c.repo.commitWorktree(meta.worktree);
    else meta.tip = await c.repo.snapshot(`${meta.id} tras ronda ${meta.round}`);
    await c.repo.keep(meta.id, 'tip', meta.tip);
    const stat = await c.repo.diffStat(meta.base, meta.tip);
    meta.files = stat.files;
    meta.shortstat = stat.shortstat;
  }

  async chooseModel(choice) {
    const want = clean(choice).toLowerCase();
    if (!want || want === 'auto') return this.config.model || null;
    const models = await this.getModels();
    if (want === 'flash') return pickFlash(models) || this.config.model || null;
    if (want === 'pro') {
      const pro = models.filter((m) => /gemini/i.test(m) && /pro/i.test(m)).sort((a, b) => (/high/.test(b) ? 1 : 0) - (/high/.test(a) ? 1 : 0));
      return pro[0] || this.config.model || null;
    }
    const slug = clean(choice);
    return /^[a-z0-9][a-z0-9.\-_]{1,80}$/i.test(slug) ? slug : this.config.model || null;
  }

  formatResult(c, meta) {
    if (!meta) return 'Trabajo no encontrado.';
    return compactLinks(this.formatResultRaw(c, meta), [meta.worktree?.path, c.projectDir]);
  }

  formatResultRaw(c, meta) {
    const icon = meta.status === 'done' ? '✔' : meta.status === 'running' ? '…' : '✖';
    const lines = [`${meta.id} · ${ROLES[meta.role]?.label || meta.role} · ${icon} ${meta.status} · ${formatDuration(meta.durationMs)} · ${meta.model || ''}${meta.round > 1 ? ` · ronda ${meta.round}` : ''}`];
    if (meta.fallbackFrom) lines.push(`(cuota agotada en ${meta.fallbackFrom}; usado ${meta.model})`);
    if (meta.error) lines.push(`Problema: ${meta.error.message}`);
    if (meta.warning) lines.push(`⚠ ${meta.warning}`);
    for (const w of c.repo.warnings) lines.push(`⚠ ${w}`);
    const where = meta.mode === 'worktree' ? `copia aislada (rama ${meta.worktree?.branch})` : meta.mode === 'inplace' ? 'en la carpeta real (con instantánea para deshacer)' : 'solo lectura';
    if (meta.files?.length) {
      const shown = meta.files.slice(0, 15).map((f) => `${f.status} ${f.path}${f.added !== null ? ` (+${f.added} −${f.removed})` : ''}`);
      lines.push(`Cambios en ${where}: ${meta.shortstat}`);
      lines.push(...shown.map((s) => `  ${s}`));
      if (meta.files.length > 15) lines.push(`  … ${meta.files.length - 15} archivos más`);
    } else if (ROLES[meta.role]?.writes && meta.tip) {
      lines.push(`Sin cambios de archivos (${where}).`);
    }
    const resp = readText(path.join(this.outDir(c, meta.id), 'response.md'), '');
    const rep = extractReport(resp);
    const r = rep?.fields;
    if (r) {
      lines.push('Informe de Gemini:');
      for (const k of ['status', 'summary', 'changed', 'verification', 'risks', 'questions']) {
        if (r[k] && !/^none$/i.test(r[k].trim())) lines.push(`${k}: ${truncateMiddle(r[k], k === 'summary' ? 900 : 400)}`);
      }
      // Explorar/planificar/revisar/investigar: el cuerpo ES el entregable.
      if (['explore', 'plan', 'review', 'research'].includes(meta.role) && rep.body) lines.push(`---\n${truncateMiddle(rep.body, 4000)}`);
    } else if (resp.trim()) {
      lines.push(`Respuesta de Gemini (recortada):\n${truncateMiddle(resp.trim(), ['explore', 'plan', 'review', 'research'].includes(meta.role) ? 3500 : 1500)}`);
    }
    const next = [];
    if (meta.status !== 'running') {
      if (meta.files?.length) next.push(`inspect ${meta.id} (diff)`);
      if (meta.mode !== 'readonly' && (meta.files?.length || !meta.tip)) next.push(`integrate ${meta.id} merge|discard`);
      if (isSha(meta.base)) next.push(`delegate continue_job=${meta.id} (feedback)`);
    }
    if (next.length) lines.push(`Siguiente: ${next.join(' · ')}`);
    return lines.join('\n');
  }

  async wait({ job_id, seconds = 600 }, { signal } = {}) {
    const c = await this.ctx();
    const meta = this.loadJob(c, job_id);
    if (!meta) return { error: true, text: `No existe el trabajo ${job_id}.` };
    const p = this.pending.get(meta.id);
    if (p) {
      const ms = Math.max(5, Math.min(Number(seconds) || 600, 1500)) * 1000;
      let timer;
      const aborted = new Promise((r) => signal?.addEventListener?.('abort', r, { once: true }));
      const done = await Promise.race([p.then(() => true), new Promise((r) => (timer = setTimeout(() => r(false), ms))), aborted.then(() => false)]);
      clearTimeout(timer);
      if (!done) {
        const pr = this.progress.get(meta.id);
        return { text: `${meta.id} sigue en curso${pr ? ` · ${pr.steps} pasos · ${formatDuration(pr.elapsedMs)}${pr.lastTool ? ` · última acción: ${pr.lastTool}` : ''}` : ''}. Vuelve a llamar a wait.` };
      }
    }
    return { text: this.formatResult(c, this.loadJob(c, meta.id)) };
  }

  async inspect({ job_id, what = 'diff', path: filter, max_lines = 150 }) {
    const c = await this.ctx();
    const meta = this.loadJob(c, job_id);
    if (!meta) return { error: true, text: `No existe el trabajo ${job_id}.` };
    const max = Math.max(10, Math.min(Number(max_lines) || 150, 800));
    const dir = this.outDir(c, meta.id);
    let text = '';
    if (what === 'diff') {
      if (!meta.base || !meta.tip) return { text: `${meta.id} aún no tiene diff.` };
      const paths = filter ? String(filter).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30) : [];
      text = await c.repo.diffText(meta.base, meta.tip, paths);
      if (!text.trim()) text = '(sin cambios)';
    } else if (what === 'response') {
      text = compactLinks(readText(path.join(dir, 'response.md'), '(sin respuesta)'), [meta.worktree?.path, c.projectDir]);
    } else if (what === 'prompt') {
      text = readText(path.join(dir, 'prompt.md'), '(sin prompt)');
    } else if (what === 'log') {
      const events = readText(path.join(dir, 'events.ndjson'), '').split('\n').filter(Boolean);
      const tools = events.map((l) => { try { return JSON.parse(l).step_update?.tool_name; } catch { return null; } }).filter(Boolean);
      text = `eventos: ${events.length} · herramientas usadas: ${[...new Set(tools)].join(', ') || 'ninguna'}\nstderr (final):\n${readText(path.join(dir, 'stderr.log'), '').slice(-3000)}`;
    } else {
      return { error: true, text: 'what debe ser diff, response, prompt o log.' };
    }
    const l = limitLines(text, max);
    return { text: l.truncated ? `${l.text}\n… [${l.total - max} líneas más; usa path= para filtrar o sube max_lines]` : l.text };
  }

  async integrate({ job_id, action }) {
    const c = await this.ctx();
    const meta = this.loadJob(c, job_id);
    if (!meta) return { error: true, text: `No existe el trabajo ${job_id}.` };
    if (this.pending.has(meta.id)) return { error: true, text: `${meta.id} sigue en curso.` };
    if (['integrated', 'discarded'].includes(meta.status)) return { text: `${meta.id} ya estaba ${meta.status === 'integrated' ? 'integrado' : 'descartado'}.` };
    if (!['merge', 'discard'].includes(action)) return { error: true, text: 'action debe ser merge o discard.' };

    // Un trabajo interrumpido o que falló al recoger cambios: recuperamos antes de tocar nada.
    if (meta.mode !== 'readonly' && isSha(meta.base) && !isSha(meta.tip)) {
      try {
        if (meta.mode === 'worktree' && !fs.existsSync(meta.worktree?.path || '')) throw new Error('la copia aislada ya no existe');
        await this.collect(c, meta);
        this.saveJob(c, meta);
      } catch (err) {
        return { error: true, text: `No pude recuperar el estado de ${meta.id} (${err.message}). No he tocado nada.` };
      }
    }
    if (meta.mode !== 'readonly' && !isSha(meta.base)) {
      if (action === 'discard') {
        meta.status = 'discarded';
        this.saveJob(c, meta);
        await c.repo.removeWorktree(meta.worktree);
        return { text: `${meta.id} descartado (no llegó a arrancar).` };
      }
      return { error: true, text: `${meta.id} no llegó a arrancar; no hay nada que integrar.` };
    }

    const cleanup = async () => {
      if (meta.mode === 'worktree') await c.repo.removeWorktree(meta.worktree);
      await c.repo.dropRefs(meta.id);
    };
    let msg;
    if (action === 'merge') {
      if (meta.mode === 'worktree') {
        // Mientras un trabajo inplace está en marcha no escribimos en la carpeta real.
        const r = await this.inplaceLock.run(c.projectDir, () => c.repo.applyToMain(meta.base, meta.tip));
        if (!r.ok) {
          return { error: true, text: `No se pudo integrar ${meta.id} (${r.method}). La copia aislada sigue en ${meta.worktree?.path} (rama ${meta.worktree?.branch}).\n${(r.message || '').slice(0, 800)}` };
        }
        msg = r.partial
          ? `${meta.id} integrado CON CONFLICTOS en: ${r.conflicts.join(', ')}. Resuélvelos (marcadores <<<<<<<) antes de seguir.`
          : `${meta.id} integrado en el proyecto (${r.method}): ${meta.shortstat}.`;
      } else {
        msg = meta.mode === 'inplace' ? `${meta.id} aceptado (los cambios ya estaban en la carpeta real).` : `${meta.id} cerrado.`;
      }
      meta.status = 'integrated';
    } else {
      if (meta.mode === 'worktree') {
        msg = `${meta.id} descartado; el proyecto real no se tocó.`;
      } else if (meta.files?.length) {
        const r = await this.inplaceLock.run(c.projectDir, () => c.repo.restore(meta.base, meta.tip));
        if (r.error) return { error: true, text: `No se pudo deshacer ${meta.id}: ${r.error}` };
        msg = `${meta.id} deshecho: ${r.restored.length} archivos restaurados.${r.skipped.length ? ` No restaurados porque cambiaron después: ${r.skipped.join(', ')}` : ''}`;
      } else {
        msg = `${meta.id} descartado (no había cambios).`;
      }
      meta.status = 'discarded';
    }
    this.saveJob(c, meta);
    await cleanup();
    if (meta.board_task) c.board.upsertTask({ id: meta.board_task, status: action === 'merge' ? 'hecha' : 'pendiente' });
    return { text: msg };
  }

  async board(args) {
    const c = await this.ctx();
    switch (args.action) {
      case 'init': {
        const actions = c.board.init();
        return { text: `Relevo listo en ${c.projectDir}:\n- ${actions.join('\n- ')}\n${c.board.summary()}` };
      }
      case 'task': {
        c.board.ensure();
        const t = c.board.upsertTask(args);
        return { text: `${t.id} [${t.status}] (${t.owner}) ${t.title}` };
      }
      case 'decide':
        if (!args.text) return { error: true, text: 'Falta text.' };
        c.board.decide(args.text, args.who || 'claude');
        return { text: 'Decisión registrada en .relevo/decisiones.md' };
      case 'learn':
        if (!args.text) return { error: true, text: 'Falta text.' };
        c.board.learn(args.text, args.who || 'claude');
        return { text: 'Aprendizaje guardado en .relevo/memoria.md' };
      case 'read':
      default:
        if (!c.board.exists()) return { text: 'Tablero sin inicializar (action=init).' };
        return { text: `${c.board.summary(25)}\n\n${c.board.memoryDigest(2000) || 'Memoria del equipo vacía.'}` };
    }
  }

  async vaultTool(args) {
    const c = await this.ctx();
    if (!c.vault) return { error: true, text: 'Obsidian no está configurado. Indica la carpeta de tu bóveda en la opción vault_path del plugin (/plugin → Relevo → configurar).' };
    switch (args.action) {
      case 'search':
        return { text: vault.search(c.vault, args.query) };
      case 'save': {
        if (!args.title || !args.content) return { error: true, text: 'Faltan title y content.' };
        const rel = vault.save(c.vault, { title: args.title, content: args.content, kind: args.kind, tags: Array.isArray(args.tags) ? args.tags : [], projectName: c.projectName });
        return { text: `Nota guardada en la bóveda: ${rel}` };
      }
      case 'brief':
      default:
        return { text: vault.brief(c.vault) };
    }
  }
}

// Gemini enlaza archivos como [x](file:///C:/ruta/larga/x.js#L1-L3): para Claude basta
// "x (x.js#L1-L3)" relativo al proyecto. Ahorra muchos tokens en cada informe.
export function compactLinks(text, roots = []) {
  const bases = roots.filter(Boolean).map((r) => r.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
  return String(text).replace(/\[([^\]]*)\]\(file:\/\/\/?([^)\s]+)\)/g, (_, label, target) => {
    let t;
    try {
      t = decodeURIComponent(target);
    } catch {
      t = target;
    }
    t = t.replace(/\\/g, '/');
    const low = t.toLowerCase();
    for (const b of bases) {
      if (low.startsWith(b + '/')) {
        t = t.slice(b.length + 1);
        break;
      }
    }
    const file = t.split('#')[0];
    return label === file || label === file.split('/').pop() ? `\`${t}\`` : `${label} (\`${t}\`)`;
  });
}

export function installHelp() {
  if (process.platform === 'win32') {
    return 'Instalar agy (PowerShell): irm https://antigravity.google/cli/install.ps1 | iex — después ejecuta `agy` una vez para iniciar sesión.';
  }
  return 'Instalar agy (macOS/Linux): curl -fsSL https://antigravity.google/cli/install.sh | bash — después ejecuta `agy` una vez para iniciar sesión.';
}
