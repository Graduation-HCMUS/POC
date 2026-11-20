# Genie API

See the [root README](../../README.md) for Node 24/nvm setup, dependency installation, hooks and all shared commands.

From the repository root:

```sh
npm run dev:api
npm run lint --workspace @packages/api
npm run typecheck --workspace @packages/api
npm test --workspace @packages/api
```

The development server defaults to port 3000 without an environment file. Optional values are shown in `config/.env.example`; copy it to ignored `config/.env.development` to override defaults. Health: `GET /api/health`. Existing demo users routes are mounted under `/api/users`.

`src/server.ts` exports the Express app without a listener; `src/main.ts` starts it. Node runs TypeScript directly, so lint and type checking are separate gates. `npm start --workspace @packages/api` optionally loads `config/.env.production`; no compiled output is required.

Tests use Node's built-in runner and Supertest without external services or a persistent listener. Demo users persistence remains a local JSON file and is not safe for simultaneous writes.

`npm run format --workspace @packages/api` explicitly rewrites API formatting; pre-commit and CI use read-only checks instead.
