CREATE TABLE workflows (
  id UUID PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  workflow_version INTEGER NOT NULL,
  workflow_snapshot JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX workflow_runs_by_workflow
  ON workflow_runs (workflow_id, started_at DESC, id DESC);

CREATE TABLE node_runs (
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  input_count INTEGER NOT NULL,
  output_counts JSONB NOT NULL,
  duration_ms INTEGER NOT NULL,
  error JSONB,
  PRIMARY KEY (run_id, sequence)
);

CREATE TABLE stored_files (
  id UUID PRIMARY KEY,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
