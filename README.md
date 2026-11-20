# Genie

Genie generates executable Helpdesk workflows from natural language. This repository currently provides the development workspace: a React/Vite starter and an Express API. Agent functionality will live inside the existing TypeScript backend; it is not implemented yet.

## Quick Start

Use Git and [nvm](https://github.com/nvm-sh/nvm) (or nvm-windows with the version listed in `.nvmrc`). Run from the repository root:

```sh
git clone https://github.com/Graduation-HCMUS/POC.git
cd POC
nvm install
nvm use
npm ci
```

Node 24 is required. On nvm-windows, pass the version from `.nvmrc` explicitly to `nvm install` and `nvm use`. `npm ci` installs dependencies from the single root lockfile and automatically activates tracked Git hooks.

Terminal 1:

```sh
npm run dev:api
```

Terminal 2:

```sh
npm run dev:web
```

Open the URL printed by Vite (normally `http://localhost:5173`). The page displays **API connected** once React receives the health response through Vite's `/api` proxy. The starter counter remains available. Direct health: [localhost:3000/api/health](http://localhost:3000/api/health), returning `{"status":"ok"}`.

Validate the workspace:

```sh
npm run check
```

No database service, LLM credentials or environment file is needed.

## Daily development

- `packages/web` (`@packages/web`): React + Vite + TypeScript.
- `packages/api` (`@packages/api`): Express + TypeScript executed directly by Node 24. App construction is separate from the listener so tests can import it.
- `scripts`: shared checks and native hook setup; `.githooks/pre-commit`: tracked hook.

Equivalent launches: `npm run dev --workspace @packages/api` and `npm run dev --workspace @packages/web`. Root `npm run dev` starts only the frontend. Use two terminals; no combined launcher is required.

Default API environment: `NODE_ENV=development`, `PORT=3000`. Optionally copy `packages/api/config/.env.example` to `packages/api/config/.env.development` and edit it. Local `.env` files are ignored. Existing shell variables take precedence over env-file values.

If the API port changes, put `API_PROXY_TARGET=http://127.0.0.1:YOUR_PORT` in ignored `packages/web/.env.local`, then restart Vite. The proxy applies to the development server; `vite preview` is not a production API hosting setup.

After `git pull`, an already activated hook uses the updated tracked files automatically; no Git configuration step is needed. Run `npm ci` when dependency manifests or the lockfile change. A newly cloned repository still requires its initial `npm ci`: clone/pull alone cannot activate Git hooks.

Install dependencies from the root:

```sh
npm install <package> --workspace @packages/api
npm install --save-dev <package> --workspace @packages/web
```

Commit the affected manifest and root `package-lock.json` together. Never create package-local lockfiles. The existing users API uses a demo JSON file; it is not shared infrastructure and is not safe for concurrent writes within one server.

## Automatic pre-commit checks

`npm ci` runs `prepare` → `setup-hooks`, configuring local `core.hooksPath=.githooks`. No hook-management dependency is required.

The hook checks only staged `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` and `.cjs` files with ESLint and Prettier `--check`, using the appropriate workspace configuration. It checks staged content even for partially staged files and paths containing spaces. It never fixes/stages files or runs builds/full test suites. Fix failures, stage the intended corrections and retry. Files such as Markdown and CSS are checked by CI's repository-wide formatting gate, not pre-commit.

## Manual checks and CI

```sh
npm run lint
npm run typecheck
npm test
npm run format:check
npm run build
npm run check
npm run precommit
```

`check` runs formatting, lint, type checks, tests and the web production build, failing at the first unsuccessful gate. `build` bundles web into ignored `packages/web/dist`; run `check` for validation before contribution. API has no compilation step: `npm start --workspace @packages/api` runs source directly.

Both workspaces use Node's built-in test runner. API tests cover URI encoding and health with Supertest; web tests cover health response validation. Tests require no separately running server and fail if discovery/execution yields zero tests.

Formatting intentionally follows nearest configuration: root/web omit semicolons; API retains its own style and import sorting. CI runs on pushes and PRs targeting `main`, uses `.nvmrc`, installs from the root lockfile and runs `npm run check` independently of hooks.

## Troubleshooting

- Wrong runtime: run `nvm install`, `nvm use`, then confirm `node --version` matches `.nvmrc` before `npm ci`.
- API unavailable: start the backend, check port/proxy settings and inspect terminal errors. Occupied/invalid ports cause startup failure.
- Hook inactive: run `npm run setup-hooks`; inspect `git config --local --get core.hooksPath`. Installation must have Git metadata and permission to update local Git configuration. `npm ci --ignore-scripts` intentionally skips activation; run `setup-hooks` afterward.
- Hook tooling missing: run root `npm ci`. Hook failures do not alter staged content.
- Run `npm run precommit` to reproduce staged checks or `npm run check` for complete CI-equivalent gates.
