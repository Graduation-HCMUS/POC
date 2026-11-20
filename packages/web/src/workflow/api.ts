import type {
  FileRef,
  RunInput,
  RunResult,
  RunSummary,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowIssue,
  WorkflowSummary,
} from '@packages/contracts'

export class ApiError extends Error {
  issue: WorkflowIssue

  constructor(issue: WorkflowIssue) {
    super(issue.message)
    this.issue = issue
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const issue = body as Partial<WorkflowIssue> | null
    throw new ApiError({
      code: issue?.code ?? 'REQUEST_FAILED',
      message: issue?.message ?? 'Could not reach the Genie API.',
      nodeId: issue?.nodeId,
      edgeId: issue?.edgeId,
    })
  }
  return body as T
}

function json(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  list: (signal?: AbortSignal) =>
    request<WorkflowSummary[]>('/workflows', { signal }),
  open: (id: string, signal?: AbortSignal) =>
    request<WorkflowDefinition>(`/workflows/${encodeURIComponent(id)}`, {
      signal,
    }),
  save: (draft: WorkflowDraft, id: string | null, version: number) =>
    id
      ? request<WorkflowDefinition>(
          `/workflows/${id}`,
          json('PUT', { ...draft, version }),
        )
      : request<WorkflowDefinition>('/workflows', json('POST', draft)),
  run: (id: string, input: RunInput) =>
    request<RunResult>(`/workflows/${id}/runs`, json('POST', input)),
  history: (id: string, signal?: AbortSignal) =>
    request<RunSummary[]>(`/workflows/${id}/runs`, { signal }),
  runDetail: (id: string) => request<RunResult>(`/runs/${id}`),
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ fileRef: FileRef }>('/files', { method: 'POST', body })
  },
}
