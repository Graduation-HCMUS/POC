import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export function openPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
  });
}

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
