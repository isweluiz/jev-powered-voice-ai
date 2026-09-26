# Working on Cayana

## Project context

Cayana is a Node.js web voice-agent application. The server serves vanilla
HTML/CSS/JavaScript from `public/`; there is no frontend bundler or separate UI
server. Bandwidth or browser recognition supplies STT, Jev evaluates the
conversation, OpenAI generates replies, and Deepgram supplies TTS. Live coach and
the Electron overlay have been removed.

Read `package.json`, the relevant source, and `README.md` before changing startup
or provider behavior. Keep changes scoped to the request and preserve unrelated
worktree changes. Do not infer current behavior from the old Call Coach name or
the retained `osprey` database identifiers.

## Start local development

Run commands from the repository root. Use Node.js 24 and npm, matching CI.

```sh
npm ci --ignore-scripts
npm run dev
```

On `codex/no-auth-local-testing`, open `http://127.0.0.1:3456/` directly. This runs
the full frontend and API without sign-in. Google credentials,
Docker, PostgreSQL, and a `.env` file are not needed for UI testing. Live provider
requests still require the relevant keys.

- `npm run dev` executes `node server.mjs --local`, selects `AUTH_MODE=local`,
  and defaults `NODE_ENV` to `development`. It does not rewrite `.env`.
- `npm run dev:auth` retains `node server.mjs --dev` and the **Continue as developer**
  flow at `/login`. Both commands bypass PostgreSQL, even with `DATABASE_URL` set.
- Both development commands require a loopback `HOST` and loopback `APP_BASE_URL` when set.
  It refuses production `NODE_ENV` and public network addresses.
- An existing `.env` is loaded automatically. Process environment values take
  precedence. Preserve the file and do not print its contents or secret values.
- If another environment supplies incompatible values, use temporary overrides
  instead of editing that configuration (macOS/Linux):

  ```sh
  NODE_ENV=development HOST=127.0.0.1 PORT=3457 APP_BASE_URL=http://127.0.0.1:3457 npm run dev
  ```

  Use the matching browser URL; `APP_BASE_URL` and `PORT` must agree. Do not mix
  `localhost` and `127.0.0.1` when the application has an explicit origin.
- `npm start` follows the configured authentication mode, defaulting to Google.
  Preserve that default; this branch's no-login behavior is selected by `npm run dev`.
  No-login mode shares one workspace and provider keys across browser sessions;
  it is not a multi-user deployment mode.

Before launching another instance, check the port and verify the page:

```sh
lsof -nP -iTCP:3456 -sTCP:LISTEN
curl --fail --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' http://127.0.0.1:3456/
```

A successful no-login launch needs both a listener and an HTTP 200 response from
`/` without cookies. `/login` redirects to `/` in local mode. Google and developer
sign-in modes still redirect anonymous requests to `/login`. Reuse a healthy
existing instance. Never kill unrelated processes to free a port.

Refresh the browser for HTML, CSS, and browser-only JavaScript changes. The server
also imports `public/templates.js` and `public/playbook.js`; restart when those
change. Restart the app with Ctrl+C and `npm run dev` when server-side modules or
environment values change. The command
does not watch files automatically. Restarting discards unsaved in-memory settings
and expires sessions in `dev:auth`; preserve settings that need to survive using
the user's authorized persistence choice. Do not restart Docker for frontend work.

## Data and secrets

- Saved local/developer agents are in `.cayana/agents.json` under separate profiles;
  preserve existing agents. Use `dev:auth` to access agents created through developer
  sign-in. Google users and their saved agents use PostgreSQL.
- Default preferences and provider-key changes remain in process memory unless
  explicitly saved through **Remember on this computer**. Saved web-agent
  configurations persist independently of those defaults.
- `.env` and `.cayana/` are ignored. They hold private local data and must not be
  staged, included in screenshots, or copied into fixtures or documentation.
- Keep examples in `.env.example` placeholder-only. Create `.env` only if missing;
  never overwrite an existing file with the example.
- Browser settings collect keys, but keys stay server-side. Do not expose them in
  frontend source, browser storage, URLs, logs, prompts, or API responses.
- Google mode is the shared-user path. Follow the README's Google/PostgreSQL setup
  when testing real accounts. Preserve the existing database volume and migrations;
  do not reset or delete a volume to repair a startup issue.

## Validate changes

```sh
npm run lint
npm test
```

Use the checks appropriate to the change. Do not add tests for a documentation-only
or simple styling edit. For application changes, lint and run the relevant existing
tests; run the complete suite before publishing a substantive behavior change.

Tests use dummy credentials, temporary storage, and local fake HTTP/WebSocket
providers. They do not need a running Cayana server or real provider keys and do
not record audio. The PostgreSQL test is skipped unless `TEST_DATABASE_URL` is set.
In restricted sandboxes, request the tool's normal permission for loopback binding
or connectivity when needed; do not weaken the application's Host, Origin, CSRF,
authentication, or ownership checks to make tests pass.

Optional checks:

```sh
npm run test:db
npm audit --omit=dev
```

`test:db` loads `DATABASE_URL` from the environment or `.env` and tests against a
real database using a temporary schema that it removes afterward. Use a local test
database with schema-creation permission. Docker is needed only if using this
repository's PostgreSQL container (`npm run db:up`, `npm run db:stop`). Dependency
auditing requires registry access. CI runs lint, the full suite with a disposable
PostgreSQL service, a production dependency audit, and secret scanning.

For UI changes, verify the affected flow in the browser: direct no-login startup
(or developer sign-in when using `dev:auth`), Home,
template search/filter/preview, custom-prompt creation, save/reopen/edit, settings,
and the voice workspace as relevant. Check narrow layouts and keyboard interaction
for navigation/dialog changes. A provider “configured” badge checks key presence;
it does not prove that the service accepts the key or that audio works. Keep
UI-only checks separate from live microphone/provider tests. Live requests can
consume credits; only perform them within the user's requested testing scope.

## Source map and conventions

| Area | Files |
| --- | --- |
| HTTP routes, static serving, provider orchestration | `server.mjs` |
| Environment and shared settings | `lib/runtime.mjs`, `lib/settings.mjs` |
| Google/developer auth and user ownership | `lib/auth.mjs`, `lib/database.mjs`, `lib/agents.mjs`, `migrations/` |
| Home, saved agents, builder | `public/home.html`, `public/home.js`, `public/home.css` |
| Dashboard and sample logs | `public/dashboard.js`, `public/demo-data.js`, `public/metrix.css` |
| Templates and picker | `public/templates.js`, `public/template-picker.js`, `public/template-picker.css` |
| Dark theme and compact navigation | `public/material.css`, `public/theme.js`, `public/shell.js`, `public/shell.css` |
| Voice-session UI and lifecycle | `public/index.html`, `public/session.js`, `public/workspace.css`, `public/agent-session.js` |
| STT, TTS, waveform, evaluation | `lib/bandwidth.mjs`, `lib/agent.mjs`, `public/speech.js`, `public/waveform.js`, `public/jev-client.js` |
| Decisions and default evaluation questions | `public/decide.js`, `public/playbook.js`, `schema.json` |
| Automated checks | `test/`, `eslint.config.mjs`, `.github/workflows/ci.yml` |

Use the shared Metrix dark theme (charcoal panels, orange accents, Geist/Geist Mono)
and existing semantic tokens. Keep sample analytics and logs clearly labeled; never
present them as actual user history or live provider results. Keep navigation compact
(12px labels, 18px icons); do not restore the removed Personal workspace block or
Live coach. Preserve existing file line endings, particularly the CRLF in
`public/index.html`. Browser modules and server `.mjs` files use ES modules; follow
the current package setup rather than introducing a bundler for small changes.

Before a task-authorized commit/push, inspect status, fetch the target remote, and
check divergence. This fork's `origin` is `isweluiz/jev-powered-voice-ai`; the
original repository is `upstream`. Use `--repo isweluiz/jev-powered-voice-ai` with
`gh` to avoid accidentally inspecting the upstream project. Stage only intended
files, run `git diff --check`, and check for secrets. Report the exact commit and
CI results when publishing; distinguish source review, offline tests, and observed
browser/provider behavior.
