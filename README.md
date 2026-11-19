# Genie PoC

This repository contains the proof of concept for **Genie**, a web-based workflow builder inspired by tools such as n8n. The project aims to let users create and automate workflows through a visual interface.

The frontend is a React and Vite starter. The Express backend includes a sample users API backed by a local JSON file.

## Technology stack

- React and TypeScript for the frontend
- Vite for local development and production builds
- Express and TypeScript for the backend
- Node.js 24 and npm workspaces for development tooling and package management
- ESLint for static analysis and Prettier for formatting
- GitHub Actions for continuous integration

## Repository structure

```text
POC/
├── .github/
│   └── workflows/
│       └── ci.yml
├── packages/
│   ├── api/
│   │   ├── config/        # Local environment files
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/
│       ├── public/
│       ├── src/
│       ├── package.json
│       └── vite.config.ts
├── .gitignore
├── .nvmrc
├── package.json
├── package-lock.json
├── requirements.txt
└── README.md
```

The root `package.json` defines `packages/*` as npm workspaces. The frontend is `@packages/web` and the backend is `@packages/api`. Both use the root `package-lock.json`.

## Prerequisites

- Git
- Node.js 24 with its bundled npm
- Access to the private `Graduation-HCMUS/POC` repository

Install the Node.js version in `.nvmrc` or select it with a compatible version manager. CI uses the same file.

## Getting started

```sh
git clone https://github.com/Graduation-HCMUS/POC.git
cd POC
npm ci
```

Run the commands below from the repository root.

## Local development

### Frontend

```sh
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. The development server reloads the application as you edit files in `packages/web/src/`.

### Backend

Create `packages/api/config/.env.development` with the following values. Create the `config` directory if needed.

```dotenv
NODE_ENV=development
PORT=3000
```

Start Express in a separate terminal.

```sh
npm run dev --workspace @packages/api
```

Open `http://localhost:3000/api/users/all` to try the sample API.

## Lint, test, and build

### Frontend

```sh
npm run lint
npm run build
```

Lint checks the frontend TypeScript files and Vite configuration with ESLint. Build runs TypeScript checking followed by Vite's production build. Generated files are written to `packages/web/dist/`.

To preview the production build locally after building, run the frontend's preview script.

```sh
npm run preview --workspace @packages/web
```

Open the URL printed by Vite's preview server.

### Backend

```sh
npm run lint --workspace @packages/api
npm run typecheck --workspace @packages/api
```

For tests, create `packages/api/config/.env.test` with `NODE_ENV=test` and `PORT=3001`, each on its own line. Then run the API tests.

```sh
npm test --workspace @packages/api
```

`npm run format --workspace @packages/api` formats API source and tests with Prettier and sorts imports using `packages/api/.prettierrc.json`.

## Pre-commit checks

Install the npm dependencies with `npm ci`. The hook lives in `.git/hooks/pre-commit` and is installed locally in each clone that uses it. Run `npm run check:staged` to invoke the installed hook manually.

- ESLint blocks errors and warnings in staged `.ts` and `.tsx` files.
- Prettier checks staged `.ts`, `.tsx`, `.css`, `.html`, `.json`, `.md`, `.yml`, and `.yaml` files.
- Ruff checks Python syntax, lint, and formatting for staged `.py` and `.pyi` files.

For Python changes, install Ruff into a local environment. On Windows, use PowerShell.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

On macOS or Linux, use the following commands.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

The hook reads staged file contents from Git. Fix any reported issues and stage the intended changes before retrying the commit.

## Dependency changes

Install dependencies from the repository root using the target workspace name.

```sh
npm install <package-name> --workspace @packages/web
npm install <package-name> --workspace @packages/api
```

Add development dependencies with `--save-dev`. After adding a workspace or editing a dependency in a manifest, run `npm install` from the root to update the shared lockfile. Commit the updated manifest and root lockfile together. Use `npm ci` for a clean install from the committed lockfile.

## Continuous integration

The workflow in `.github/workflows/ci.yml` runs for pushes to any branch and pull requests targeting `main`.

Its `frontend-ci` job runs on GitHub-hosted Ubuntu and performs these steps in order.

1. Check out the repository.
2. Set up Node.js using `.nvmrc` and enable npm caching using the root lockfile.
3. Install dependencies with `npm ci`.
4. Run `npm run lint`.
5. Run `npm run build`.

A failed installation, lint check, or build fails the job. The workflow grants read-only access to repository contents.

## Future development

Shared TypeScript code could live in an additional workspace such as `packages/shared`.

Python modules could live under `python/` with their own dependency management and CI checks.

Supabase is a database candidate. Redux Toolkit, Axios, Tailwind CSS, and Radix UI are being considered for future frontend features. Adoption of these technologies will depend on the proof of concept's requirements.
