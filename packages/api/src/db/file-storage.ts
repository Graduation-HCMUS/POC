import { limits } from '@packages/contracts';
import type { FileRef } from '@packages/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Pool } from 'pg';

import { decodeText, fileMime } from '../workflow/file-operations.ts';
import type { FileFormat, FileStorage } from '../workflow/file-operations.ts';
import { WorkflowProblem } from '../workflow/problems.ts';

type StoredFile = FileRef & { storageKey: string };
const uploadMime: Record<FileFormat, string[]> = {
  csv: [fileMime.csv, 'text/plain', 'application/vnd.ms-excel'],
  md: [fileMime.md, 'text/x-markdown', 'text/plain'],
  txt: [fileMime.txt],
};

export function localFileStorage(pool: Pool, directory: string) {
  async function get(fileId: string) {
    const { rows } = await pool.query<StoredFile>(
      `SELECT id AS "fileId", file_name AS "fileName", mime_type AS "mimeType",
       size_bytes AS "sizeBytes", storage_key AS "storageKey" FROM stored_files WHERE id = $1`,
      [fileId],
    );
    const metadata = rows[0];
    if (!metadata) throw missingFile();
    return { metadata, path: join(directory, metadata.storageKey) };
  }

  const write: FileStorage['write'] = async (
    { fileName, format, bytes },
    signal,
  ) => {
    if (bytes.length > limits.fileBytes) {
      throw new WorkflowProblem({
        code: 'FILE_LIMIT',
        message: 'File exceeds 2 MiB.',
      });
    }
    if (
      fileName.length > 160 ||
      /[\\/]/.test(fileName) ||
      Array.from(fileName).some(
        (character) => character < ' ' || character === '\u007f',
      )
    ) {
      throw new WorkflowProblem({
        code: 'INVALID_FILENAME',
        message:
          'Use a file name without path separators or control characters (at most 160 characters).',
      });
    }
    decodeText(bytes);
    const fileId = randomUUID();
    const filePath = join(directory, fileId);
    const mimeType = fileMime[format];
    await mkdir(directory, { recursive: true });
    signal?.throwIfAborted();
    try {
      await writeFile(filePath, bytes, { flag: 'wx', signal });
      signal?.throwIfAborted();
      await pool.query(
        `INSERT INTO stored_files (id, file_name, mime_type, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileId, fileName, mimeType, bytes.length, fileId],
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        await unlink(filePath).catch(() => {});
      throw error;
    }
    return { fileId, fileName, mimeType, sizeBytes: bytes.length };
  };

  return {
    get,
    async stat(fileId: string): Promise<FileRef> {
      const {
        metadata: { fileName, mimeType, sizeBytes },
      } = await get(fileId);
      return { fileId, fileName, mimeType, sizeBytes };
    },
    write,
    async read(fileId: string, signal: AbortSignal) {
      const file = await get(fileId);
      try {
        return await readFile(file.path, { signal });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw missingFile();
        throw error;
      }
    },
    upload(file: Express.Multer.File) {
      const extension = extname(file.originalname).slice(1).toLowerCase();
      const format = extension as FileFormat;
      if (
        !Object.hasOwn(fileMime, extension) ||
        (file.mimetype !== 'application/octet-stream' &&
          !uploadMime[format].includes(file.mimetype))
      ) {
        throw new WorkflowProblem({
          code: 'UNSUPPORTED_FILE',
          message: 'Upload a CSV, Markdown, or TXT file.',
        });
      }
      return write({ fileName: file.originalname, format, bytes: file.buffer });
    },
  };
}

function missingFile() {
  return new WorkflowProblem({
    code: 'FILE_NOT_FOUND',
    message: 'File was not found.',
  });
}
