import { outputPorts } from '@packages/contracts'
import type {
  JsonPreview,
  NodeRun,
  RunResult,
  RunSummary,
  WorkflowNode,
} from '@packages/contracts'

type RunPanelProps = {
  history: RunSummary[]
  run: RunResult | null
  openRun: (id: string) => void
  locked: boolean
}

export function RunPanel({ history, run, openRun, locked }: RunPanelProps) {
  return (
    <>
      {run && <RunDetails key={run.id} run={run} />}
      <section className="inspector-section">
        <h2>Run history</h2>
        {history.length === 0 && (
          <p className="muted">
            Runs appear here after you execute the workflow.
          </p>
        )}
        <ul className="run-list">
          {history.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={locked}
                aria-pressed={run?.id === entry.id}
                onClick={() => openRun(entry.id)}
              >
                <span className={`run-status ${entry.status}`}>
                  {entry.status}
                </span>
                <span>
                  v{entry.workflowVersion} ·{' '}
                  {new Date(entry.startedAt).toLocaleTimeString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function RunDetails({ run }: { run: RunResult }) {
  const nodes = new Map(
    run.workflowSnapshot.nodes.map((node) => [node.id, node]),
  )
  return (
    <section className="inspector-section" aria-label="Run results">
      <div className="result-header">
        <h2>
          Run results <small>v{run.workflowVersion}</small>
        </h2>
        <span className={`run-status ${run.status}`}>{run.status}</span>
      </div>
      {run.error && <p className="error-message">{run.error.message}</p>}
      {run.warnings.map((warning) => (
        <p
          className="warning-message"
          key={`${warning.nodeId ?? ''}-${warning.message}`}
        >
          {warning.nodeId &&
            `${nodes.get(warning.nodeId)?.name ?? warning.nodeId} · `}
          {warning.message}
        </p>
      ))}
      <ol className="node-log">
        {run.nodeRuns.map((log) => (
          <NodeTraceRow
            key={log.sequence}
            log={log}
            node={nodes.get(log.nodeId)}
          />
        ))}
      </ol>
      {run.status === 'success' && Object.keys(run.outputs).length === 0 && (
        <p className="muted">No items reached an Output node.</p>
      )}
      {Object.entries(run.outputs).map(([name, items]) => (
        <details className="run-output" key={name} open>
          <summary>
            {name}{' '}
            <small>
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </small>
          </summary>
          {items
            .flatMap((item) => Object.values(item.files ?? {}))
            .map((ref, index) => (
              <a
                className="download-link"
                key={`${ref.fileId}-${index}`}
                href={`/api/files/${ref.fileId}`}
              >
                Download {ref.fileName}
              </a>
            ))}
          <pre>
            {JSON.stringify(
              items.map(({ json }) => json),
              null,
              2,
            )}
          </pre>
        </details>
      ))}
    </section>
  )
}

function NodeTraceRow({ log, node }: { log: NodeRun; node?: WorkflowNode }) {
  const ports = node
    ? outputPorts(node)
    : Object.keys(log.outputCounts).map((id) => ({ id, label: id }))
  const { trace } = log
  return (
    <li>
      <details className="node-trace">
        <summary>
          <span className={`log-dot ${log.status}`} aria-label={log.status} />
          <span className="log-content">
            <strong>{node?.name ?? log.nodeId}</strong>
            <small>
              {log.inputCount} in
              {ports
                .filter(({ id }) => id in log.outputCounts)
                .map(({ id, label }) => ` · ${label} ${log.outputCounts[id]}`)}
              {' · '}
              {log.durationMs} ms
            </small>
          </span>
        </summary>
        {trace ? (
          <div className="trace-content">
            <TraceJson label="Input JSON" preview={trace.input} />
            {ports.map(({ id, label }) => {
              const preview = trace.outputs[id]
              return (
                preview && (
                  <TraceJson
                    key={id}
                    label={`Output JSON · ${label}`}
                    preview={preview}
                  />
                )
              )
            })}
            {trace.result && (
              <TraceJson
                label={`Run output · ${trace.result.name}`}
                preview={trace.result.data}
              />
            )}
            {log.error && <p className="error-message">{log.error.message}</p>}
          </div>
        ) : (
          <p className="muted">JSON was not captured for this run.</p>
        )}
      </details>
    </li>
  )
}

function TraceJson({
  label,
  preview,
}: {
  label: string
  preview: JsonPreview
}) {
  return (
    <div className="trace-json">
      <h3>{label}</h3>
      <pre tabIndex={0} aria-label={label}>
        {preview.text}
      </pre>
      {preview.truncated && <p className="muted">Preview limited to 16 KiB.</p>}
    </div>
  )
}
