# Cayana

A sales-call workspace with Google sign-in, Bandwidth speech recognition, Jev call analysis, and
Deepgram spoken coaching. Browser speech recognition is available as an alternative.
Voice agent mode uses OpenAI to generate sales or lead-qualification replies.

## Run

Use Node.js 22 or newer and Docker Compose:

```sh
npm ci --omit=dev --ignore-scripts
cp .env.example .env  # only for a new setup; keep an existing .env
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
Deepgram TTS, Jev, and OpenAI API keys (OpenAI is needed only for Voice agent mode). Choose **Bandwidth STT** or **Browser speech
recognition** for microphone input. Browser recognition needs no STT key, depends
on the browser's speech service, and stops on connection errors instead of retrying
indefinitely. Bandwidth is the default; there is no silent provider fallback.

## Conversation workspace and web agents

After sign-in, Home opens a sidebar workspace using the same light sky palette as
the login page. **Start talking** opens the existing voice agent with your account’s
default prompt and voice. **Live coach** retains the compact coaching dashboard,
capture controls, waveform, and conversation tools.

**Create web agent** opens a builder with six sector templates: sales discovery,
customer service, IT support, logistics, hospitality, and field service. Each
contains an editable system prompt, a conversation objective, sector-specific Jev
questions, four progress stages, suggested actions, and a human-attention signal.
Add company facts, select a voice and speech provider, then save or open the agent
in Talk. My agents supports reopening and editing saved configurations.

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

The minimalist login screen is at `/login`. Authentication is required by default,
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

### Local developer sign-in

Run `npm run dev`, open `http://127.0.0.1:3456/login`, and choose **Continue as
developer**. This starts a local administrator session without Google credentials
or PostgreSQL. The account menu identifies it as development access and supports
sign-out. Provider requests use your configured keys as usual.

The command temporarily selects `AUTH_MODE=development` and defaults `NODE_ENV`
to `development`; it does not modify `.env`. Developer mode requires
`NODE_ENV=development`, a loopback `HOST`, and a loopback `APP_BASE_URL` if set.
It refuses production mode or a public address. The developer sign-in endpoint
is unavailable in Google mode, even when `NODE_ENV=development`.

Developer sessions use separate HttpOnly cookies, expire after eight hours, and
are lost when the server stops. Google accounts and database records are untouched.
Agent settings and provider key changes last for this server process unless you
choose **Remember on this computer**, which saves them in the private local `.env`.
Stop the dev server and run `npm start` to use the Google configuration again.

For a deliberate single-user localhost setup only, `AUTH_MODE=local` disables
Google/DB login and restores local settings behavior. It refuses to bind to a
non-loopback address. Do not use this mode for a shared deployment.

## Live coaching

**Start listening** captures your microphone. **Capture call** shares audio from a
browser-supported tab/screen source and always uses Bandwidth; available sources
and system-audio support vary by browser and OS. Choose a source that offers audio
and enable Share audio. Speaker buttons identify whose turn is being recorded;
switching speakers finishes the current stream before starting the next.

**Read aloud** uses Deepgram to speak the displayed coaching action and first tip.
It stops listening first so the coaching is not transcribed back into the call.
Press Start listening to resume. Settings includes a voice selector and a preview
using the saved Deepgram key. In Live coach mode, spoken output is on demand.

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

Typed input and **Run sample call** work with just the Jev key. The sample sends
fictional text through the real API; it does not play a recorded call.

## Voice agent mode

Select **Voice agent** in the header. Both modes share the same buying-stage gauge,
Suggested action card, and voice-channel layout. The compact desktop layout places
stage and action side by side, with the waveform and latest reply below.
**View transcript** opens the complete conversation in a scrollable drawer without
moving the dashboard. Smaller screens stack the cards and allow normal scrolling
so content stays readable. The light/dark theme uses the blue, navy, purple, green,
and orange palette from [Bandwidth’s website](https://www.bandwidth.com/), with
contrasting shades for text and controls. **Edit prompt** opens
the agent configuration without leaving the dashboard.

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
- **Local mode / session only (default):** changes live in server memory until it stops.
- **Local mode / Remember on this computer:** explicitly saves all current keys, the STT choice,
  the TTS voice, and agent configuration into `.env` with owner-only file permissions. This is plaintext
  local storage, not encryption. Blank key fields retain the existing value; a
  Remove checkbox clears it. Check Remember to make removals survive a restart.
- **Manual setup:** copy `.env.example` to `.env` and fill in the keys. `.env` is
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
Microphone / shared audio → localhost WebSocket → Bandwidth STT
Browser speech mode     → browser recognition service
                         ↓ text
                  localhost → Jev → on-screen coaching
                                      ↓ Read aloud
                               localhost → Deepgram → audio

Voice agent: STT → Jev suggested action → OpenAI + system prompt → reply
                                                    ↓
                               localhost → Deepgram → audio
            The same Jev evaluation updates the buying-stage display.
```

Bandwidth uses 16 kHz mono PCM16 in 160 ms frames. Final `Segment.text` deltas are
concatenated verbatim, including subword pieces. Stop flushes the final audio frame,
sends CloseStream, and drains results through SessionClosed. Connections have
bounded startup/shutdown times and backpressure limits. Audio and transcripts are
not written to disk by the application. Only the last 40 turns (1,500 characters
per turn) are sent to Jev.

Microphone/shared audio leaves this computer for Bandwidth in Bandwidth mode, or
for the browser's recognition service in browser mode. Conversation text goes to
Jev. In Voice agent mode, conversation text and your system prompt also go to OpenAI.
Text selected for Read aloud and generated agent replies go to Deepgram. Grant capture permission and
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
public/home.css         Light workspace and builder layout
public/shell.js         Shared sidebar and account navigation
public/shell.css        Responsive sidebar and shared workspace styling
public/templates.js     Sector prompts, Jev questions and decision playbooks
public/index.html       Voice-agent and live-coach conversation workspace
public/login.html       Minimal Google sign-in screen
public/login.css        Responsive sky background and translucent card
public/login.js         Google sign-in availability and error handling
public/account.js       Signed-in account menu and sign-out
public/settings.js      Key-entry dialog and settings requests
public/settings.css     Settings styling
public/workspace.css    Workspace header, mode navigation, conversation UI
public/agent-session.js Half-duplex voice-agent lifecycle and guidance handoff
public/jev-client.js     Shared evaluations keyed to the exact transcript
public/waveform.js       Audio-reactive voice waveform
public/speech.js         Capture, transcript assembly, browser STT, playback
public/pcm-worklet.js    Audio framing and Float32 → PCM16 conversion
public/dashboard.html   Transcript and signals dashboard
public/decide.js         Local decision logic
public/playbook.js       Coaching actions and tips
test/                   Offline provider and audio lifecycle tests
```

The optional Electron overlay remains in `electron.js` and `preload.js`. Its
existing Electron dependency is not installed by the browser setup above and
needs a separate security upgrade before use. Local Whisper was replaced and its
large runtime dependencies were removed.

## Validation

```sh
npm ci --ignore-scripts  # development tools; skips the optional Electron download
npm run lint
npm test
npm run test:db          # uses DATABASE_URL; isolates data in a temporary schema
npm audit --omit=dev
```

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
