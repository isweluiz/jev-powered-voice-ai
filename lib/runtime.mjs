import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export async function loadEnvironment(envPath, env = process.env) {
  let disk = {};
  try { disk = parseEnv(await readFile(envPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...disk, ...env };
}

export function startupEnvironment(env, args = []) {
  const local = args.includes('--local');
  const developer = args.includes('--dev');
  if (local && developer) throw new Error('Choose either --local or --dev.');
  if (!local && !developer) return env;
  const next = { ...env, AUTH_MODE: local ? 'local' : 'development', NODE_ENV: env.NODE_ENV || 'development' };
  if (next.NODE_ENV !== 'development') throw new Error('Local testing requires NODE_ENV=development.');
  return next;
}

export function connectionLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new Error('Concurrency limits must be integers from 1 to 100.');
  return number;
}
