import {
  limits,
  nodeCatalog,
  nodeTypes,
  outputPorts,
} from '@packages/contracts'
import type { NodeType } from '@packages/contracts'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useUpdateNodeInternals,
} from '@xyflow/react'
import type {
  Connection,
  Edge,
  NodeProps,
  ReactFlowProps,
  XYPosition,
} from '@xyflow/react'
import type { DragEvent } from 'react'
import { useEffect } from 'react'

import { canConnect } from './graph.ts'
import type { CanvasNode } from './graph.ts'
import { configSummary, nodeIcons } from './node-display.ts'

function WorkflowNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const catalog = nodeCatalog[data.type]
  const ports = outputPorts(data)
  const portOrder = ports.map((port) => port.id).join(',')
  const refreshPorts = useUpdateNodeInternals()
  useEffect(() => {
    refreshPorts(id)
  }, [id, portOrder, refreshPorts])
  return (
    <article
      className={`flow-node${selected ? ' flow-node-selected' : ''}`}
      data-kind={data.type}
      style={
        data.type === 'condition'
          ? { minHeight: Math.max(62, 20 * ports.length + 20) }
          : undefined
      }
    >
      {catalog.input.length > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="main"
          aria-label="Input port"
        />
      )}
      <span className="node-glyph" aria-hidden="true">
        {nodeIcons[data.type]}
      </span>
      <div className="flow-node-text">
        <strong title={data.name}>{data.name}</strong>
        <small>{configSummary(data.type, data.config)}</small>
      </div>
      {ports.map((port, index) => (
        <Handle
          aria-label={`${port.label} output port`}
          key={port.id}
          type="source"
          id={port.id}
          position={Position.Right}
          style={{
            top:
              ports.length > 1
                ? `${((index + 1) * 100) / (ports.length + 1)}%`
                : undefined,
          }}
        >
          {port.id !== 'main' && (
            <span
              className={`branch-label ${port.id === 'else' || port.id === 'false' ? 'branch-false' : 'branch-true'}`}
            >
              {port.label}
            </span>
          )}
        </Handle>
      ))}
    </article>
  )
}

const nodeViews = { workflow: WorkflowNodeView }
const defaultEdgeOptions = { type: 'smoothstep', interactionWidth: 24 }
export const paletteDragType = 'application/genie-node'

type CanvasProps = Pick<
  ReactFlowProps<CanvasNode, Edge>,
  'nodes' | 'edges' | 'onNodesChange' | 'onEdgesChange' | 'onSelectionChange'
> & {
  nodes: CanvasNode[]
  edges: Edge[]
  locked: boolean
  addNode: (type: NodeType, position: XYPosition) => void
  onConnect: (connection: Connection) => void
}

export function Canvas({
  nodes,
  edges,
  locked,
  addNode,
  onConnect,
  ...events
}: CanvasProps) {
  const { screenToFlowPosition } = useReactFlow()
  function dropNode(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    const type = nodeTypes.find(
      (kind) => kind === event.dataTransfer.getData(paletteDragType),
    )
    if (locked || !type || nodes.length >= limits.nodes) return
    addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }
  return (
    <section
      className="canvas"
      aria-label="Workflow canvas"
      onDrop={dropNode}
      onDragOver={(event) => {
        if (!locked && event.dataTransfer.types.includes(paletteDragType)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
    >
      <ReactFlow<CanvasNode, Edge>
        {...events}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeViews}
        defaultEdgeOptions={defaultEdgeOptions}
        onConnect={onConnect}
        isValidConnection={(connection) => canConnect(connection, nodes, edges)}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        deleteKeyCode={locked ? null : ['Backspace', 'Delete']}
        fitView
        minZoom={0.25}
        maxZoom={1.75}
        defaultViewport={{ x: 20, y: 25, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#c4ccd9" size={1.25} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="canvas-empty">
          <span aria-hidden="true">⑂</span>
          <strong>Start with a Trigger</strong>
          <p>Drag a node here or select one from the palette.</p>
        </div>
      )}
      <div className="canvas-count" aria-live="polite">
        {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {edges.length}{' '}
        {edges.length === 1 ? 'connection' : 'connections'}
      </div>
    </section>
  )
}
