import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

import { transaction } from './postgres.ts';

const directory = new URL('../../migrations/', import.meta.url);

export async function migrate(pool: Pool) {
  const files = (await readdir(directory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(941623)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)',
    );
    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations',
    );
    const applied = new Set(rows.map(({ name }) => name));
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        file,
      ]);
    }
  });
}
