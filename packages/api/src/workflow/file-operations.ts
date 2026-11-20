import { limits } from '@packages/contracts';
import type { DataItem, FileRef } from '@packages/contracts';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

import { WorkflowProblem } from './problems.ts';

export const fileMime = {
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
} as const;
export type FileFormat = keyof typeof fileMime;

export interface FileStorage {
  read(fileId: string, signal: AbortSignal): Promise<Buffer>;
  write(
    file: { fileName: string; format: FileFormat; bytes: Buffer },
    signal?: AbortSignal,
  ): Promise<FileRef>;
}

export function decodeText(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Unexpected NUL byte');
    return text;
  } catch {
    throw new WorkflowProblem({
      code: 'INVALID_UTF8',
      message: 'Use a UTF-8 text file.',
    });
  }
}

function singleItem(items: DataItem[], operation: string) {
  if (items.length !== 1)
    throw new WorkflowProblem({
      code: 'INVALID_FILE_INPUT',
      message: `${operation} expects exactly one input item.`,
    });
  return items[0];
}

export async function readFile(
  items: DataItem[],
  sourceKey: string,
  storage: FileStorage,
  signal: AbortSignal,
): Promise<DataItem[]> {
  const item = singleItem(items, 'Read');
  const ref = item.files?.[sourceKey];
  if (!ref?.fileId)
    throw new WorkflowProblem({
      code: 'MISSING_FILE',
      message: `No input file at files.${sourceKey}.`,
    });
  const content = decodeText(await storage.read(ref.fileId, signal));
  return [{ ...item, json: { ...item.json, content } }];
}

export function parseFile(items: DataItem[], format: FileFormat): DataItem[] {
  const { content } = singleItem(items, 'Parse').json;
  if (typeof content !== 'string')
    throw new WorkflowProblem({
      code: 'MISSING_CONTENT',
      message: 'Connect a Read node or provide a text field named content.',
    });
  if (Buffer.byteLength(content) > limits.fileBytes)
    throw new WorkflowProblem({
      code: 'FILE_LIMIT',
      message: 'Text exceeds 2 MiB.',
    });
  if (format !== 'csv') return [{ json: { text: content } }];

  let records: string[][];
  try {
    records = parse(content, {
      bom: true,
      skip_empty_lines: true,
      to: limits.items + 2,
      max_record_size: limits.fileBytes,
    });
  } catch {
    throw new WorkflowProblem({
      code: 'INVALID_CSV',
      message: 'Provide well-formed CSV with a header and consistent columns.',
    });
  }
  const [header, ...rows] = records;
  if (
    !header ||
    header.some((name) => !name.trim()) ||
    new Set(header).size !== header.length
  )
    throw new WorkflowProblem({
      code: 'INVALID_CSV_HEADER',
      message: 'CSV column names must be present and unique.',
    });
  if (rows.length > limits.items)
    throw new WorkflowProblem({
      code: 'ITEM_LIMIT',
      message: 'CSV exceeds 1,000 rows.',
    });
  return rows.map((row) => ({
    json: Object.fromEntries(header.map((name, column) => [name, row[column]])),
  }));
}

export async function writeFile(
  items: DataItem[],
  format: FileFormat,
  fileName: string,
  storage: FileStorage,
  signal: AbortSignal,
): Promise<DataItem[]> {
  if (!fileName.toLowerCase().endsWith(`.${format}`)) fileName += `.${format}`;
  let content: string;
  if (format === 'csv') {
    const columns = [
      ...new Set(items.flatMap(({ json }) => Object.keys(json))),
    ];
    const lines = [stringify([columns], { escape_formulas: true })];
    let byteCount = Buffer.byteLength(lines[0]);
    for (const { json } of items) {
      signal.throwIfAborted();
      const row = columns.map((key) => {
        const value = Object.hasOwn(json, key) ? json[key] : null;
        return typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : value;
      });
      const line = stringify([row], { escape_formulas: true });
      byteCount += Buffer.byteLength(line);
      if (byteCount > limits.fileBytes)
        throw new WorkflowProblem({
          code: 'FILE_LIMIT',
          message: 'File exceeds 2 MiB.',
        });
      lines.push(line);
    }
    content = lines.join('');
  } else {
    const lines = items.map(({ json }) => {
      const text = json.summary ?? json.text ?? JSON.stringify(json);
      return typeof text === 'string' ? text : JSON.stringify(text);
    });
    content =
      format === 'md'
        ? `# Workflow results\n\n${lines.map((line) => `- ${line}`).join('\n')}\n`
        : `${lines.join('\n')}\n`;
  }
  const result = await storage.write(
    { fileName, format, bytes: Buffer.from(content) },
    signal,
  );
  return [{ json: { fileName: result.fileName }, files: { result } }];
}
