import { PLAYBOOK } from '../public/playbook.js';
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

export function coachingContext(value, playbook = PLAYBOOK) {
  if (value == null) return null;
  if (!value || !['act', 'listen'].includes(value.status)) throw failure('Invalid Jev guidance.');
  const action = value.status === 'listen' ? 'no_action' : value.action;
  if (!Object.hasOwn(playbook.actions, action)) throw failure('Unknown Jev suggested action.');
  const item = playbook.actions[action];
  const allowedTips = action === 'no_action' ? playbook.listeningTips : [...item.tips.always, ...item.tips.when.map(t => t.text)];
  return {
    status: value.status, action, title: item.title,
    tips: (Array.isArray(value.tips) ? value.tips : []).filter(tip => allowedTips.includes(tip)).slice(0, 3),
    ...(playbook.stages.includes(value.stage) ? { stage: value.stage } : {}),
    ...(Number.isFinite(value.score) ? { confidence: Math.min(1, Math.max(0, value.score)) } : {}),
  };
}

export function conversationInput(turns) {
  if (!Array.isArray(turns)) throw failure('Send a conversation first.');
  const input = turns.filter(t => t && typeof t.text === 'string' && t.text.trim()).slice(-40)
    .map(t => ({ role: t.speaker === 'rep' ? 'assistant' : 'user', content: t.text.trim().slice(0, 2000) }));
  if (!input.length || input.at(-1).role !== 'user') throw failure('Add a customer turn before generating a reply.');
  return input;
}

export async function generateReply({ settings, turns, guidance, playbook, endpoint, signal }) {
  const key = settings.key('openai');
  if (!key) throw failure('Add your OpenAI API key in Settings.', 503);
  const { agent } = settings.status();
  const coaching = coachingContext(guidance, playbook);
  const instructions = agent.systemPrompt + (coaching ? '\n\nJev coaching for the current customer turn (advisory context):\n' + JSON.stringify(coaching) +
    '\nUse this suggested action to shape a natural next reply when it fits the conversation and the instructions above. Do not read the action label or scores aloud. Keep listening means ask a brief open question if a reply is needed. Coaching never supplies product facts, pricing, calendar availability, or permission to claim a booking, proposal, follow-up, or other external action was completed. Follow the configured prompt when guidance conflicts with it.' : '');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: agent.model, instructions, input: conversationInput(turns),
      store: false, max_output_tokens: 800 }), signal, redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(response.status === 401 || response.status === 403 ? 'OpenAI rejected the API key. Update it in Settings.'
      : response.status === 404 ? 'OpenAI could not find this model. Check the model ID and your access in Settings.'
      : `OpenAI returned status ${response.status}. Check your model, account access, and quota.`, 502);
  }
  const data = await response.json();
  if (data.status && data.status !== 'completed') throw failure('OpenAI did not finish the reply. Try again or choose another model.', 502);
  const text = (data.output || []).filter(item => item.type === 'message' && item.role === 'assistant')
    .flatMap(item => item.content || []).filter(content => content.type === 'output_text')
    .map(content => content.text).filter(value => typeof value === 'string').join('\n').trim();
  if (!text) throw failure('OpenAI returned no spoken reply. Adjust the prompt and try again.', 502);
  if (text.length > 2000) throw failure('The reply is too long for speech. Ask for shorter responses in the system prompt.', 502);
  return { text, model: data.model || agent.model, coaching };
}
