import {
  conditionDraftSchema,
  fileFormats,
  fileOperations,
  hasLegacyConfig,
  limits,
  nodeCatalog,
} from '@packages/contracts'
import type { FileRef, WorkflowNode } from '@packages/contracts'

import type { CanvasNode } from './graph.ts'
import { newBranch } from './graph.ts'
import { nodeIcons } from './node-display.ts'

type Config = WorkflowNode['config']

const operationDefaults: Record<(typeof fileOperations)[number], Config> = {
  read: { operation: 'read', sourceKey: 'input' },
  parse: { operation: 'parse', format: 'csv' },
  filter: { operation: 'filter', field: '', op: 'eq', value: '' },
  write: { operation: 'write', format: 'md', fileName: 'result.md' },
}

function stringValue(value: Config[string]) {
  return typeof value === 'string' ? value : ''
}

function PredicateFields({
  config,
  update,
}: {
  config: Config
  update: (config: Config) => void
}) {
  const value = config.value
  const kind =
    value === null
      ? 'null'
      : typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : 'text'
  return (
    <>
      <label>
        Field
        <input
          value={stringValue(config.field)}
          maxLength={100}
          placeholder="e.g. priority"
          onChange={(event) => update({ ...config, field: event.target.value })}
        />
      </label>
      <label>
        Operator
        <select value="eq" disabled aria-label="Operator">
          <option value="eq">Equals</option>
        </select>
      </label>
      <label>
        Value type
        <select
          value={kind}
          onChange={(event) => {
            const defaults = { text: '', number: 0, boolean: true, null: null }
            const type = event.target.value as keyof typeof defaults
            update({ ...config, value: defaults[type] })
          }}
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="null">Null</option>
        </select>
      </label>
      {kind === 'boolean' && (
        <label>
          Value
          <select
            value={value ? 'true' : 'false'}
            onChange={(event) =>
              update({ ...config, value: event.target.value === 'true' })
            }
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </label>
      )}
      {(kind === 'text' || kind === 'number') && (
        <label>
          Value
          <input
            type={kind}
            step={kind === 'number' ? 'any' : undefined}
            value={
              typeof value === 'number' || typeof value === 'string'
                ? value
                : ''
            }
            onChange={(event) =>
              update({
                ...config,
                value:
                  kind === 'number'
                    ? event.target.valueAsNumber || 0
                    : event.target.value,
              })
            }
          />
        </label>
      )}
    </>
  )
}

function ConditionFields({
  config,
  update,
}: {
  config: Config
  update: (config: Config) => void
}) {
  const draft = conditionDraftSchema.safeParse(config)
  if (!draft.success)
    return <p className="muted">Add a new Condition node to build its rules.</p>
  const { branches } = draft.data
  function move(index: number, offset: number) {
    const next = [...branches]
    const [rule] = next.splice(index, 1)
    next.splice(index + offset, 0, rule)
    update({ branches: next })
  }
  return (
    <>
      {branches.map((branch, index) => {
        const label = index === 0 ? 'If' : `Else if ${index}`
        return (
          <fieldset className="fields condition-rule" key={branch.id}>
            <legend>{label}</legend>
            <PredicateFields
              config={branch}
              update={(next) =>
                update({
                  branches: branches.map((entry) =>
                    entry.id === branch.id ? { ...next, id: branch.id } : entry,
                  ),
                })
              }
            />
            <div className="condition-actions">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${label} up`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === branches.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${label} down`}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={branches.length === 1}
                onClick={() =>
                  update({
                    branches: branches.filter(({ id }) => id !== branch.id),
                  })
                }
                aria-label={`Remove ${label}`}
              >
                Remove
              </button>
            </div>
          </fieldset>
        )
      })}
      <button
        className="new-button"
        type="button"
        disabled={branches.length >= limits.conditionRules}
        onClick={() => update({ branches: [...branches, newBranch()] })}
      >
        + Add Else if
      </button>
      <p className="muted">Else receives items that match none of the rules.</p>
    </>
  )
}

export function NodeConfig({
  node,
  locked,
  update,
  remove,
  file,
  upload,
  clearFile,
}: {
  node: CanvasNode | undefined
  locked: boolean
  update: (data: CanvasNode['data']) => void
  remove: () => void
  file: FileRef | null
  upload: (file: File) => void
  clearFile: () => void
}) {
  if (!node)
    return (
      <section className="inspector-section">
        <h2>Node settings</h2>
        <p className="muted">
          Select a node on the canvas to edit its settings.
        </p>
      </section>
    )
  const { type, name, config } = node.data
  const updateConfig = (next: Config) => update({ ...node.data, config: next })
  return (
    <section className="inspector-section">
      <h2>
        <span className="node-glyph" data-kind={type} aria-hidden="true">
          {nodeIcons[type]}
        </span>
        {nodeCatalog[type].label}
      </h2>
      <fieldset disabled={locked} className="fields">
        <label>
          Node name
          <input
            value={name}
            maxLength={100}
            onChange={(event) =>
              update({ ...node.data, name: event.target.value })
            }
          />
        </label>
        {type === 'trigger' && (
          <>
            <label>
              Input file
              <input
                type="file"
                accept=".csv,.md,.txt"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  if (selected) upload(selected)
                  event.target.value = ''
                }}
              />
            </label>
            {file && (
              <div className="file-chip">
                <span title={file.fileName}>{file.fileName}</span>
                <button
                  type="button"
                  onClick={clearFile}
                  aria-label="Remove input file"
                >
                  ×
                </button>
              </div>
            )}
            <p className="muted">
              Select one CSV, Markdown, or TXT file for this run.
            </p>
          </>
        )}
        {type === 'output' && (
          <label>
            Output name
            <input
              value={stringValue(config.outputName)}
              maxLength={100}
              onChange={(event) =>
                updateConfig({ outputName: event.target.value })
              }
            />
          </label>
        )}
        {type === 'condition' && (
          <ConditionFields config={config} update={updateConfig} />
        )}
        {type === 'file' && (
          <>
            <label>
              Operation
              <select
                value={stringValue(config.operation)}
                onChange={(event) => {
                  const operation = fileOperations.find(
                    (entry) => entry === event.target.value,
                  )
                  if (operation) updateConfig(operationDefaults[operation])
                }}
              >
                {fileOperations.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry[0].toUpperCase() + entry.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            {config.operation === 'read' && (
              <label>
                File key
                <input
                  value={stringValue(config.sourceKey)}
                  onChange={(event) =>
                    updateConfig({ ...config, sourceKey: event.target.value })
                  }
                />
              </label>
            )}
            {(config.operation === 'parse' || config.operation === 'write') && (
              <label>
                Format
                <select
                  value={stringValue(config.format)}
                  onChange={(event) =>
                    updateConfig({
                      ...config,
                      format: event.target.value,
                      ...(config.operation === 'write'
                        ? { fileName: `result.${event.target.value}` }
                        : {}),
                    })
                  }
                >
                  {fileFormats.map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {config.operation === 'filter' && (
              <PredicateFields config={config} update={updateConfig} />
            )}
            {config.operation === 'write' && (
              <label>
                File name
                <input
                  value={stringValue(config.fileName)}
                  maxLength={160}
                  onChange={(event) =>
                    updateConfig({ ...config, fileName: event.target.value })
                  }
                />
              </label>
            )}
          </>
        )}
        {type === 'custom' && (
          <>
            {hasLegacyConfig(node.data) && (
              <p className="warning-message">
                Enter JavaScript to replace the legacy function.
              </p>
            )}
            <label>
              JavaScript
              <textarea
                aria-label="JavaScript"
                value={stringValue(config.code)}
                rows={9}
                spellCheck={false}
                maxLength={limits.customCodeBytes}
                onChange={(event) => updateConfig({ code: event.target.value })}
              />
            </label>
            <p className="muted">
              Read <code>items</code> and return an array of items.
            </p>
          </>
        )}
        <button className="danger-button" type="button" onClick={remove}>
          Delete node
        </button>
      </fieldset>
    </section>
  )
}
