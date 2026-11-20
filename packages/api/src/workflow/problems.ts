import type { WorkflowIssue } from '@packages/contracts';

export class WorkflowProblem extends Error {
  readonly issue: WorkflowIssue;

  constructor(issue: WorkflowIssue) {
    super(issue.message);
    this.issue = issue;
  }
}
