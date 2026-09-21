import { spawn } from 'node:child_process';
import { loadEnvironment } from '../lib/runtime.mjs';

const env = await loadEnvironment(new URL('../.env', import.meta.url));
if (!env.DATABASE_URL) throw new Error('Set DATABASE_URL before running the database test.');
const child = spawn(process.execPath, ['--test', 'test/database.test.mjs'], {
  cwd: new URL('..', import.meta.url), stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: env.DATABASE_URL },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
