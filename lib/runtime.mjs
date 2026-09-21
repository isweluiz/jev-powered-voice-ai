import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export async function loadEnvironment(envPath, env = process.env) {
  let disk = {};
  try { disk = parseEnv(await readFile(envPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...disk, ...env };
}

export function connectionLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new Error('Concurrency limits must be integers from 1 to 100.');
  return number;
}
