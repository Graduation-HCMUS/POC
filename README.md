# Genie

Genie PoC is a local Helpdesk workflow builder. Create a graph by hand, save it in
PostgreSQL, run it with an uploaded file, and inspect stored results.

## Run locally

Install Git, Docker with Compose and the Node version in `.nvmrc`. On Windows
with nvm-windows, pass that version explicitly to `nvm install` and `nvm use`.

From the repo root, run the following. Copy
`packages/api/config/.env.example` to `packages/api/config/.env.development`
before running the migration.

```sh
npm ci
docker compose up -d --wait postgres
npm run db:migrate --workspace @packages/api
```

Start the API and web app in separate terminals.

```sh
npm run dev:api
npm run dev:web
```

Open the URL printed by Vite, normally `http://localhost:5173`. Vite forwards
`/api` to `http://127.0.0.1:3000`. Set `API_PROXY_TARGET` in
`packages/web/.env.local` if using a different API port. The API listens on
localhost for this single-user PoC. `GET /api/health` checks that it responds.

Local PostgreSQL uses a named volume. The API stores file bytes under
`.local/genie` in your home directory by default. Set `FILE_STORAGE_DIR` to an
absolute local directory to override it. Keep both the named volume and the
file directory to reopen prior runs and download their files after a restart.

## Try the Helpdesk workflow

Add and connect these nodes. You can click a node type in the palette or drag
it to the canvas.

| Node          | Configuration                                                           |
| ------------- | ----------------------------------------------------------------------- |
| Trigger       | Manual                                                                  |
| File Handling | Read with file key `input`                                              |
| File Handling | Parse as CSV                                                            |
| File Handling | Filter where `status` equals text `open`                                |
| Condition     | If `priority` equals text `high`, Else if it equals text `medium`, Else |
| Custom        | JavaScript shown below                                                  |
| File Handling | Write Markdown as `urgent.md`                                           |
| Output        | `urgentFile`                                                            |
| Output        | `mediumTickets`                                                         |
| Output        | `normalTickets`                                                         |

Connect Trigger → Read → Parse → Filter → Condition. Connect **If** to
Custom → Write → `urgentFile`, **Else if 1** to `mediumTickets`, and **Else**
to `normalTickets`. Each item follows its first matching rule.

Enter this JavaScript in the Custom node.

```js
return items.map((item) => ({
  ...item,
  json: {
    ...item.json,
    summary: '#' + item.json.id + ' — ' + item.json.subject,
  },
}))
```

Save, select **Trigger**, and upload
[tickets.csv](packages/api/tests/fixtures/tickets.csv) in **Settings**. Click
**Run** and inspect **Run & history**. Expect ten executed nodes,
`mediumTickets` with ticket `105`, `normalTickets` with ticket `102`, and a
downloadable `urgent.md` with tickets `101` and `103`. Open the Condition trace
to see the JSON on each port. Save accepts incomplete graphs and Run checks
the saved graph and settings before starting.

Workflow definitions with the original Condition or fixed-function Custom
configuration can still be opened along with their history. Build a workflow
with the current node settings to run this demo.

## Checks and development

```sh
npm run check
docker compose --profile test up -d --wait postgres-test
npm run test:integration --workspace @packages/api
```

`npm run check` runs formatting, lint, type checks, unit tests and the web
production build. GitHub Actions still runs this command after `npm ci`.
It needs neither Docker nor PostgreSQL. The separate integration command
uses `TEST_DATABASE_URL` from the API environment, creates an isolated test
schema and uses a temporary file directory.

`npm ci` installs from the root lockfile and activates the tracked pre-commit
hook through `prepare`. The hook checks staged JavaScript and TypeScript with
ESLint and Prettier. Use `npm run precommit` to run the staged checks manually.
Install dependencies in the workspace that uses them and commit the root
lockfile with its manifest changes.
