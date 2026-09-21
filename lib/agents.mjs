import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getTemplate, buildPrompt } from '../public/templates.js';
import { validatePreferences } from './settings.mjs';

const invalid = message => Object.assign(new Error(message), { status: 400 });
export function agentId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw invalid('Invalid agent ID.');
  return value;
}
export function validateAgent(input, defaults) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Send an agent configuration.');
  const template = getTemplate(input.templateId);
  if (!template) throw invalid('Choose an available sector template.');
  const text = (key, max, fallback = '') => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'string' || value.length > max) throw invalid(`Invalid ${key}.`);
    return value.trim();
  };
  const name = text('name', 80);
  if (!name) throw invalid('Give your agent a name.');
  const company = text('company', 120), knowledge = text('knowledge', 6000), goal = text('goal', 500, template.goal);
  if (!goal) throw invalid('Give your agent an objective.');
  const systemPrompt = text('systemPrompt', 12000, buildPrompt(template, { company, knowledge, goal }));
  let preferences;
  try { preferences = validatePreferences({ voice: input.voice, sttProvider: input.sttProvider, agent: { model: input.model, systemPrompt } }, defaults); }
  catch (error) { throw invalid(error.message); }
  return { name, company, knowledge, goal, templateId: template.id, systemPrompt: preferences.agent.systemPrompt,
    model: preferences.agent.model, voice: preferences.voice, sttProvider: preferences.sttProvider };
}
export const newAgent = config => ({ ...config, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

// Development/local mode only. Production agents belong to users in PostgreSQL.
export function createLocalAgentStore(directory) {
  const file = path.join(directory, 'agents.json');
  let queue = Promise.resolve();
  async function read() {
    try { const data = JSON.parse(await readFile(file, 'utf8')); if (!Array.isArray(data)) throw new Error(); return data; }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error('Could not read local agents.', { cause: error }); }
  }
  return {
    async listAgents(owner) { await queue; return (await read()).filter(row => row.owner === owner).map(row => row.agent).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async getAgent(owner, id) { await queue; return (await read()).find(row => row.owner === owner && row.agent.id === id)?.agent || null; },
    saveAgent(owner, agent, { create = false } = {}) {
      const result = queue.then(async () => {
        const data = await read();
        const index = data.findIndex(row => row.owner === owner && row.agent.id === agent.id);
        if (index < 0 && !create) return null;
        if (index >= 0) data[index] = { owner, agent }; else data.push({ owner, agent });
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = file + '.' + randomBytes(6).toString('hex') + '.tmp';
        try { await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
        finally { await unlink(temporary).catch(() => {}); }
        return agent;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}
