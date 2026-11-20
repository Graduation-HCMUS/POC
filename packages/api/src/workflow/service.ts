import type { FileRef, RunInput, WorkflowDraft } from '@packages/contracts';
import type { Pool } from 'pg';

import { runRepository, workflowRepository } from '../db/workflows.ts';
import { executeWorkflow } from './execute.ts';
import type { FileStorage } from './file-operations.ts';
import { validateWorkflow } from './graph.ts';
import { WorkflowProblem } from './problems.ts';

export function workflowService(
  pool: Pool,
  storage: FileStorage & { stat(fileId: string): Promise<FileRef> },
) {
  const workflows = workflowRepository(pool);
  const runs = runRepository(pool);

  async function open(id: string) {
    const workflow = await workflows.find(id);
    if (!workflow) {
      throw new WorkflowProblem({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'Workflow was not found.',
      });
    }
    return workflow;
  }

  return {
    list: () => workflows.list(),
    create: (draft: WorkflowDraft) => workflows.create(draft),
    open,
    async update(id: string, version: number, draft: WorkflowDraft) {
      const workflow = await workflows.update(id, version, draft);
      if (workflow) return workflow;
      await open(id);
      throw versionConflict();
    },
    async run(id: string, { version, fileId }: RunInput) {
      const workflow = await open(id);
      if (workflow.version !== version) throw versionConflict();
      const graph = validateWorkflow(workflow);
      const file = await storage.stat(fileId);
      const run = await runs.create(workflow);
      const result = await executeWorkflow(
        graph,
        [{ json: {}, files: { input: file } }],
        storage,
      );
      const summary = await runs.finish(run.id, result);
      return { ...summary, workflowSnapshot: workflow, ...result };
    },
    async listRuns(id: string) {
      await open(id);
      return runs.list(id);
    },
    async getRun(id: string) {
      const run = await runs.find(id);
      if (!run)
        throw new WorkflowProblem({
          code: 'RUN_NOT_FOUND',
          message: 'Run was not found.',
        });
      return run;
    },
  };
}

function versionConflict() {
  return new WorkflowProblem({
    code: 'VERSION_CONFLICT',
    message:
      'This version is out of date. Open the latest workflow and try again.',
  });
}
