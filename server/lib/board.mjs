// Tablero del equipo dentro del proyecto (.relevo/): tareas, decisiones y memoria.
// Todo en Markdown legible por humanos, por Claude y por Gemini.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, readJson, writeJson, readText, writeText, appendText, nowIso, today } from './util.mjs';

const OWNERS = ['claude', 'gemini', 'humano'];
const STATUSES = ['pendiente', 'en curso', 'revisión', 'hecha', 'bloqueada', 'descartada'];

const AGENTS_START = '<!-- relevo:start -->';
const AGENTS_END = '<!-- relevo:end -->';
const AGENTS_SECTION = `${AGENTS_START}
## Equipo Relevo (Claude + Gemini)
Este proyecto lo trabajan Claude (líder técnico) y Gemini (vía Antigravity CLI), coordinados por Relevo.
- Manda el humano. Si hay desacuerdo técnico, decide Claude.
- Tablero: \`.relevo/tablero.md\` · Decisiones: \`.relevo/decisiones.md\` · Memoria del equipo: \`.relevo/memoria.md\`.
- Antes de empezar, consulta la memoria del equipo. Lo aprendido se guarda allí en pocas líneas.
- No hagas commits ni cambies de rama salvo petición expresa: Relevo integra los cambios tras la revisión.
${AGENTS_END}`;

export class Board {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.dir = path.join(projectDir, '.relevo');
    this.stateFile = path.join(this.dir, 'estado.json');
    this.tableroFile = path.join(this.dir, 'tablero.md');
    this.decisionsFile = path.join(this.dir, 'decisiones.md');
    this.memoryFile = path.join(this.dir, 'memoria.md');
    this.jobsDir = path.join(this.dir, 'jobs');
  }

  exists() {
    return fs.existsSync(this.stateFile);
  }

  /** Estructura mínima (se crea sola la primera vez que se delega algo). */
  ensure() {
    ensureDir(this.jobsDir);
    const gi = path.join(this.dir, '.gitignore');
    if (!fs.existsSync(gi)) writeText(gi, '# Salidas de trabajo de Relevo (no se versionan)\njobs/\n');
    if (!fs.existsSync(this.stateFile)) writeJson(this.stateFile, { version: 1, seq: 0, tasks: [], config: {} });
    if (!fs.existsSync(this.decisionsFile)) writeText(this.decisionsFile, '# Decisiones del equipo\n\nRegistro breve de decisiones técnicas (qué, por qué, quién).\n');
    if (!fs.existsSync(this.memoryFile)) writeText(this.memoryFile, '# Memoria del equipo\n\nAprendizajes duraderos del proyecto. Breves, uno por línea.\n');
    if (!fs.existsSync(this.tableroFile)) this.render();
  }

  /** Inicialización completa: además conecta AGENTS.md y CLAUDE.md. */
  init() {
    const actions = [];
    const had = this.exists();
    this.ensure();
    actions.push(had ? 'tablero .relevo/ ya existía' : 'creado tablero .relevo/ (tablero, decisiones, memoria)');

    const agents = path.join(this.projectDir, 'AGENTS.md');
    const current = readText(agents, null);
    if (current === null) {
      writeText(agents, `# Instrucciones para agentes\n\n${AGENTS_SECTION}\n`);
      actions.push('creado AGENTS.md (lo leen Gemini y Claude)');
    } else if (!current.includes(AGENTS_START)) {
      writeText(agents, `${current.replace(/\s*$/, '')}\n\n${AGENTS_SECTION}\n`);
      actions.push('añadida sección Relevo a AGENTS.md');
    } else {
      const re = new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}`);
      writeText(agents, current.replace(re, AGENTS_SECTION));
      actions.push('sección Relevo de AGENTS.md actualizada');
    }

    const claudeMd = path.join(this.projectDir, 'CLAUDE.md');
    const cm = readText(claudeMd, null);
    if (cm === null) {
      writeText(claudeMd, '@AGENTS.md\n');
      actions.push('creado CLAUDE.md que importa @AGENTS.md');
    } else if (!/^\s*@AGENTS\.md\s*$/m.test(cm)) {
      writeText(claudeMd, `${cm.replace(/\s*$/, '')}\n\n@AGENTS.md\n`);
      actions.push('CLAUDE.md ahora importa @AGENTS.md');
    }
    return actions;
  }

  state() {
    const s = readJson(this.stateFile, null) || { version: 1, seq: 0, tasks: [], config: {} };
    s.tasks ||= [];
    s.config ||= {};
    return s;
  }

  save(state) {
    writeJson(this.stateFile, state);
    this.render(state);
  }

  nextJobId() {
    const s = this.state();
    s.seq = (s.seq || 0) + 1;
    this.save(s);
    return `R-${s.seq}`;
  }

  upsertTask({ id, title, owner, status, notes, job }) {
    const s = this.state();
    let t = id ? s.tasks.find((x) => x.id === id) : null;
    if (!t) {
      const n = s.tasks.filter((x) => /^T\d+$/.test(x.id)).length + 1;
      t = { id: id || `T${n}`, title: title || '(sin título)', owner: 'gemini', status: 'pendiente', created: nowIso() };
      s.tasks.push(t);
    }
    if (title) t.title = String(title).slice(0, 200);
    if (owner) t.owner = OWNERS.includes(owner) ? owner : t.owner;
    if (status) t.status = STATUSES.includes(status) ? status : t.status;
    if (notes !== undefined) t.notes = String(notes).slice(0, 300);
    if (job) t.jobs = [...new Set([...(t.jobs || []), job])];
    t.updated = nowIso();
    this.save(s);
    return t;
  }

  decide(text, who = 'claude') {
    this.ensure();
    appendText(this.decisionsFile, `\n- ${today()} · ${who}: ${String(text).trim().replace(/\n+/g, ' ')}`);
  }

  learn(text, who = 'claude') {
    this.ensure();
    appendText(this.memoryFile, `\n- ${today()} · ${who}: ${String(text).trim().replace(/\n+/g, ' ')}`);
  }

  memoryDigest(maxChars = 3500) {
    const mem = readText(this.memoryFile, '').trim();
    const dec = readText(this.decisionsFile, '').trim().split('\n').filter((l) => l.startsWith('- ')).slice(-6).join('\n');
    const out = [];
    if (mem && mem.split('\n').some((l) => l.startsWith('- '))) out.push(`Memoria:\n${mem.split('\n').filter((l) => l.startsWith('- ')).join('\n')}`);
    if (dec) out.push(`Últimas decisiones:\n${dec}`);
    const text = out.join('\n\n');
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
  }

  render(state = this.state()) {
    const rows = state.tasks.map((t) => `| ${t.id} | ${esc(t.title)} | ${t.owner} | ${t.status} | ${(t.jobs || []).join(', ')} | ${esc(t.notes || '')} |`);
    writeText(
      this.tableroFile,
      `# Tablero del equipo\n\n> Lo mantiene Relevo. Manda el humano; ante desacuerdo técnico decide Claude.\n\n| ID | Tarea | Responsable | Estado | Trabajos | Notas |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`,
    );
  }

  summary(maxTasks = 15) {
    const s = this.state();
    const open = s.tasks.filter((t) => !['hecha', 'descartada'].includes(t.status));
    const done = s.tasks.length - open.length;
    const lines = [`Tablero: ${open.length} abiertas · ${done} cerradas`];
    for (const t of open.slice(0, maxTasks)) lines.push(`- ${t.id} [${t.status}] (${t.owner}) ${t.title}${t.jobs?.length ? ` · ${t.jobs.join(',')}` : ''}`);
    if (open.length > maxTasks) lines.push(`… y ${open.length - maxTasks} más en .relevo/tablero.md`);
    return lines.join('\n');
  }
}

function esc(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
