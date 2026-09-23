// Lanzamiento de procesos sin shell (sin inyección de comandos) y con
// muerte del árbol completo de procesos en Windows, macOS y Linux.
import { spawn } from 'node:child_process';
import { IS_WIN } from './util.mjs';

const live = new Set();

// Los .js/.mjs se ejecutan con el Node actual (lo usan los tests con un agy simulado).
export function commandFor(bin, args) {
  if (/\.(c|m)?js$/i.test(bin)) return { cmd: process.execPath, args: [bin, ...args] };
  return { cmd: bin, args };
}

export function spawnSafe(bin, args, { cwd, env, detachedGroup = true } = {}) {
  const c = commandFor(bin, args);
  const child = spawn(c.cmd, c.args, {
    cwd,
    env: env || process.env,
    shell: false,
    // En Windows NUNCA detached: sin consola agy se cuelga (issue #508).
    // En POSIX creamos grupo propio para poder matar a los nietos.
    detached: !IS_WIN && detachedGroup,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  live.add(child);
  child.once('exit', () => live.delete(child));
  child.once('error', () => live.delete(child));
  return child;
}

export function killTree(child) {
  if (!child || !child.pid) return;
  // En POSIX matamos el grupo aunque el líder ya haya salido (pueden quedar nietos).
  if (!IS_WIN) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WIN) {
      const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      k.on('error', () => {
        try { child.kill(); } catch {}
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {}
}

export function killAll() {
  for (const c of live) killTree(c);
}

// Ejecuta y recoge la salida. Nunca hereda stdin: si no hay entrada se cierra.
export function run(bin, args, { cwd, env, input, timeoutMs = 120000, maxBuffer = 64 * 1024 * 1024, binary = false } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnSafe(bin, args, { cwd, env });
    } catch (err) {
      resolve({ code: -1, stdout: binary ? Buffer.alloc(0) : '', stderr: String(err?.message || err), error: err, timedOut: false });
      return;
    }
    const out = [];
    const errc = [];
    let outLen = 0;
    let timedOut = false;
    let settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBuf = Buffer.concat(out);
      resolve({
        code,
        stdout: binary ? stdoutBuf : stdoutBuf.toString('utf8'),
        stderr: Buffer.concat(errc).toString('utf8'),
        error,
        timedOut,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      setTimeout(() => finish(-1, new Error('timeout')), 3000);
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      outLen += d.length;
      if (outLen <= maxBuffer) out.push(d);
    });
    child.stderr.on('data', (d) => errc.push(d));
    child.on('error', (err) => finish(-1, err));
    child.on('close', (code) => finish(code ?? -1));
    child.stdin.on('error', () => {});
    if (input !== undefined && input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

process.once('exit', killAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(sig, () => {
    killAll();
    process.exit(0);
  });
}
