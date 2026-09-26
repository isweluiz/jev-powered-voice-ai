# Cayana

A web voice-agent workspace with Google sign-in, Bandwidth speech recognition,
OpenAI replies, Jev decision guidance, and Deepgram speech. Browser speech
recognition is available as an alternative.

## Local development: start here

On the `codex/no-auth-local-testing` branch, local development opens the dashboard
directly, with **no authentication and no database**. All browser sessions use one
shared local workspace. This mode is for testing on your own computer.

Use **Node.js 24** (the version used by CI) and npm. Run these commands from the
repository root, where `package.json` is located:

```sh
npm ci --ignore-scripts
npm run dev
```

Open [http://127.0.0.1:3456/](http://127.0.0.1:3456/). There is no sign-in step.
The terminal should report:

```text
Cayana running at http://127.0.0.1:3456 · Local testing · No sign-in or database
```

This is the full frontend and API server. There is no separate frontend process,
build step, or hot-reload server. Google credentials, Docker, PostgreSQL, and a
`.env` file are **not required** to browse the UI, preview templates, or create and
edit local agents. A new checkout can start with no provider keys.

An existing `.env` is loaded automatically; keep it rather than copying over it.
`npm run dev` executes `node server.mjs --local`, temporarily selecting
`AUTH_MODE=local` without changing that file. This command accepts only loopback
addresses and `NODE_ENV=development` (which it defaults when unset).
It does not connect to PostgreSQL, even if `DATABASE_URL` is already configured.
Provider keys are still needed for real conversations. `npm start` retains the
configured authentication mode, defaulting to Google sign-in.

### Test the frontend

Each workspace automatically gets a saved agent for every sector template:
Sales discovery, Customer concierge, IT service desk, Shipment intake, Guest
experience, and Service visit intake. Open **My agents → Start talking** to use
one immediately, then select **Start voice session** when ready to enable the
microphone. Provider keys are still required for a live conversation.

Starter agents inherit the current workspace model, voice, and STT choice when
first created. They are editable and saved like your other agents. Refreshing,
restarting, or changing workspace defaults does not overwrite their settings or
create duplicates. Google accounts receive their own separate copies.

1. Open the app directly and check Home, Talk, My agents, and Templates. Verify the
   starter agents appear and **Start talking** opens the selected agent's workspace.
2. Click **Create web agent**. Search or filter templates, open a preview, and
   select **Use this template**. Also try **Write my own prompt**.
3. Give a test agent a recognizable name, customize its objective and prompt, and
   save it. Reopen it from My agents and verify that its settings were retained.
4. Open Connections & settings and switch between its tabs. Check the navigation
   drawer, template dialog, agent cards, and transcript at a narrow viewport.
5. For a live conversation, configure the providers below, open Talk or a saved
   agent, and send a short synthetic message. Check the reply, Jev guidance,
   progress display, and transcript. Select **Start voice session** only when you
   are ready to grant microphone access and test speech. Use **End session** to stop.

UI-only checks do not call the speech or reply providers. Sending messages,
generating replies, previewing a voice, and starting a voice session make real
provider requests and can consume credits.

### Add keys when testing conversations

Use **Connections & settings → Connections**, or configure these variables in a
private `.env`:

| Provider | Environment variable | Used for |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | Generating text replies |
| Jev | `TYPESAFE_API_KEY` | Decision signals and suggested actions |
| Deepgram | `DEEPGRAM_API_KEY` | Spoken replies and voice previews |
| Bandwidth | `BW_STT_API_KEY` | Microphone transcription when Bandwidth is selected |

For a new `.env` only, this shell command preserves any existing file:

```sh
test -f .env || cp .env.example .env
chmod 600 .env
```

Choose **Voice → Browser speech recognition** to test without a Bandwidth key;
availability depends on the browser's speech service. Typed replies require an
OpenAI key, with Jev providing guidance when configured and available. Deepgram is
optional for typed replies; without it, replies remain text. A voice session
requires OpenAI, Deepgram, and either Bandwidth or browser speech recognition.
Configure Jev as well to test the complete decision-guided flow.

Blank key fields keep existing keys. Changes to provider keys and the default
agent settings stay in server memory unless **Remember on this computer** is
selected. That option saves them to the ignored `.env` with owner-only permissions;
the file is plaintext. Saved web agents persist separately in
`.cayana/agents.json`, also ignored by Git. Transcripts remain in page memory and
are lost on reload. There are no separate user accounts in no-login mode: browser
tabs share provider keys, defaults, and saved agents, while each tab keeps its own
conversation in memory. Agents previously saved through developer sign-in remain
on disk under that profile; use `npm run dev:auth` to access them.

### Reload, stop, and troubleshoot

- Refresh the browser after HTML, CSS, or browser-only JavaScript changes in
  `public/`; static files are served directly. `public/templates.js` and
  `public/playbook.js` are also imported by the server, so restart after changing them.
- Restart with **Ctrl+C**, then `npm run dev`, after server/module or `.env` changes.
  Refresh the browser after restarting. Preserve any settings you want to
  keep before stopping; saved agent files survive a restart.
- If a login screen appears, confirm you are on this branch and restart with
  `npm run dev`. Visiting `/login` in no-login mode redirects to the dashboard.
  `npm run dev:auth` intentionally shows developer sign-in instead.
- If startup fails with a production `NODE_ENV`, public `HOST`, or non-local
  `APP_BASE_URL` inherited from another setup, use command-scoped local overrides.
  For example, to use port 3457 without rewriting `.env` (macOS/Linux):

  ```sh
  NODE_ENV=development HOST=127.0.0.1 PORT=3457 APP_BASE_URL=http://127.0.0.1:3457 npm run dev
  ```

  Open the matching URL. Keep `APP_BASE_URL`, `PORT`, and the browser origin aligned;
  `localhost` and `127.0.0.1` are distinct origins when `APP_BASE_URL` is set.
- If the port is occupied, check the existing service before starting another:

  ```sh
  lsof -nP -iTCP:3456 -sTCP:LISTEN
  curl --fail --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' http://127.0.0.1:3456/
  ```

  The dashboard should return HTTP 200 without a session cookie. Stop only the Cayana process you
  own, or choose a free port; do not terminate unrelated services.
- A “Keys configured” indicator only confirms that values exist. Provider errors
  need a real request to diagnose. Browser recognition may be unavailable even
  when the rest of the application works.

See [Validation](#validation) for automated tests and [AGENTS.md](AGENTS.md) for
repository instructions for coding agents.

## Run with Google sign-in and PostgreSQL

Use this path when testing real Google accounts and database-backed user isolation.
Use Node.js 24 and Docker Compose:

```sh
npm ci --omit=dev --ignore-scripts
test -f .env || cp .env.example .env
chmod 600 .env
# Fill in the database passwords, DATABASE_URL and Google settings below.
docker compose up -d postgres
npm start
```

The PostgreSQL 18 container binds to `127.0.0.1:54329` and keeps its data in the
`osprey_postgres_data` Docker volume. Set unique `POSTGRES_PASSWORD` and
`OSPREY_DB_PASSWORD` values. `DATABASE_URL` uses the `osprey` user and its password;
the app does not run as a PostgreSQL superuser. Migrations run automatically on
startup under a database lock. Initialization passwords apply only to a new volume;
changing `.env` alone does not rotate an existing database password. `npm run db:stop`
stops the container without deleting data. Keep database backups before upgrading
PostgreSQL; do not delete the volume to repair a connection problem.

Cayana retains the existing `osprey` database, Docker storage, and session-cookie
identifiers so the name change does not require a data migration or signing in again.

Open http://127.0.0.1:3456, sign in with Google, and select **Settings**. Administrators can enter your Bandwidth STT,
Deepgram TTS, Jev, and OpenAI API keys. Choose **Bandwidth STT** or **Browser speech
recognition** for microphone input. Browser recognition needs no STT key, depends
on the browser's speech service, and stops on connection errors instead of retrying
indefinitely. Bandwidth is the default; there is no silent provider fallback.

## Conversation workspace and web agents

Overview uses the supplied Metrix design: charcoal panels, orange accents, Geist
typography, Geist Mono figures, and compact navigation. The workspace uses a single
dark theme across Overview, agents, templates, the builder, settings, and Talk. **Start talking** opens the voice agent with your account’s
default prompt and voice. Live coach and its legacy desktop overlays have been
removed; old coaching URLs redirect to Talk.

**Create web agent** opens a searchable template picker with category navigation
and previews before the builder. Six sector templates are available: sales discovery,
customer service, IT support, logistics, hospitality, and field service. Each
contains an editable system prompt, a conversation objective, sector-specific Jev
questions, four progress stages, suggested actions, and a human-attention signal.
**Write my own prompt** starts with a generic decision playbook and opens the
editable prompt. Add company facts, select a voice and speech provider, then save
or open the agent in Talk. My agents supports reopening and editing saved configurations.

For a saved agent, the server resolves ownership before reading its configuration
or calling a provider. Jev evaluates that agent’s sector questions; the matching
playbook supplies bounded guidance to the reply model. The voice workspace shows
the sector’s progress stages and signal probabilities. A human-attention probability
of at least 0.7 prioritizes **Involve a person**, including after an ordinary
suggestion was marked done. This is a conversational recommendation, not an actual
transfer or an authorization to perform an external action.

Google accounts store private agents in PostgreSQL (`002-agents.sql`). Local and
developer mode store them in `.cayana/agents.json`, with owner-only file permissions;
the directory is excluded from Git. Agent prompts and voice preferences persist
independently of account defaults. Provider keys remain shared server connections.
Conversations still live only in browser memory.

These are authenticated browser voice agents. Public website embedding, phone
numbers, inbound/outbound telephone calls, CRM updates, bookings, and call transfers
are not implemented. There are no fabricated usage or performance statistics in
the home screen; connection indicators report whether keys are configured, not a
live provider health check.

## Google sign-in and accounts

In Google mode (`npm start` by default), the minimalist login screen is at `/login`.
Authentication is required,
including provider APIs, settings, dashboard assets, and audio WebSocket connections.
An incomplete Google setup keeps access closed.

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients), create
   an OAuth client of type **Web application**. Configure an **External** audience
   to support Gmail and other Google accounts. While the Google project is in
   testing, its test-user restrictions still apply; configure publishing and any
   requirements shown in Google’s console before a broader rollout.
2. Add the exact authorized redirect URI:
   `http://127.0.0.1:3456/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `APP_BASE_URL=http://127.0.0.1:3456` in the server’s private `.env`, then restart.
   OAuth credentials never belong in frontend code.
4. `AUTH_ALLOW_ANY_GOOGLE_ACCOUNT=true` permits any verified Google account.
   `AUTH_ADMIN_EMAILS` is a comma-separated list of verified account emails allowed
   to change shared provider keys. Leave it blank to manage keys exclusively through
   server configuration. A new user is never automatically an administrator.
5. To restrict access later, set `AUTH_ALLOW_ANY_GOOGLE_ACCOUNT=false` and configure
   `AUTH_ALLOWED_EMAILS` and/or `AUTH_ALLOWED_DOMAINS`. Domains match Google’s verified
   Workspace `hd` claim, not an unverified email suffix.

The server uses Google’s authorization-code flow with PKCE, state, nonce, and
verified ID tokens. It identifies users by Google’s stable subject ID. PostgreSQL
stores profile details (name, email, Google subject/domain), per-user agent/voice
preferences, expiring login transactions, and sessions. Google access/refresh tokens
and provider API keys are not stored in these tables. Session cookies are HttpOnly,
SameSite=Lax, and Secure on HTTPS; only their hashes are stored in PostgreSQL. Login
sessions expire after eight hours. Sign out revokes the session and its open STT
connection. Requests also require an origin check and a per-session CSRF token.

Users have independent prompts, model selections, STT choices, and TTS voices.
These preferences survive browser and server restarts. Provider keys and provider
billing are shared by the workspace. Transcripts remain in browser memory; no
conversation history or lead records are persisted yet. Concurrent STT, reply,
and TTS capacity defaults to eight of each per Node process, with one active stream
or generation of each type per user. `MAX_CONCURRENT_STT`, `MAX_CONCURRENT_REPLIES`,
and `MAX_CONCURRENT_TTS` configure those caps. This is an initial multi-user foundation,
not a load-tested or quota-managed deployment; process-wide capacity is not coordinated
between replicas.

For an internal deployment, use an HTTPS reverse proxy with WebSocket support, set
`APP_BASE_URL` to the exact public HTTPS origin, preserve the incoming `Host` header,
and register its `/api/auth/google/callback` with Google. Set `HOST=0.0.0.0` only
behind that proxy and keep Node and PostgreSQL off the public network. With the
any-Google-account policy, internal-only access must be enforced by the network.
The server does not trust forwarded host headers or arbitrary redirect URLs.

### Authentication modes

| Command | Authentication | Storage |
| --- | --- | --- |
| `npm run dev` | None; one shared local workspace | Local files; no PostgreSQL |
| `npm run dev:auth` | **Continue as developer** at `/login` | Local files and in-memory sessions; no PostgreSQL |
| `npm start` | Google by default; follows the environment | PostgreSQL for Google accounts and saved agents |

Both development commands default `NODE_ENV` to `development` and refuse an
existing production value or a public network address. They override `AUTH_MODE`
only for that process, without rewriting `.env`. Developer sign-in sessions use
separate cookies and do not modify Google accounts or database records. The
developer sign-in endpoint is unavailable in Google mode, even when
`NODE_ENV=development`. Stop the dev server and run `npm start` to return to the
authentication mode in your environment (`google` by default).

`AUTH_MODE=local` is the existing database-free mode used by `npm run dev` on this
branch. It has no per-user isolation: everyone using that process can manage the
same provider keys and local agents. It refuses to bind to a non-loopback address.
Use the Google/PostgreSQL path for a shared deployment.

## Demo analytics and conversation logs

Overview includes four metrics calculated from eight fictional reference logs,
searchable and sortable recent conversations, and a separately labeled illustrative
activity chart with weekly/monthly/yearly views. **Conversation logs** opens the
sample transcript, outcome, and suggested next step; **Try this agent** opens the
matching saved agent. Workspace search (Cmd/Ctrl+K) finds pages, agents, and samples.

These panels are labeled sample data. They are not live usage analytics or stored
user recordings. The example Jev summary is supplied demo text, not a fresh API
result. Existing provider integrations continue to power Talk; this design update
does not substitute scripted replies for real conversations. No telephony, booking,
CRM, account-modification, or transfer tools are added.

## Voice and playback

**Start voice session** uses your microphone. Settings includes a voice selector
and a preview using the saved Deepgram key.

The voice channel replaces the native audio player with an audio-reactive waveform
and Pause/Resume/Stop controls. Deepgram's REST response is relayed immediately as
24 kHz mono PCM16, and Web Audio plays 100 ms frames while later audio is arriving.
The waveform measures actual output audio (and microphone audio in Bandwidth mode).
Browser STT exposes no audio samples, so its listening indicator stays flat.
If browser autoplay blocks playback, press **Play voice**. Stop cancels the request
and all queued audio. Audio remains in memory and is never saved as a file.
The player reads the sample rate from the standard PCM content type and also accepts
the custom rate header. Older MP3/WAV responses use browser decoding and the same
waveform controls; those compatibility responses finish downloading before playback.

## Voice agent workspace

The compact desktop layout places progress, Jev guidance, the waveform, and sector
signals beside a visible, automatically scrolling transcript. Agent pills let you
open another saved agent in a fresh session. Smaller screens stack these panels
and allow normal scrolling so content stays readable.
**Edit prompt** opens agent configuration without leaving the session.
Shared semantic tokens and native HTML controls keep focus, keyboard, and Escape
behavior consistent without a component framework.

In **Settings → Agent**, configure the OpenAI
model and system prompt with your company facts, sales approach, and qualification
criteria. The default is `gpt-4.1-mini`, a low-latency text model; you can enter
another Responses-compatible model ID that your account supports.

**Start voice session** listens for a customer turn, waits about 1.4 seconds after
the last transcript update, drains final speech results, gets Jev's suggested
action for that exact transcript, generates a reply through OpenAI's Responses API,
and streams the resulting speech with Deepgram. The microphone resumes after
playback. This is a half-duplex prototype: it pauses capture during generation and
playback, does not support speaking over the agent, and uses a transcript pause
heuristic rather than semantic end-of-turn detection. Long pauses can end a turn
early. **End session** cancels pending work and prevents late replies from playing.

Typing a message generates a reply without starting a microphone. With no Deepgram
key, the generated reply remains readable as text. **Generate reply** can retry the
latest customer turn. Jev evaluates the conversation and its suggested action now
guides OpenAI's reply; Jev itself does not generate the spoken reply.
The **Agent guidance** note in the Suggested action card shows the action used for each reply. The gauge and agent
share evaluations of identical transcripts; final STT changes trigger a fresh
request. The agent waits up to six seconds for guidance, then explicitly continues
without it if Jev is unavailable. It never substitutes an older turn's guidance.
Only known playbook actions/tips, buying stage, and confidence reach the prompt.
Guidance is advisory: the system prompt remains primary, and suggestions do not
authorize invented prices, available meeting times, or completed external actions.
The LLM still completes each text reply before TTS starts; this is streamed audio
playback, not token-to-audio streaming or full-duplex conversation. No CRM, booking, calling, or lead-storage tools are
connected. This interface is a local voice-agent conversation, not a telephony deployment.

OpenAI receives the system prompt and the last 40 turns, with at most 2,000
characters per turn. Responses use `store: false`; provider-side retention is
subject to the provider's account policies. Conversation history stays in page
memory and is lost on reload. Keys are excluded from prompts and transcripts.

## API keys

The frontend is only the entry form. Provider requests originate on the Node
server, which never returns keys to the browser. Keys are not stored in browser
storage or sent in WebSocket URLs. Settings shows only whether each key exists;
“configured” does not mean the provider has accepted it. Using a service tests its key.

- **Google mode:** agent and voice preferences are saved to the signed-in user’s
  PostgreSQL account. Administrators can change shared keys for the current server
  process or choose **Save changed provider keys on the server** to persist them
  in the private `.env`. Regular members only see connection status.
- **Local/developer mode / session only (default):** default preferences and keys live in server memory until it stops. Saved web agents persist separately.
- **Local/developer mode / Remember on this computer:** explicitly saves all current keys, the STT choice,
  the TTS voice, and agent configuration into `.env` with owner-only file permissions. This is plaintext
  local storage, not encryption. Blank key fields retain the existing value; a
  Remove checkbox clears it. Check Remember to make removals survive a restart.
- **Manual setup:** for a new file, copy `.env.example` to `.env` and fill in the keys. Preserve an existing `.env`. It is
  loaded automatically on startup and ignored by Git. The parent process's
  environment takes precedence over `.env`; UI changes override it for the current
  process. Avoid exporting stale keys when restarting with a saved `.env`.

Environment variables: `BW_STT_API_KEY`, `DEEPGRAM_API_KEY`, `TYPESAFE_API_KEY`,
`OPENAI_API_KEY`, `OPENAI_MODEL`, `STT_PROVIDER` (`bandwidth` or `browser`), and
`DEEPGRAM_TTS_MODEL`. The UI saves the system prompt as `AGENT_SYSTEM_PROMPT_BASE64`
to preserve arbitrary quotes and newlines; this encoding is not encryption. For
manual setup, `AGENT_SYSTEM_PROMPT` is also accepted.
`PORT` and `TYPESAFE_MODEL` are optional process environment variables.

The server binds to `127.0.0.1` by default. In Google mode it authenticates HTTP and
WebSocket access, validates hosts and origins, and authorizes settings changes by role.

## Data flow

```
Microphone → localhost WebSocket → Bandwidth STT ─┐
Microphone → browser recognition service ───────┼→ transcript
Typed message ─────────────────────────────────┘
                                                ↓
                          localhost → Jev → suggested action + signals
                                                ↓
                          localhost → OpenAI + system prompt → reply
                                                                ↓
                          browser audio ← localhost ← Deepgram speech

The same Jev evaluation updates the progress and suggested-action cards.
If Jev is unavailable, the reply continues using the system prompt alone.
```

Bandwidth uses 16 kHz mono PCM16 in 160 ms frames. Final `Segment.text` deltas are
concatenated verbatim, including subword pieces. Stop flushes the final audio frame,
sends CloseStream, and drains results through SessionClosed. Connections have
bounded startup/shutdown times and backpressure limits. Audio and transcripts are
not written to disk by the application. Only the last 40 turns (1,500 characters
per turn) are sent to Jev.

Microphone audio leaves this computer for Bandwidth in Bandwidth mode, or
for the browser's recognition service in browser mode. Conversation text goes to
Jev. Conversation text and your system prompt also go to OpenAI.
Generated replies and voice-preview text go to Deepgram. Grant microphone permission and
use these services only for conversations you intend to send to those providers.

## Structure

```
server.mjs              HTTP server, authentication gates and provider proxies
compose.yaml            PostgreSQL container with a persistent volume
docker/init-db.sh       Least-privilege app database/user initialization
migrations/001-auth.sql Users, preferences, sessions and login transactions
migrations/002-agents.sql Private per-user web agents
lib/auth.mjs            Google OAuth, identity policy and session lifecycle
lib/agents.mjs          Agent validation and private local development storage
lib/database.mjs        Parameterized PostgreSQL store and migrations
lib/runtime.mjs         Environment loading and capacity configuration
lib/agent.mjs           OpenAI Responses integration and prompt handling
lib/settings.mjs        Session configuration and optional .env persistence
lib/bandwidth.mjs       Authenticated Bandwidth WebSocket relay
schema.json             Jev questions
public/home.html        Home, template gallery, agent list and builder
public/home.js          Agent creation, editing and workspace navigation
public/home.css         Base workspace and builder layout
public/material.css     Shared dark semantic tokens and controls
public/metrix.css       Metrix dashboard, cards, logs, and voice layout
public/dashboard.js     Overview interactions, agent cards, and sample log views
public/demo-data.js     Fictional reference logs and analytics helpers
public/theme.js         Initializes the shared dark theme
public/template-picker.js  Search, categories, prompt previews
public/template-picker.css Responsive template dialog
public/shell.js         Shared sidebar and account navigation
public/shell.css        Responsive sidebar and shared workspace styling
public/templates.js     Sector prompts, Jev questions and decision playbooks
public/index.html       Voice-agent conversation workspace
public/session.js       Voice session, evaluation and transcript controls
public/session.css      Progress gauge and decision display
public/login.html       Minimal Google sign-in screen
public/login.css        Sign-in layout
public/login.js         Google sign-in availability and error handling
public/account.js       Signed-in account menu and sign-out
public/settings.js      Key-entry dialog and settings requests
public/settings.css     Settings styling
public/workspace.css    Base voice-session layout
public/agent-session.js Half-duplex voice-agent lifecycle and guidance handoff
public/jev-client.js     Shared evaluations keyed to the exact transcript
public/waveform.js       Audio-reactive voice waveform
public/speech.js         Capture, transcript assembly, browser STT, playback
public/pcm-worklet.js    Audio framing and Float32 → PCM16 conversion
public/decide.js         Local decision logic
public/playbook.js       Coaching actions and tips
test/                   Offline provider and audio lifecycle tests
```

## Validation

```sh
npm ci --ignore-scripts
npm run lint
npm test
```

These checks do not require a running app or Docker. Tests start temporary local
HTTP/WebSocket servers and use temporary directories for fixtures. `npm test`
skips the PostgreSQL test unless `TEST_DATABASE_URL` is set; this is expected for
the frontend-only development workflow.

For the optional database check, configure a local test database using the
[PostgreSQL setup](#run-with-google-sign-in-and-postgresql), then run:

```sh
npm run db:up
npm run test:db
```

`test:db` reads `DATABASE_URL` from `.env` or the process environment and runs only
the database test. It creates a random temporary schema, runs migrations and
isolation checks there, and drops only that schema afterward. Use a local test
database whose user can create schemas; do not point it at a production database.
When finished, `npm run db:stop` stops PostgreSQL and preserves its volume. If it
was already running for another local task, leave that shared service running.

`npm audit --omit=dev` is a separate dependency check that requires registry
access. In a restricted coding-agent sandbox, server startup, HTTP verification,
or socket-based tests may need permission to bind/connect to loopback. A sandbox
socket denial is not evidence that the app's authentication should be bypassed.

Core tests use local fake providers and dummy credentials; they do not record a
microphone or call paid APIs. Real Bandwidth and Deepgram validation requires your
keys, provider access, and a microphone/playback check on the target browser.
Authentication tests cover two-user preference and prompt isolation, administrator
authorization, login replay/nonce/expiry checks, session rotation, CSRF, and WebSocket
revocation. Developer sign-in tests cover production/localhost restrictions,
cross-site rejection, cookie separation, expiration, sign-out, and database independence.
The opt-in PostgreSQL test verifies migrations, durable sessions/preferences,
and one-use login transactions. A real Google roundtrip still needs your OAuth client
credentials and consent configuration.

GitHub Actions runs ESLint (including inline scripts in HTML), the test suite with
a disposable PostgreSQL service, a production dependency audit, and a Gitleaks
secret scan on pushes and pull requests. Actions have read-only repository
permissions and are pinned to commit SHAs. The pipeline does not need real API keys
or Google credentials.

`.gitignore` excludes `.env` files and backups, credential exports, private keys,
dependencies, logs, database dumps, and local editor/assistant files. Only
`.env.example`, containing placeholders, belongs in Git. Ignore rules do not remove
an already committed secret: rotate exposed credentials and remove them from Git
history before publishing. Keep real keys in your server environment or a secret
manager, never in source code, screenshots, or workflow files.

Provider references:
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.google.com/identity/branding-guidelines
- https://labs.bandwidth.com/docs/speech-to-text
- https://developers.deepgram.com/reference/text-to-speech/speak-request
- https://developers.deepgram.com/docs/streaming-the-audio-output
- https://docs.typesafe.ai/api
- https://developers.openai.com/api/docs/guides/text
