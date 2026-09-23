// Instrucciones que recibe Gemini (vía agy) según su papel en el equipo.
// Cortas a propósito: cada token cuenta, también en la cuota de Google.

export const ROLES = {
  explore: {
    label: 'explorar',
    writes: false,
    text: `Explora el proyecto para el objetivo indicado y devuelve un mapa COMPACTO (máx. 60 líneas):
archivos y carpetas relevantes (ruta — para qué sirve), convenciones del código, cómo se instala/ejecuta/testea,
riesgos o deudas que afecten al objetivo. No copies código salvo líneas imprescindibles. No modifiques nada.`,
  },
  plan: {
    label: 'planificar',
    writes: false,
    text: `Redacta un plan de implementación para el objetivo. Divide en tareas pequeñas e independientes cuando se pueda.
Para cada tarea: id (T1, T2…), título, responsable sugerido (gemini: implementación en volumen, frontend, tests, docs,
refactors mecánicos, investigación; claude: arquitectura, lógica delicada, seguridad, decisiones de diseño),
archivos, criterio de aceptación y dependencias. Añade riesgos y preguntas abiertas. No modifiques nada.
Si recibes una crítica de Claude, revisa el plan: acepta lo razonable y argumenta en 1-2 líneas lo que no.`,
  },
  implement: {
    label: 'implementar',
    writes: true,
    text: `Implementa la tarea en esta carpeta. Sigue las convenciones existentes, cambios mínimos y completos
(sin TODOs ni código de relleno). Si hay tests, build o linter, ejecútalos y corrige lo que rompas.
No hagas commits ni cambies de rama: Relevo gestiona git.`,
  },
  test: {
    label: 'probar',
    writes: true,
    text: `Verifica el trabajo: ejecuta los tests/build/linter existentes y, si falta cobertura para lo pedido,
escribe tests. Informa exactamente qué comandos ejecutaste y su resultado. Corrige solo fallos evidentes
causados por el cambio; lo demás, descríbelo.`,
  },
  review: {
    label: 'revisar',
    writes: false,
    text: `Haz una revisión de código ADVERSARIAL del diff indicado. Busca: bugs, casos límite, errores de seguridad,
regresiones, incoherencias con el resto del código y tests que falten. Por cada hallazgo: severidad
(alta/media/baja), archivo:línea, problema en 1 línea y arreglo propuesto. Nada de estilo o gustos personales.
Si no encuentras problemas reales, dilo. No modifiques archivos.`,
  },
  research: {
    label: 'investigar',
    writes: false,
    text: `Investiga la pregunta (documentación oficial, código del proyecto y web si hace falta). Responde con
conclusiones verificables y enlaces a las fuentes. Sé breve y concreto. No modifiques archivos.`,
  },
  free: {
    label: 'libre',
    writes: true,
    text: `Resuelve la petición siguiendo las convenciones del proyecto.`,
  },
};

const MODE_RULES = {
  worktree: `Trabajas en una COPIA AISLADA del proyecto (git worktree). Puedes editar y ejecutar comandos aquí.
No toques archivos fuera de esta carpeta. Claude revisará tu diff antes de integrarlo en el proyecto real.`,
  inplace: `Trabajas DIRECTAMENTE en la carpeta real del proyecto. Relevo guarda una instantánea para poder deshacer,
pero actúa con cuidado: nada destructivo (no borres carpetas, no reinicies bases de datos, no fuerces git).`,
  readonly: `Modo SOLO LECTURA: no crees, modifiques ni borres archivos.`,
};

const REPORT = `Termina SIEMPRE tu respuesta con este bloque exacto (Relevo lo lee para ahorrar tokens a Claude):
### RELEVO-REPORT
status: done | partial | blocked
summary: <máx. 8 líneas con lo esencial>
changed: <archivos tocados, o none>
verification: <comandos ejecutados y resultado, o not run>
risks: <riesgos o none>
questions: <preguntas para Claude, o none>`;

export function buildPrompt({ role, mode, task, context, files, memoryFiles, vaultDir, diffFile, filesOnly, round, projectName }) {
  const r = ROLES[role] || ROLES.free;
  const parts = [];
  if (round && round > 1) {
    parts.push(`CONTINUACIÓN (ronda ${round}) de la misma tarea. Aplica el feedback de Claude sobre tu trabajo anterior.`);
  } else {
    parts.push(`Eres Gemini, miembro del equipo "Relevo" junto a Claude (líder técnico) en el proyecto "${projectName}".
Jerarquía: las instrucciones del humano mandan; si hay desacuerdo técnico, decide Claude.`);
    parts.push(`PAPEL: ${r.label}\n${r.text}`);
    parts.push(`MODO: ${MODE_RULES[mode] || MODE_RULES.readonly}`);
    if (filesOnly) {
      parts.push(`PERMISOS: no ejecutes comandos de terminal ni abras URLs (no tienes permiso y se perdería todo el turno).
Solo lee y escribe archivos. Indica qué comandos habría que ejecutar para verificar.`);
    }
    const mem = (memoryFiles || []).filter(Boolean);
    if (mem.length) parts.push(`MEMORIA DEL EQUIPO (léela si es relevante, no la copies): ${mem.join(' · ')}`);
    if (vaultDir) parts.push(`NOTAS DEL PROYECTO EN OBSIDIAN (solo lectura; consúltalas si aportan contexto): ${vaultDir}`);
  }
  parts.push(`TAREA:\n${task}`);
  if (files?.length) parts.push(`ARCHIVOS EN FOCO:\n${files.map((f) => `- ${f}`).join('\n')}`);
  if (diffFile) parts.push(`DIFF A REVISAR (léelo del archivo): ${diffFile}`);
  if (context) parts.push(`CONTEXTO / FEEDBACK DE CLAUDE:\n${context}`);
  parts.push(`Responde en el mismo idioma que la TAREA. Sé conciso.\n${REPORT}`);
  return parts.join('\n\n');
}

// Extrae el bloque RELEVO-REPORT; si Gemini no lo puso, devuelve null.
export function extractReport(response) {
  const text = String(response || '');
  const idx = text.lastIndexOf('### RELEVO-REPORT');
  if (idx < 0) return null;
  const block = text.slice(idx + '### RELEVO-REPORT'.length).trim();
  const fields = {};
  let current = null;
  for (const line of block.split('\n')) {
    const m = /^\s*(status|summary|changed|verification|risks|questions)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      current = m[1].toLowerCase();
      fields[current] = m[2].trim();
    } else if (current && line.trim()) {
      fields[current] += `\n${line.trimEnd()}`;
    }
  }
  return { raw: block, fields, body: text.slice(0, idx).trim() };
}
