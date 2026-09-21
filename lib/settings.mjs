import { readFile, open, rename, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';

export const VOICES = [
  { id: 'aura-2-thalia-en', label: 'Thalia · American English' },
  { id: 'aura-2-apollo-en', label: 'Apollo · American English' },
  { id: 'aura-2-draco-en', label: 'Draco · British English' },
];
const VARIABLES = { bandwidth: 'BW_STT_API_KEY', deepgram: 'DEEPGRAM_API_KEY', jev: 'TYPESAFE_API_KEY', openai: 'OPENAI_API_KEY' };
export const DEFAULT_PROMPT = 'You are an AI sales and lead-qualification assistant. Introduce yourself as an AI assistant when appropriate. Learn the prospect’s needs, current process, budget, decision makers, and timeline. Ask one focused question at a time. Keep replies conversational and brief, usually one or two sentences suitable for speech. Use only product facts provided in these instructions; do not invent prices, capabilities, offers, bookings, or promises. If details are missing, acknowledge that and ask a useful discovery question. Never claim an external action has been completed.';

export function validatePreferences(change, base) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('Invalid settings.');
  if (change.agent != null && (typeof change.agent !== 'object' || Array.isArray(change.agent))) throw new Error('Invalid agent settings.');
  const voice = change.voice ?? base.voice;
  const sttProvider = change.sttProvider ?? base.sttProvider;
  const agent = { model: change.agent?.model ?? base.agent.model, systemPrompt: change.agent?.systemPrompt ?? base.agent.systemPrompt };
  if (!VOICES.some(v => v.id === voice)) throw new Error('Choose one of the available voices.');
  if (!['bandwidth', 'browser'].includes(sttProvider)) throw new Error('Choose Bandwidth or browser speech recognition.');
  if (typeof agent.model !== 'string' || !/^[\w.:-]{1,100}$/.test(agent.model)) throw new Error('Enter a valid OpenAI model ID.');
  if (typeof agent.systemPrompt !== 'string' || !agent.systemPrompt.trim() || agent.systemPrompt.length > 12000) throw new Error('System prompt must be 1–12000 characters.');
  return { voice, sttProvider, agent };
}

export async function createSettings(envPath, env = process.env) {
  async function readEnv() {
    try { return await readFile(envPath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  const disk = parseEnv(await readEnv());
  let keys = Object.fromEntries(Object.entries(VARIABLES).map(([name, variable]) => [name, env[variable] ?? disk[variable] ?? '']));
  let voice = env.DEEPGRAM_TTS_MODEL || disk.DEEPGRAM_TTS_MODEL || VOICES[0].id;
  if (!VOICES.some(v => v.id === voice)) voice = VOICES[0].id;
  let sttProvider = (env.STT_PROVIDER ?? disk.STT_PROVIDER) === 'browser' ? 'browser' : 'bandwidth';
  const prompt64 = env.AGENT_SYSTEM_PROMPT_BASE64 ?? disk.AGENT_SYSTEM_PROMPT_BASE64;
  let agent = {
    model: env.OPENAI_MODEL || disk.OPENAI_MODEL || 'gpt-4.1-mini',
    systemPrompt: env.AGENT_SYSTEM_PROMPT || disk.AGENT_SYSTEM_PROMPT || (prompt64 ? Buffer.from(prompt64, 'base64').toString('utf8') : DEFAULT_PROMPT),
  };
  let queue = Promise.resolve();

  const status = () => ({ configured: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, Boolean(v)])), voice, voices: VOICES, sttProvider, agent: { ...agent } });
  async function update(change) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('Invalid settings.');
    if (change.keys != null && (typeof change.keys !== 'object' || Array.isArray(change.keys))) throw new Error('Invalid keys.');
    const next = { ...keys };
    for (const [name, value] of Object.entries(change.keys || {})) {
      if (!Object.hasOwn(VARIABLES, name)) throw new Error('Unknown provider.');
      if (value === null) next[name] = '';
      else if (typeof value === 'string' && /^[\w.+/=-]{8,1024}$/.test(value)) next[name] = value;
      else throw new Error('Keys must be 8–1024 characters with no whitespace or quotes.');
    }
    const nextVoice = change.voice ?? voice;
    const nextProvider = change.sttProvider ?? sttProvider;
    if (change.agent != null && (typeof change.agent !== 'object' || Array.isArray(change.agent))) throw new Error('Invalid agent settings.');
    const nextAgent = { model: change.agent?.model ?? agent.model, systemPrompt: change.agent?.systemPrompt ?? agent.systemPrompt };
    if (typeof nextAgent.model !== 'string' || !/^[\w.:-]{1,100}$/.test(nextAgent.model)) throw new Error('Enter a valid OpenAI model ID.');
    if (typeof nextAgent.systemPrompt !== 'string' || !nextAgent.systemPrompt.trim() || nextAgent.systemPrompt.length > 12000) throw new Error('System prompt must be 1–12000 characters.');
    if (!['bandwidth', 'browser'].includes(nextProvider)) throw new Error('Choose Bandwidth or browser speech recognition.');
    if (!VOICES.some(v => v.id === nextVoice)) throw new Error('Choose one of the available voices.');
    if (change.persist != null && typeof change.persist !== 'boolean') throw new Error('Invalid storage choice.');
    if (change.persist) {
      // Preserve unrelated variables; replace only settings owned by this app.
      const previous = parseEnv(await readEnv());
      for (const [name, variable] of Object.entries(VARIABLES)) previous[variable] = next[name];
      previous.DEEPGRAM_TTS_MODEL = nextVoice;
      previous.STT_PROVIDER = nextProvider;
      previous.OPENAI_MODEL = nextAgent.model;
      delete previous.AGENT_SYSTEM_PROMPT;
      previous.AGENT_SYSTEM_PROMPT_BASE64 = Buffer.from(nextAgent.systemPrompt).toString('base64');
      const quote = value => {
        const delimiter = ['"', "'", '`'].find(q => !value.includes(q));
        if (!delimiter) throw new Error('An existing .env value cannot be safely preserved. Edit the file manually.');
        return delimiter + value + delimiter;
      };
      const content = Object.entries(previous).map(([key, value]) => `${key}=${quote(value)}`).join('\n') + '\n';
      const temporary = `${envPath}.${randomBytes(6).toString('hex')}.tmp`;
      let file;
      try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(content);
        await file.close(); file = null;
        await rename(temporary, envPath);
      } finally {
        await file?.close();
        await unlink(temporary).catch(() => {});
      }
    }
    keys = next; voice = nextVoice; sttProvider = nextProvider; agent = nextAgent;
    return { ...status(), persisted: Boolean(change.persist) };
  }
  return {
    status,
    key: name => keys[name],
    voice: () => voice,
    update(change) {
      const result = queue.then(() => update(change));
      queue = result.catch(() => {});
      return result;
    },
  };
}
