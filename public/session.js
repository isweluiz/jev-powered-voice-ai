import { decide, trackStage, createMemory, markDone, DEFAULT_CONFIG } from "/decide.js";
import { PLAYBOOK as SALES_PLAYBOOK } from "/playbook.js";
import { getTemplate, templatePlaybook } from "/templates.js";
import { mountShell } from "/shell.js";
import { AgentSession } from "/agent-session.js";
import { JevClient, transcriptKey } from "/jev-client.js";
import { VoiceWaveform } from "/waveform.js";
import { mountSettings, getSettings } from "/settings.js";
import { BandwidthSpeech, BrowserSpeech, TranscriptAssembler, DeepgramSpeech } from "/speech.js";

const $ = (id) => document.getElementById(id);
const mainEl = document.querySelector("main");
const initialConfig = await getSettings().catch(error => {
  $("setup").hidden = false; $("setup").textContent = error.message;
  $("mic").disabled = true; $("typeIn").disabled = true;
  throw error;
});
const sectorTemplate = getTemplate(initialConfig.workspaceAgent?.templateId);
const PLAYBOOK = sectorTemplate ? templatePlaybook(sectorTemplate) : SALES_PLAYBOOK;
const stageLabel = sectorTemplate?.stageLabel || "Buying stage";
document.querySelector(".hero-kicker").textContent = stageLabel;
const STAGES = PLAYBOOK.stages;
const N = STAGES.length;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const GAUGE_R = 76;
const GAUGE_CIRC = 2 * Math.PI * GAUGE_R;
const GAUGE_ARC = GAUGE_CIRC * (240 / 360);

const app = {
  turns: [], speaker: "customer", listening: false,
  inFlight: false, pending: false, timer: null, revision: 0,
  memory: createMemory(), result: null, shownScore: null
};

mountShell({ active: "talk", onSettings: () => settingsPanel.open() });
await import("/account.js");

/* ---------- Hero ---------- */
$("stageLabels").replaceChildren(...STAGES.map((s) => Object.assign(document.createElement("li"), { textContent: s })));

const MAX = N - 1;
const RANGES = STAGES.map((_, i) => [Math.max(0, (i - 0.5) / MAX), Math.min(1, (i + 0.5) / MAX)]);
mainEl.style.setProperty("--cols", RANGES.map(([a, b]) => `${(b - a) * 2 * MAX}fr`).join(" "));

function setGauge(score) {
  const fill = GAUGE_ARC * (score / 100);
  const gf = $("gaugeFill");
  gf.style.strokeDasharray = `${fill} ${GAUGE_CIRC}`;
  gf.style.opacity = score > 0 ? "1" : "0";
}

function countTo(el, to) {
  const from = app.shownScore ?? 0;
  app.shownScore = to;
  if (reduceMotion || from === to) { el.textContent = to; setGauge(to); return; }
  const start = performance.now(), dur = 500;
  const step = (t) => {
    const k = Math.min(1, (t - start) / dur), eased = 1 - (1 - k) ** 3;
    const v = from + (to - from) * eased;
    el.textContent = Math.round(v);
    setGauge(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStageIdle() {
  const hero = $("hero");
  hero.dataset.state = "idle";
  mainEl.style.setProperty("--stage", "var(--s0)");
  $("stageName").textContent = "Waiting for the customer";
  $("trend").textContent = ""; $("trend").className = "trend";
  $("scoreNum").textContent = "–"; app.shownScore = null;
  setGauge(0);
  $("confPill").hidden = true;
  document.querySelectorAll(".seg i").forEach((i) => (i.style.width = "0"));
  $("marker").style.opacity = "0"; $("spread").style.opacity = "0";
  [...$("stageLabels").children].forEach((li) => { li.removeAttribute("aria-current"); li.className = ""; });
  $("stageCount").textContent = "";
  $("track").setAttribute("aria-label", `No ${stageLabel.toLowerCase()} yet`);
}

function renderStage(st) {
  const hero = $("hero");
  hero.dataset.state = "live";
  mainEl.style.setProperty("--stage", `var(--s${st.level})`);

  $("stageName").textContent = st.label;
  countTo($("scoreNum"), st.buyingScore);

  const pill = $("confPill");
  pill.hidden = !st.confidenceLabel;
  pill.textContent = st.confidenceLabel || "";
  pill.dataset.level = (st.confidenceLabel || "").split(" ")[0].toLowerCase();

  const x = st.position / MAX;
  document.querySelectorAll(".seg i").forEach((el, i) => {
    const [a, b] = RANGES[i];
    el.style.width = `${Math.max(0, Math.min(1, (x - a) / (b - a))) * 100}%`;
  });
  $("marker").style.left = `${x * 100}%`;
  $("marker").style.opacity = "1";

  const w = Math.min(1, (2 * st.spread) / MAX);
  const left = Math.max(0, Math.min(1 - w, x - w / 2));
  $("spread").style.left = `${left * 100}%`;
  $("spread").style.width = `${w * 100}%`;
  $("spread").style.opacity = w > 0.02 ? "1" : "0";

  [...$("stageLabels").children].forEach((li, i) => {
    li.className = i < st.level ? "past" : "";
    if (i === st.level) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  });
  $("stageCount").textContent = `Stage ${st.level + 1} of ${N}`;
  $("track").setAttribute("aria-label", `Stage ${st.level + 1} of ${N}: ${st.label}`);

  const trend = $("trend");
  if (st.trend) {
    trend.className = `trend ${st.trend}`;
    trend.innerHTML = `<span class="arrow" aria-hidden="true">${st.trend === "up" ? "▲" : "▼"}</span>`;
    trend.append(`Moved ${st.trend} from ${st.from}`);
  } else { trend.className = "trend"; trend.textContent = ""; }

  if (st.changed) {
    hero.classList.remove("moved"); void hero.offsetWidth; hero.classList.add("moved");
  }
}

/* ---------- Next step ---------- */
function renderNextIdle() {
  const next = $("next");
  next.dataset.status = "idle";
  $("nextKicker").textContent = "Suggested action";
  $("nextTitle").textContent = "Start the conversation";
  $("nextNote").hidden = true;
  $("nextConf").hidden = true;
  $("tipMain").textContent = "Start a voice session or type a message below. Jev’s suggested actions guide the agent’s replies.";
  $("more").hidden = true;
  $("nextActions").hidden = true;
}

function renderNext(r, animate) {
  const next = $("next");
  const acting = r.status === "act";
  next.dataset.status = r.status;
  $("nextTitle").textContent = acting ? r.title : "Keep listening";

  const note = r.note || (!acting && r.leaningTitle ? `Best guess so far: ${r.leaningTitle} (${Math.round(r.score * 100)}%)` : "");
  $("nextNote").textContent = note;
  $("nextNote").hidden = !note;

  $("nextConf").hidden = !acting;
  if (acting) {
    const pct = Math.round(r.score * 100);
    $("nextPct").textContent = `${pct}%`;
    $("nextBar").style.width = `${pct}%`;
  }

  const [first, ...rest] = r.tips;
  $("tipMain").textContent = first || "";
  $("more").hidden = rest.length === 0;
  $("moreLabel").textContent = rest.length === 1 ? "1 more tip" : `${rest.length} more tips`;
  $("moreList").replaceChildren(...rest.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  $("nextActions").hidden = !acting;

  if (acting && r.changed && animate) {
    next.classList.remove("changed"); void next.offsetWidth; next.classList.add("changed");
  }
}

/* ---------- Status ---------- */
function showHeard(text, speaker, interim = false) {
  $("heardWho").textContent = speaker === "rep" ? "You" : "Customer";
  $("heardText").textContent = text ? `"${text}"` : "Nothing yet";
  $("heardText").classList.toggle("interim", interim);
}
function setActivity() { $("heard").className = "heard" + (app.inFlight ? " busy" : app.listening ? " live" : ""); }
function showError(msg) {
  $("error").textContent = msg || ""; $("error").hidden = !msg;
}

/* ---------- Jev + local logic ---------- */
function scheduleEvaluate() {
  clearTimeout(app.timer);
  app.timer = setTimeout(() => { app.timer = null; evaluate(); }, 350);
}
function scheduleStreamingEvaluate() {
  if (!app.timer) app.timer = setTimeout(() => { app.timer = null; evaluate(); }, 1000);
}

const jevClient = new JevClient();
function applyEvaluation(data, key) {
  if (app.resultKey === key || key !== transcriptKey(app.turns)) return;
    showError("");

    const stage = trackStage(data.answers.buying_stage, app.memory.stage, STAGES);
    app.result = decide(data.answers, PLAYBOOK, app.memory);
    if (sectorTemplate) renderSignals(data.answers);
    if (stage) renderStage(stage);
    renderNext(app.result, !stage?.changed);

    const parts = [];
    if (stage?.changed) parts.push(`${stageLabel}: ${stage.label}${stage.from ? `, moved ${stage.trend} from ${stage.from}` : ""}. Score ${stage.buyingScore}.`);
    if (app.result.status === "act" && app.result.changed) parts.push(`Next step: ${app.result.title}.`);
    if (parts.length) $("announce").textContent = parts.join(" ");
    app.resultKey = key; app.stageLabel = stage?.label || null;
}

async function evaluate() {
  if (!app.turns.some((t) => t.speaker === "customer")) return;
  if (app.inFlight) { app.pending = true; return; }
  app.inFlight = true; setActivity();
  const revision = app.revision;
  const turns = app.turns.map(t => ({ speaker: t.speaker, text: t.text }));
  const key = transcriptKey(turns);
  try {
    const data = await jevClient.evaluate(turns);
    if (revision !== app.revision) return;
    applyEvaluation(data, key);
  } catch (err) {
    if (revision !== app.revision) return;
    showError(err instanceof TypeError ? "Can't reach the local server. Check that node server.mjs is still running." : err.message);
  } finally {
    app.inFlight = false; setActivity();
    if (app.pending) { app.pending = false; evaluate(); }
  }
}

function addTurn(text, { speaker = app.speaker, merge = false } = {}) {
  text = text.trim();
  if (!text) return;
  const prev = app.turns[app.turns.length - 1];
  if (merge && prev && prev.merge && prev.speaker === speaker && Date.now() - prev.at < 15000) { prev.text += " " + text; prev.at = Date.now(); }
  else app.turns.push({ speaker, text, at: Date.now(), merge });
  showHeard(text, speaker);
  scheduleEvaluate();
}

function markCurrentDone() {
  const r = app.result;
  if (!r || r.status !== "act") return;

  markDone(app.memory, r.action); app.resultKey = null;
  const mins = Math.round(DEFAULT_CONFIG.doneCooldownMs / 60000);
  $("doneMsg").textContent = `Marked "${r.title}" done. It's hidden for ${mins} minutes.`;
  clearTimeout(markCurrentDone.t);
  markCurrentDone.t = setTimeout(() => ($("doneMsg").textContent = ""), 5000);
  evaluate();
}

/* ---------- Bandwidth STT + Deepgram TTS ---------- */
const waveform = new VoiceWaveform($("voiceWave"), $("voiceChannel"));
let providerConfig = null;
let streamSpeaker = "customer";
const assembler = new TranscriptAssembler();
let inputProvider = "Bandwidth";
const idleVoiceStatus = () => `${providerConfig?.sttProvider === "browser" ? "Browser" : "Bandwidth"} STT · Deepgram voice`;
const speechCallbacks = {
  onAnalyser(analyser) { waveform.setAnalyser(analyser); },
  onText(segment) {
    const turn = assembler.append(app.turns, segment, streamSpeaker);
    showHeard(turn.text, streamSpeaker);
    renderConversation();
    agentSession.transcript();
    scheduleStreamingEvaluate();
  },
  onState(state) {
    waveform.setMode(state === "listening" ? "listening" : state);
    $("voicePhase").textContent = state === "listening" ? "Listening to you" : state === "starting" ? "Connecting microphone…" : state === "stopping" ? "Finishing your turn…" : "Ready to listen";
    app.listening = state === "listening";
    $("voiceStatus").textContent = state === "starting" ? `Connecting to ${inputProvider}…` : state === "listening" ? `Listening · ${inputProvider}` : state === "stopping" ? "Finishing transcript…" : idleVoiceStatus();
    if (state === "idle" && app.turns.length) scheduleEvaluate();
    setActivity();
    updateSessionControls();
  },
  onError(message) {
    $("agentError").textContent = message; $("agentError").hidden = false; agentSession.end();
  },
};
const speech = new BandwidthSpeech(speechCallbacks);
const browserSpeech = new BrowserSpeech(speechCallbacks);
const voice = new DeepgramSpeech({
  onAnalyser(analyser) { waveform.setAnalyser(analyser); },
  onState(state) {
    waveform.setMode(state);
    const labels = { idle: "Ready to listen", loading: "Preparing the voice…", playing: "Agent speaking", paused: "Voice paused", ready: "Press Play to hear the voice" };
    $("voicePhase").textContent = labels[state] || labels.idle;
    $("pauseVoice").hidden = !["playing", "paused", "ready"].includes(state);
    $("pauseVoice").textContent = state === "paused" ? "Resume voice" : state === "ready" ? "Play voice" : "Pause voice";
    $("stopVoice").hidden = state === "idle";
    $("voiceStatus").textContent = state === "idle" ? idleVoiceStatus() : voice.streaming ? "Deepgram · Streaming audio" : "Deepgram · Voice playback";
  },
});
$("pauseVoice").onclick = () => voice.togglePause().catch(error => showError(error.message));
$("stopVoice").onclick = () => agentSession.end();
const settingsPanel = mountSettings({
  onChange(config) {
    if (providerConfig && providerConfig.sttProvider !== config.sttProvider) agentSession.end();
    providerConfig = config;
    $("setup").hidden = config.configured.jev;
    updateConnectionStatus();
    $("agentModelLabel").textContent = `${config.agent.model} replies · Jev evaluation`;
    $("voiceStatus").textContent = `${config.sttProvider === "browser" ? "Browser" : "Bandwidth"} STT · Deepgram voice`;
  },
  async onTestVoice(selectedVoice) {
    voice.unlock().catch(() => {});
    await agentSession.end();
    await voice.speak("Your Cayana agent is ready. Let's have a great conversation.", selectedVoice);
  },
});
$("settingsBtn").onclick = () => settingsPanel.open();
async function startListening() {
  const useBrowser = providerConfig?.sttProvider === "browser";
  if (!useBrowser && !providerConfig?.configured.bandwidth) { showError("Add your Bandwidth STT key in Settings."); settingsPanel.open(); return; }
  voice.stop(); showError(""); assembler.reset(); streamSpeaker = app.speaker;
  inputProvider = useBrowser ? "Browser" : "Bandwidth";
  await (useBrowser ? browserSpeech : speech).start("microphone");
}
async function stopListening() { await Promise.all([speech.stop(), browserSpeech.stop()]); }
const agentSession = new AgentSession({
  getTurns: () => app.turns,
  async getGuidance(turns, signal) {
    clearTimeout(app.timer); app.timer = null;
    const key = transcriptKey(turns);
    $("agentGuidance").dataset.status = "checking";
    $("guidanceAction").textContent = "Evaluating this turn…";
    $("guidanceDetail").textContent = "Jev is choosing the next action.";
    try {
      const data = await jevClient.evaluate(turns, { signal, waitMs: 6000 });
      if (signal.aborted || transcriptKey(app.turns) !== key) return null;
      applyEvaluation(data, key);
      const guidance = { status: app.result.status, action: app.result.action, score: app.result.score, tips: app.result.tips, stage: app.stageLabel };
      $("agentGuidance").dataset.status = "applied";
      $("guidanceAction").textContent = app.result.title || "Keep listening";
      $("guidanceDetail").textContent = "Guidance for this reply · Your system prompt takes priority.";
      return guidance;
    } catch (error) {
      if (signal.aborted) throw error;
      $("agentGuidance").dataset.status = "unavailable";
      $("guidanceAction").textContent = "Continuing without Jev guidance";
      $("guidanceDetail").textContent = "Evaluation was unavailable. The agent will use your system prompt.";
      return null;
    }
  },
  startInput: () => { app.speaker = "customer"; return startListening(); },
  stopInput: stopListening,
  voice,
  canSpeak: () => Boolean(providerConfig?.configured.deepgram),
  onReply(text) { app.turns.push({ speaker: "rep", text, at: Date.now(), merge: false }); renderConversation(); scheduleEvaluate(); },
  onState(state) {
    if (state === "thinking" || state === "listening" || state === "evaluating") { $("agentError").hidden = true; $("agentError").textContent = ""; }
    if (["thinking", "evaluating"].includes(state)) { waveform.setMode("thinking"); $("voicePhase").textContent = state === "evaluating" ? "Choosing the next action…" : "Preparing a reply…"; }
    if (state === "idle" && !voice.active) { waveform.setMode("idle"); $("voicePhase").textContent = "Ready to listen"; }
    $("agentStatus").textContent = state === "evaluating" ? "Jev is guiding the next reply…" : state === "thinking" ? "Preparing a reply…" : state === "speaking" ? "Agent speaking · Deepgram" : state === "listening" ? "Listening · pause briefly when your turn is complete" : "Ready when you are";
    $("typeIn").disabled = agentSession.busy;
    $("generateReply").disabled = agentSession.busy || app.turns.at(-1)?.speaker !== "customer";
    updateSessionControls();
  },
  onError(message) { $("agentError").textContent = message; $("agentError").hidden = !message; },
});
function updateSessionControls() {
  $("mic").disabled = false;
  $("mic").setAttribute("aria-pressed", String(agentSession.active || agentSession.busy));
  $("micLabel").textContent = agentSession.active || agentSession.busy ? "End session" : "Start voice session";
}
function updateConnectionStatus() {
  if (!providerConfig) return;
  const needed = ["openai", "deepgram", "jev", ...(providerConfig.sttProvider === "browser" ? [] : ["bandwidth"])];
  const ready = needed.every(key => providerConfig.configured[key]);
  $("connectionStatus").dataset.ready = String(ready);
  $("connectionStatus").textContent = ready ? "Keys configured" : "Setup needed";
}
function renderConversation() {
  $("conversationCount").textContent = `${app.turns.length} ${app.turns.length === 1 ? "message" : "messages"}`;
  const reply = app.turns.findLast(turn => turn.speaker === "rep")?.text || "";
  $("agentLatestReply").hidden = !reply;
  if ($("latestReplyText").textContent !== reply) $("latestReplyText").textContent = reply;
  if (!app.turns.length) {
    const empty = document.createElement("p"); empty.className = "agent-empty";
    empty.textContent = "Your conversation will appear here when the session starts.";
    $("agentMessages").replaceChildren(empty);
  } else $("agentMessages").replaceChildren(...app.turns.slice(-40).map(turn => {
    const div = document.createElement("div"); div.className = "agent-message"; div.dataset.role = turn.speaker;
    const label = document.createElement("b"); label.textContent = turn.speaker === "rep" ? "Agent" : "Customer";
    div.append(label, document.createTextNode(turn.text)); return div;
  }));
  $("agentMessages").scrollTop = $("agentMessages").scrollHeight;
  $("generateReply").disabled = agentSession.busy || app.turns.at(-1)?.speaker !== "customer";
}
function initializeSession() {
  $("sessionTitle").textContent = initialConfig.workspaceAgent?.name || "Voice agent";
  $("sessionDescription").textContent = sectorTemplate ? `${sectorTemplate.sector} · Browser voice · Jev decision guidance` : "Your prompt, your voice, and a clearer next step.";
  updateConnectionStatus(); renderConversation(); updateSessionControls();
}
$("editAgent").onclick = () => settingsPanel.open("agent");
function renderSignals(answers = {}) {
  if (!sectorTemplate) return;
  $("decisionSignals").hidden = false;
  $("signalReadings").replaceChildren(...[...sectorTemplate.signals.map((label, i) => [label, `signal_${i}`]), ["Human attention", "needs_human"]].map(([label, key]) => {
    const item = document.createElement("div"), title = document.createElement("span"), value = document.createElement("strong");
    title.textContent = label;
    const probability = answers[key]?.noul;
    value.textContent = Number.isFinite(probability) ? `${Math.round(Math.min(1, Math.max(0, probability)) * 100)}% likelihood` : "Waiting for context";
    item.dataset.active = String(Number.isFinite(probability) && probability >= .7);
    item.append(title, value); return item;
  }));
}
$("openConversation").onclick = () => {
  $("conversationDialog").showModal();
  $("agentMessages").scrollTop = $("agentMessages").scrollHeight;
};
$("closeConversation").onclick = () => $("conversationDialog").close();
$("conversationDialog").addEventListener("click", (event) => {
  if (event.target !== $("conversationDialog")) return;
  const bounds = event.target.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close();
});
$("generateReply").onclick = () => { voice.unlock().catch(() => {}); return agentSession.reply(); };
window.addEventListener("pagehide", () => { agentSession.end(); speech.destroy(); browserSpeech.destroy(); voice.destroy(); waveform.destroy(); jevClient.clear(); });

/* ---------- Session controls ---------- */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.querySelector("dialog[open]")) return;
  const k = e.key.toLowerCase();
  if (k === "d") markCurrentDone();
});
$("mic").addEventListener("click", async () => {
  voice.unlock().catch(() => {});
  if (agentSession.active || agentSession.busy) { await agentSession.end(); return; }
  const ready = providerConfig?.configured.openai && providerConfig?.configured.deepgram && (providerConfig?.sttProvider === "browser" || providerConfig?.configured.bandwidth);
  if (!ready) { showError("Configure OpenAI, Deepgram, and your speech input in Settings first."); settingsPanel.open(); return; }
  await agentSession.start();
});
$("done").addEventListener("click", markCurrentDone);
$("typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (agentSession.busy || !$("typeIn").value.trim()) return;
  addTurn($("typeIn").value, { speaker: "customer" });
  $("typeIn").value = ""; renderConversation();
  voice.unlock().catch(() => {}); agentSession.reply();
});

async function resetCall() {
  await agentSession.end(); assembler.reset();
  app.revision++;
  $("agentError").textContent = ""; $("agentError").hidden = true;
  clearTimeout(app.timer); app.timer = null;
  jevClient.clear(); app.resultKey = null; app.stageLabel = null;
  $("agentGuidance").dataset.status = "waiting";
  $("guidanceAction").textContent = "Waiting for a customer turn";
  $("guidanceDetail").textContent = "Suggested actions will guide the next reply.";
  app.turns = []; app.memory = createMemory(); app.result = null; app.pending = false;
  showHeard("", "customer"); showError(""); $("doneMsg").textContent = "";
  renderSignals();
  $("conversationDialog").close();
  renderStageIdle(); renderNextIdle(); renderConversation();
}
$("reset").addEventListener("click", resetCall);

/* ---------- Start ---------- */
renderStageIdle(); renderNextIdle(); renderSignals(); initializeSession();

document.querySelectorAll(".menu-items button").forEach(button => button.addEventListener("click", () => { $("sessionMenu").open = false; }));
if (new URLSearchParams(location.search).has("settings")) settingsPanel.open();
