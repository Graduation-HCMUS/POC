# Genie API

The Express application is constructed in `src/server.ts`. The listener
starts in `src/main.ts`. See the [root README](../../README.md) for local
configuration, migration, and integration tests.

| Method    | Path                      | Purpose                                                            |
| --------- | ------------------------- | ------------------------------------------------------------------ |
| GET       | `/api/health`             | Check the HTTP server                                              |
| GET, POST | `/api/workflows`          | List workflows or create a draft                                   |
| GET, PUT  | `/api/workflows/:id`      | Load or update a draft                                             |
| GET, POST | `/api/workflows/:id/runs` | List runs or run a saved version                                   |
| GET       | `/api/runs/:id`           | Read snapshot, node logs and outputs                               |
| POST      | `/api/files`              | Upload one CSV, Markdown or TXT file in the multipart `file` field |
| GET       | `/api/files/:id`          | Download the stored file                                           |

Create accepts `name`, `nodes` and `edges`. Update also expects the version
the editor loaded. A run accepts `{ version, fileId }` for one stored file.
The API creates one item containing its file reference at `files.input`.
Run returns HTTP 201 for a recorded run, including one whose status is
`failed`. Validation errors are returned before a run is created.

File Read and Parse each expect one input item. CSV Parse requires a header
and produces one item per data row. MD and TXT each produce one item with
`json.text`. Write uses input fields for CSV columns, and uses `summary`,
`text` or the JSON object as a fallback for Markdown and TXT.

Condition compares each item against ordered, typed equality rules and sends it
to the first match or the Else port. Custom accepts synchronous JavaScript with
an `items` parameter. It returns an array of objects with a `json` field and can
pass through file references from its input. A fresh QuickJS/Wasm runtime in a
worker limits execution time, memory, and data size. The runtime receives only
JSON data.

The HTTP request waits for execution. The engine routes data between ports,
while the API service handles persistence. An interrupted process can leave
a run recorded as `running`.
