import type {
  RunResult,
  RunSummary,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowSummary,
} from '@packages/contracts';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { transaction } from './postgres.ts';

type RunRow = Omit<RunSummary, 'startedAt' | 'finishedAt'> & {
  startedAt: Date;
  finishedAt: Date | null;
};
type RunDetailRow = RunRow & Omit<RunResult, keyof RunSummary>;

const runColumns = `id, workflow_id AS "workflowId", workflow_version AS "workflowVersion",
  status, started_at AS "startedAt", finished_at AS "finishedAt"`;

function isoDates(row: RunRow): RunSummary {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowVersion: row.workflowVersion,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function workflowRepository(pool: Pool) {
  return {
    async list() {
      const { rows } = await pool.query<WorkflowSummary>(
        'SELECT id, name, version FROM workflows ORDER BY updated_at DESC, id',
      );
      return rows;
    },
    async find(id: string) {
      const { rows } = await pool.query<{ definition: WorkflowDefinition }>(
        'SELECT definition FROM workflows WHERE id = $1',
        [id],
      );
      return rows[0]?.definition;
    },
    async create(draft: WorkflowDraft): Promise<WorkflowDefinition> {
      const definition = { ...draft, id: randomUUID(), version: 1 };
      await pool.query(
        'INSERT INTO workflows (id, version, name, definition) VALUES ($1, $2, $3, $4)',
        [definition.id, definition.version, definition.name, definition],
      );
      return definition;
    },
    async update(id: string, version: number, draft: WorkflowDraft) {
      const definition = { ...draft, id, version: version + 1 };
      const { rowCount } = await pool.query(
        `UPDATE workflows SET version = $2, name = $3, definition = $4, updated_at = now()
         WHERE id = $1 AND version = $5`,
        [id, definition.version, definition.name, definition, version],
      );
      return rowCount ? definition : undefined;
    },
  };
}

export function runRepository(pool: Pool) {
  return {
    async create(workflow: WorkflowDefinition): Promise<RunSummary> {
      const { rows } = await pool.query<RunRow>(
        `INSERT INTO workflow_runs (id, workflow_id, workflow_version, workflow_snapshot, status)
         VALUES ($1, $2, $3, $4, 'running') RETURNING ${runColumns}`,
        [randomUUID(), workflow.id, workflow.version, workflow],
      );
      return isoDates(rows[0]);
    },
    async finish(
      id: string,
      result: Pick<RunResult, 'nodeRuns' | 'outputs' | 'warnings' | 'error'>,
    ) {
      return transaction(pool, async (client) => {
        for (const log of result.nodeRuns) {
          await client.query(
            `INSERT INTO node_runs
             (run_id, sequence, node_id, status, input_count, output_counts, duration_ms, error, trace)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              id,
              log.sequence,
              log.nodeId,
              log.status,
              log.inputCount,
              log.outputCounts,
              log.durationMs,
              log.error,
              log.trace,
            ],
          );
        }
        const { rows } = await client.query<RunRow>(
          `UPDATE workflow_runs SET status = $2, outputs = $3, warnings = $4, error = $5,
           finished_at = clock_timestamp() WHERE id = $1 RETURNING ${runColumns}`,
          [
            id,
            result.error ? 'failed' : 'success',
            result.outputs,
            JSON.stringify(result.warnings),
            result.error,
          ],
        );
        return isoDates(rows[0]);
      });
    },
    async list(workflowId: string) {
      const { rows } = await pool.query<RunRow>(
        `SELECT ${runColumns} FROM workflow_runs WHERE workflow_id = $1
         ORDER BY started_at DESC, id DESC`,
        [workflowId],
      );
      return rows.map(isoDates);
    },
    async find(id: string): Promise<RunResult | undefined> {
      const { rows } = await pool.query<RunDetailRow>(
        `SELECT ${runColumns}, workflow_snapshot AS "workflowSnapshot", outputs, warnings, error,
           COALESCE((
             SELECT jsonb_agg(to_jsonb(log) ORDER BY log.sequence)
             FROM (
               SELECT sequence, node_id AS "nodeId", status, input_count AS "inputCount",
                 output_counts AS "outputCounts", duration_ms AS "durationMs", error, trace
               FROM node_runs WHERE run_id = $1
             ) AS log
           ), '[]'::jsonb) AS "nodeRuns"
         FROM workflow_runs WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row) return undefined;
      return {
        ...isoDates(row),
        workflowSnapshot: row.workflowSnapshot,
        nodeRuns: row.nodeRuns,
        outputs: row.outputs,
        warnings: row.warnings,
        error: row.error,
      };
    },
  };
}
