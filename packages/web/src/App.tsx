import {
  limits,
  nodeCatalog,
  nodeTypes,
  outputPorts,
} from '@packages/contracts'
import type {
  FileRef,
  NodeType,
  RunResult,
  RunSummary,
  WorkflowDefinition,
  WorkflowIssue,
  WorkflowSummary,
} from '@packages/contracts'
import { ReactFlowProvider, useEdgesState, useNodesState } from '@xyflow/react'
import type { Connection, Edge, XYPosition } from '@xyflow/react'
import { useEffect, useState } from 'react'
import '@xyflow/react/dist/style.css'

import './App.css'
import { ApiError, api } from './workflow/api.ts'
import { Canvas, paletteDragType } from './workflow/Canvas.tsx'
import {
  canConnect,
  fromDraft,
  initialConfig,
  toDraft,
} from './workflow/graph.ts'
import type { CanvasNode } from './workflow/graph.ts'
import { NodeConfig } from './workflow/NodeConfig.tsx'
import { nodeIcons } from './workflow/node-display.ts'
import { RunPanel } from './workflow/RunPanel.tsx'

const defaultName = 'Untitled workflow'
function showWorkflowInUrl(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('workflow', id)
  else url.searchParams.delete('workflow')
  window.history.replaceState(null, '', url)
}

function toIssue(error: unknown): WorkflowIssue {
  if (error instanceof ApiError) return error.issue
  return {
    code: 'WORKSPACE_ERROR',
    message:
      error instanceof Error
        ? error.message
        : 'Could not complete the request.',
  }
}

function Workspace() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [name, setName] = useState(defaultName)
  const [id, setId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [workflowList, setWorkflowList] = useState<WorkflowSummary[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [run, setRun] = useState<RunResult | null>(null)
  const [file, setFile] = useState<FileRef | null>(null)
  const [issue, setIssue] = useState<WorkflowIssue | null>(null)
  const [tab, setTab] = useState<'settings' | 'run'>('settings')
  const [busy, setBusy] = useState<string | null>('Opening workspace…')
  const [canvasKey, setCanvasKey] = useState(0)
  const [saved, setSaved] = useState(() =>
    JSON.stringify(toDraft(defaultName, [], [])),
  )

  const draft = toDraft(name, nodes, edges)
  const dirty = saved !== JSON.stringify(draft)
  const locked = busy !== null
  const selected = nodes.find((node) => node.selected)
  const selectedEdge = edges.find((edge) => edge.selected)
  const issueNode = issue && nodes.find((node) => node.id === issue.nodeId)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const previousId = new URL(window.location.href).searchParams.get(
      'workflow',
    )
    async function initialize() {
      try {
        const list = await api.list(signal)
        if (signal.aborted) return
        setWorkflowList(list)
        if (!previousId) return
        const [workflow, history] = await Promise.all([
          api.open(previousId, signal),
          api.history(previousId, signal),
        ])
        if (signal.aborted) return
        const graph = fromDraft(workflow)
        setId(workflow.id)
        setName(workflow.name)
        setVersion(workflow.version)
        setRuns(history)
        setNodes(graph.nodes)
        setEdges(graph.edges)
        setSaved(
          JSON.stringify(toDraft(workflow.name, graph.nodes, graph.edges)),
        )
        setCanvasKey((key) => key + 1)
      } catch (error) {
        if (!signal.aborted) setIssue(toIssue(error))
      } finally {
        if (!signal.aborted) setBusy(null)
      }
    }
    void initialize()
    return () => controller.abort()
  }, [setEdges, setNodes])

  async function withBusy(label: string, action: () => Promise<void>) {
    setBusy(label)
    setIssue(null)
    try {
      await action()
    } catch (error) {
      setIssue(toIssue(error))
    } finally {
      setBusy(null)
    }
  }

  function load(workflow: WorkflowDefinition | null, history: RunSummary[]) {
    const graph = workflow ? fromDraft(workflow) : { nodes: [], edges: [] }
    const nextName = workflow?.name ?? defaultName
    setId(workflow?.id ?? null)
    setVersion(workflow?.version ?? 0)
    setName(nextName)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setRuns(history)
    setRun(null)
    setFile(null)
    setTab('settings')
    setIssue(null)
    setCanvasKey((key) => key + 1)
    setSaved(JSON.stringify(toDraft(nextName, graph.nodes, graph.edges)))
    showWorkflowInUrl(workflow?.id ?? null)
  }

  function open(nextId: string | null) {
    if (dirty && !window.confirm('Discard unsaved changes to this workflow?'))
      return
    if (!nextId) {
      load(null, [])
      return
    }
    void withBusy('Opening workflow…', async () => {
      const [workflow, history] = await Promise.all([
        api.open(nextId),
        api.history(nextId),
      ])
      load(workflow, history)
      setWorkflowList((list) =>
        list.map((entry) =>
          entry.id === nextId
            ? {
                id: workflow.id,
                name: workflow.name,
                version: workflow.version,
              }
            : entry,
        ),
      )
    })
  }

  function save() {
    void withBusy('Saving…', async () => {
      const workflow = await api.save(draft, id, version)
      setId(workflow.id)
      setName(workflow.name)
      setVersion(workflow.version)
      const normalizedNodes = fromDraft(workflow).nodes
      const names = new Map(
        normalizedNodes.map((node) => [node.id, node.data.name]),
      )
      const renamedNodes = nodes.map((node) => ({
        ...node,
        data: { ...node.data, name: names.get(node.id) ?? node.data.name },
      }))
      setNodes(renamedNodes)
      setSaved(JSON.stringify(toDraft(workflow.name, renamedNodes, edges)))
      setWorkflowList((list) => [
        { id: workflow.id, name: workflow.name, version: workflow.version },
        ...list.filter((entry) => entry.id !== workflow.id),
      ])
      showWorkflowInUrl(workflow.id)
    })
  }

  function startRun() {
    if (!id || dirty) return
    if (!file) {
      const trigger = nodes.find((node) => node.data.type === 'trigger')
      if (trigger) {
        setNodes((current) =>
          current.map((node) => ({
            ...node,
            selected: node.id === trigger.id,
          })),
        )
      }
      setTab('settings')
      setIssue({
        code: 'MISSING_UPLOAD',
        message: trigger
          ? 'Choose an input file before running.'
          : 'Add a Trigger node and choose an input file.',
        nodeId: trigger?.id,
      })
      return
    }
    setTab('run')
    void withBusy('Running workflow…', async () => {
      setRun(null)
      const result = await api.run(id, { version, fileId: file.fileId })
      setRun(result)
      setRuns((previous) => [
        result,
        ...previous.filter((entry) => entry.id !== result.id),
      ])
    })
  }

  function addNode(type: NodeType, position?: XYPosition) {
    if (locked || nodes.length >= limits.nodes) return
    const label = nodeCatalog[type].label
    const usedNames = new Set(nodes.map((node) => node.data.name))
    let title = label as string
    for (let index = 2; usedNames.has(title); index++)
      title = `${label} ${index}`
    const config =
      type === 'output'
        ? {
            outputName: nodes.some((node) => node.data.type === 'output')
              ? `result${nodes.length + 1}`
              : 'result',
          }
        : initialConfig(type)
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id: crypto.randomUUID(),
        type: 'workflow',
        position: position ?? {
          x: 38 + (current.length % 3) * 225,
          y: 45 + Math.floor(current.length / 3) * 105,
        },
        data: { type, name: title, config },
        selected: true,
      },
    ])
    setTab('settings')
  }

  function connect(connection: Connection) {
    if (locked || !canConnect(connection, nodes, edges)) return
    setEdges((current) => [
      ...current,
      { ...connection, id: crypto.randomUUID() },
    ])
  }

  function removeNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId))
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
    )
  }

  return (
    <div className="studio">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✦
          </span>
          <span>
            Genie <small>Workflow Studio</small>
          </span>
        </div>
        <div className="workflow-controls">
          <input
            className="workflow-name"
            aria-label="Workflow name"
            disabled={locked}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <span className="save-state" role="status">
            {busy ??
              (dirty
                ? 'Unsaved changes'
                : id
                  ? `Saved · v${version}`
                  : 'New workflow')}
          </span>
          <button
            type="button"
            className="button"
            disabled={locked || Boolean(id && !dirty)}
            onClick={save}
          >
            Save
          </button>
          <button
            type="button"
            className="button primary-button"
            disabled={locked || !id || dirty}
            onClick={startRun}
          >
            ▷ Run
          </button>
        </div>
      </header>
      {issue && (
        <div className="workspace-error" role="alert">
          <span>
            {issueNode && `${issueNode.data.name} · `}
            {issue.message}
          </span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setIssue(null)}
          >
            ×
          </button>
        </div>
      )}
      <main className="workbench">
        <aside className="sidebar" aria-label="Workspace navigation">
          <section className="sidebar-section">
            <h2>Workflows</h2>
            <button
              className="new-button"
              type="button"
              disabled={locked}
              onClick={() => open(null)}
            >
              + New workflow
            </button>
            <ul className="workflow-list">
              {workflowList.map((workflow) => (
                <li key={workflow.id}>
                  <button
                    type="button"
                    disabled={locked}
                    aria-current={workflow.id === id ? 'true' : undefined}
                    title={workflow.name}
                    onClick={() => open(workflow.id)}
                  >
                    <span>{workflow.name}</span>
                    <small>v{workflow.version}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="sidebar-section">
            <h2>Node palette</h2>
            <div className="palette">
              {nodeTypes.map((type) => (
                <button
                  className="palette-node"
                  data-kind={type}
                  disabled={locked || nodes.length >= limits.nodes}
                  key={type}
                  type="button"
                  draggable={!locked && nodes.length < limits.nodes}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(paletteDragType, type)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => addNode(type)}
                >
                  <span className="node-glyph" aria-hidden="true">
                    {nodeIcons[type]}
                  </span>
                  {nodeCatalog[type].label}
                  <span className="add-glyph" aria-hidden="true">
                    +
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>
        <Canvas
          key={canvasKey}
          nodes={nodes}
          edges={edges}
          locked={locked}
          addNode={addNode}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
        />
        <aside className="inspector" aria-label="Workflow inspector">
          <div className="inspector-tabs">
            <button
              type="button"
              aria-pressed={tab === 'settings'}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
            <button
              type="button"
              aria-pressed={tab === 'run'}
              onClick={() => setTab('run')}
            >
              Run & history
            </button>
          </div>
          <div className="inspector-content">
            {tab === 'settings' ? (
              selectedEdge && !selected ? (
                <section className="inspector-section">
                  <h2>Connection</h2>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={locked}
                    onClick={() => {
                      setEdges((current) =>
                        current.filter((edge) => edge.id !== selectedEdge.id),
                      )
                    }}
                  >
                    Delete connection
                  </button>
                </section>
              ) : (
                <NodeConfig
                  node={selected}
                  locked={locked}
                  update={(data) => {
                    if (selected && data.type === 'condition') {
                      const ports = new Set(
                        outputPorts(data).map(({ id }) => id),
                      )
                      setEdges((current) =>
                        current.filter(
                          (edge) =>
                            edge.source !== selected.id ||
                            ports.has(edge.sourceHandle ?? 'main'),
                        ),
                      )
                    }
                    setNodes((current) =>
                      current.map((node) =>
                        node.id === selected?.id ? { ...node, data } : node,
                      ),
                    )
                  }}
                  remove={() => {
                    if (selected) removeNode(selected.id)
                  }}
                  file={file}
                  clearFile={() => setFile(null)}
                  upload={(upload) =>
                    void withBusy('Uploading…', async () =>
                      setFile((await api.upload(upload)).fileRef),
                    )
                  }
                />
              )
            ) : (
              <RunPanel
                history={runs}
                run={run}
                locked={locked}
                openRun={(runId) =>
                  void withBusy('Opening run…', async () =>
                    setRun(await api.runDetail(runId)),
                  )
                }
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  )
}
