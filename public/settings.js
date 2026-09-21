let current;
let loading;
export const activeAgentId = new URLSearchParams(location.search).get('agent');
const changes = new BroadcastChannel('call-coach-settings');
const listeners = new Set();
function checkSession(response) {
  if (response.status === 401) {
    location.replace('/login?reason=expired');
    throw new Error('Your session expired. Sign in again.');
  }
  return response;
}
export async function loadSettings() {
  if (!loading) loading = fetch('/api/settings' + (activeAgentId ? '?agentId=' + encodeURIComponent(activeAgentId) : ''), { cache: 'no-store' }).then(async res => {
    checkSession(res);
    if (!res.ok) throw new Error(res.status === 404 ? 'This agent is unavailable. Open My agents to choose another.' : 'Could not load settings. Reload the page.');
    const next = await res.json();
    if (current?.user?.id && current.user.id !== next.user?.id) {
      location.reload();
      throw new Error('Account changed. Reloading your workspace.');
    }
    current = next;
    for (const listener of listeners) listener(current);
    return current;
  }).finally(() => { loading = null; });
  return loading;
}
export async function getSettings() { return current || loadSettings(); }
export async function apiPost(path, payload, { signal } = {}) {
  const config = await getSettings();
  const response = checkSession(await fetch(path, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Call-Coach-Token': config.csrfToken },
    body: JSON.stringify(activeAgentId && ['/api/settings', '/api/evaluate', '/api/reply', '/api/tts'].includes(path) ? { ...payload, agentId: activeAgentId } : payload) }));
  if (path === '/api/auth/logout' && response.ok) changes.postMessage('signed-out');
  return response;
}
changes.onmessage = () => { loadSettings().catch(() => {}); };

export function mountSettings({ onChange = () => {}, onTestVoice } = {}) {
  listeners.add(onChange);
  const providers = [['bandwidth', 'Bandwidth', 'Speech to text'], ['deepgram', 'Deepgram', 'Text to speech'], ['jev', 'Jev', 'Evaluation'], ['openai', 'OpenAI', 'Agent replies']];
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settingsTitle');
  dialog.innerHTML = `<form id="settingsForm" autocomplete="off">
    <div class="settings-heading"><div><p class="settings-eyebrow">WORKSPACE SETTINGS</p><h2 id="settingsTitle">Configure your agent</h2></div><button type="button" class="settings-close" aria-label="Close settings">×</button></div>
    <div class="settings-tabs" role="tablist" aria-label="Settings sections">
      <button type="button" role="tab" id="connectionsTab" aria-controls="settingsConnectionsPanel" data-section="connections" aria-selected="true">Connections</button>
      <button type="button" role="tab" id="agentTab" aria-controls="settingsAgentPanel" data-section="agent" aria-selected="false">Agent</button>
      <button type="button" role="tab" id="voiceTab" aria-controls="settingsVoicePanel" data-section="voice" aria-selected="false">Voice</button>
    </div>
    <section id="settingsConnectionsPanel" role="tabpanel" aria-labelledby="connectionsTab">
      <p class="settings-intro" id="connectionsNote">Keys stay on the server and are never returned to the browser.</p>
      ${providers.map(([id, name, purpose]) => `<fieldset class="provider-setting"><legend>${name} <span>${purpose}</span></legend>
        <div class="provider-status" id="${id}Status">Checking…</div><label for="${id}Key">${name} API key</label>
        <input type="password" id="${id}Key" name="${id}Key" autocomplete="new-password" spellcheck="false" placeholder="Enter API key">
        <label class="settings-check"><input type="checkbox" id="${id}Remove"> Remove configured key</label></fieldset>`).join('')}
    </section>
    <section id="settingsAgentPanel" role="tabpanel" aria-labelledby="agentTab" hidden>
      <p class="settings-intro">OpenAI generates replies using your system prompt and Jev’s current suggested action.</p>
      <label class="settings-label" for="agentModel">OpenAI model</label><input type="text" id="agentModel" maxlength="100" spellcheck="false" placeholder="gpt-4.1-mini">
      <label class="settings-label" for="systemPrompt">System prompt</label><textarea id="systemPrompt" rows="12" maxlength="12000" spellcheck="false"></textarea>
      <p class="settings-footnote">Describe your company, product facts, qualification criteria, and desired tone. The agent has no booking or CRM tools; tell it what next steps it may offer.</p>
    </section>
    <section id="settingsVoicePanel" role="tabpanel" aria-labelledby="voiceTab" hidden>
      <div class="voice-setting"><label for="sttProvider">Microphone speech recognition</label><select id="sttProvider"><option value="bandwidth">Bandwidth STT</option><option value="browser">Browser speech recognition</option></select></div>
      <p class="settings-footnote">Browser mode needs no STT key and uses the browser’s speech service. Availability varies by browser. Call capture always uses Bandwidth.</p>
      <div class="voice-setting"><label for="ttsVoice">Deepgram voice</label><select id="ttsVoice"></select><button type="button" id="testVoice" class="ghost">Preview voice</button></div>
      <p class="settings-footnote">Apply a Deepgram key before previewing. The microphone pauses while the agent speaks to prevent feedback.</p>
    </section>
    <label class="settings-check remember-choice" id="rememberChoice"><input type="checkbox" id="rememberKeys"> <span id="rememberLabel">Remember on this computer</span></label>
    <p class="settings-footnote" id="storageNote"></p>
    <p class="settings-message" id="settingsMessage" role="status"></p>
    <div class="settings-actions"><button type="button" class="ghost settings-cancel">Cancel</button><button type="submit" class="settings-save">Apply settings</button></div>
  </form>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector('#' + id);
  const clearInputs = () => { for (const [id] of providers) { el(id + 'Key').value = ''; el(id + 'Remove').checked = false; } el('rememberKeys').checked = false; };
  function render(config) {
    const account = ['account', 'agent'].includes(config.storage);
    const manageKeys = config.canManageKeys !== false;
    el('connectionsNote').textContent = manageKeys
      ? 'Provider keys are shared by the workspace. They stay on the server and are never returned to the browser.'
      : 'Your administrator manages these shared connections. You can customize your own agent and voice settings.';
    el('rememberChoice').hidden = !manageKeys;
    el('rememberLabel').textContent = account ? 'Save changed provider keys on the server' : 'Remember on this computer';
    el('storageNote').textContent = account
      ? (config.storage === 'agent' ? 'These preferences are saved to this web agent.' : 'Your agent and voice preferences are saved to your account.') + (manageKeys ? ' Provider key changes stay in memory unless saved to the server’s private .env file. Blank fields keep existing keys.' : '')
      : 'Off: session only. On: keys and preferences are saved in a local plaintext .env file with owner-only permissions, excluded from Git. Blank key fields keep existing keys.';
    for (const [id] of providers) {
      el(id + 'Status').textContent = config.configured[id] ? 'Key configured' : 'Key needed';
      el(id + 'Status').dataset.ready = String(config.configured[id]);
      el(id + 'Key').placeholder = config.configured[id] ? 'Enter a new key to replace it' : 'Enter API key';
      el(id + 'Key').disabled = !manageKeys;
      el(id + 'Key').hidden = !manageKeys;
      dialog.querySelector(`label[for="${id}Key"]`).hidden = !manageKeys;
      el(id + 'Remove').disabled = !manageKeys;
      el(id + 'Remove').closest('label').hidden = !manageKeys;
    }
    el('ttsVoice').replaceChildren(...config.voices.map(v => new Option(v.label, v.id)));
    el('ttsVoice').value = config.voice;
    el('sttProvider').value = config.sttProvider;
    el('agentModel').value = config.agent.model;
    el('systemPrompt').value = config.agent.systemPrompt;
  }
  function selectSection(section) {
    for (const button of dialog.querySelectorAll('[data-section]')) {
      const selected = button.dataset.section === section;
      button.setAttribute('aria-selected', String(selected));
      el('settings' + button.dataset.section[0].toUpperCase() + button.dataset.section.slice(1) + 'Panel').hidden = !selected;
    }
  }
  dialog.querySelectorAll('[data-section]').forEach(button => { button.onclick = () => selectSection(button.dataset.section); });
  async function open(section = 'connections') {
    selectSection(section);
    clearInputs(); el('settingsMessage').textContent = '';
    if (!dialog.open) dialog.showModal();
    try { render(await loadSettings()); } catch (e) { el('settingsMessage').textContent = e.message; }
  }
  dialog.querySelector('.settings-close').onclick = () => dialog.close();
  dialog.querySelector('.settings-cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', clearInputs);
  for (const [id] of providers) el(id + 'Key').oninput = () => { el(id + 'Remove').checked = false; };
  el('settingsForm').onsubmit = async event => {
    event.preventDefault();
    const button = dialog.querySelector('.settings-save');
    button.disabled = true; el('settingsMessage').textContent = 'Applying…';
    const keys = {};
    for (const [id] of providers) {
      if (el(id + 'Remove').checked) keys[id] = null;
      else if (el(id + 'Key').value.trim()) keys[id] = el(id + 'Key').value.trim();
    }
    try {
      const res = await apiPost('/api/settings', { keys, voice: el('ttsVoice').value, sttProvider: el('sttProvider').value, agent: { model: el('agentModel').value.trim(), systemPrompt: el('systemPrompt').value }, persist: el('rememberKeys').checked });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save settings.');
      current = data; clearInputs(); render(data);
      for (const listener of listeners) listener(data);
      changes.postMessage('updated');
      el('settingsMessage').textContent = data.storage === 'agent' ? 'Web agent updated.' : data.storage === 'account' ? 'Preferences saved to your account.' : data.persisted ? 'Applied and saved on this computer.' : 'Applied for this server session.';
    } catch (e) { el('settingsMessage').textContent = e.message; }
    finally { for (const key of Object.keys(keys)) delete keys[key]; button.disabled = false; }
  };
  el('testVoice').hidden = !onTestVoice;
  el('testVoice').onclick = async () => {
    el('testVoice').disabled = true;
    try {
      el('settingsMessage').textContent = 'Preparing voice preview…';
      await onTestVoice(el('ttsVoice').value);
      el('settingsMessage').textContent = 'Playing voice preview.';
    } catch (e) { el('settingsMessage').textContent = e.message; }
    finally { el('testVoice').disabled = false; }
  };
  loadSettings().catch(() => {});
  return { open };
}
