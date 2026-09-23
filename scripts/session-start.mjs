#!/usr/bin/env node
// Al abrir una sesión en un proyecto con Relevo, recuerda a Claude (en una línea)
// que hay tablero y tareas abiertas. En proyectos sin Relevo no imprime nada.
import fs from 'node:fs';
import path from 'node:path';

try {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const file = path.join(dir, '.relevo', 'estado.json');
  if (fs.existsSync(file)) {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const open = (s.tasks || []).filter((t) => !['hecha', 'descartada'].includes(t.status));
    const list = open.slice(0, 5).map((t) => `${t.id} ${t.title} [${t.status}]`).join('; ');
    process.stdout.write(
      `Relevo activo en este proyecto: ${open.length} tareas abiertas${list ? ` (${list})` : ''}. ` +
        'Tablero en .relevo/tablero.md. Para seguir en equipo con Gemini: /relevo:equipo.\n',
    );
  }
} catch {
  // Nunca bloquear el arranque de la sesión.
}
