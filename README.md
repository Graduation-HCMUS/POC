# Genie PoC

This repository contains the proof of concept for **Genie**, a web-based workflow builder inspired by tools such as n8n. The project aims to let users create and automate workflows through a visual interface.

The current application is the React and Vite starter page with a sample counter. This scaffold establishes the frontend tooling and npm workspace structure for future development.

## Technology stack

- React and TypeScript for the frontend
- Vite for local development and production builds
- Node.js 24 and npm workspaces for development tooling and package management
- ESLint for static analysis
- GitHub Actions for continuous integration

## Repository structure

```text
POC/
├── .github/
│   └── workflows/
│       └── ci.yml
├── packages/
│   └── web/
│       ├── public/
│       ├── src/
│       ├── eslint.config.js
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.app.json
│       ├── tsconfig.node.json
│       └── vite.config.ts
├── .gitignore
├── .nvmrc
├── package.json
├── package-lock.json
└── README.md
```

The root `package.json` defines `packages/*` as npm workspaces. The frontend workspace is named `@packages/web`, and the root scripts delegate to that workspace.

## Prerequisites

- Git
- Node.js 24 with its bundled npm
- Access to the private `Graduation-HCMUS/POC` repository

The `.nvmrc` file selects Node.js `v24.22.1`, which CI also uses. Install this version directly or select it with a compatible version manager.

## Getting started

```sh
git clone https://github.com/Graduation-HCMUS/POC.git
cd POC
npm ci
```

Run npm commands from the repository root. Keep dependency installation and the shared `package-lock.json` at the root.

## Local development

```sh
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`. The development server reloads the application as you edit files in `packages/web/src/`.

## Lint and build

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

## Dependency changes

Install frontend dependencies from the repository root using the workspace name.

```sh
npm install <package-name> --workspace @packages/web
```

Add development dependencies with `--save-dev`. Commit the updated workspace manifest and root lockfile together. Use `npm ci` for installation from the committed lockfile.

## Continuous integration

The workflow in `.github/workflows/ci.yml` runs for pushes to `main` and pull requests targeting `main`.

Its `frontend-ci` job runs on GitHub-hosted Ubuntu and performs these steps in order.

1. Check out the repository.
2. Set up Node.js using `.nvmrc` and enable npm caching using the root lockfile.
3. Install dependencies with `npm ci`.
4. Run `npm run lint`.
5. Run `npm run build`.

A failed installation, lint check, or build fails the job. The workflow grants read-only access to repository contents.

## Future development

A Node.js backend written in TypeScript could live in `packages/api`. Shared TypeScript code could live in additional workspaces such as `packages/shared`. Each new workspace would have its own `package.json`, with root scripts and CI extended as needed.

Python modules could live under `python/` with their own dependency management and CI checks.

The backend framework and database choice remain open. Supabase is a database candidate. Redux Toolkit, Axios, Tailwind CSS, and Radix UI are being considered for future frontend features. Adoption of these technologies will depend on the proof of concept's requirements.
