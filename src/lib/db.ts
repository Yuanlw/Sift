import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getServerEnv } from "@/lib/env";

let pool: Pool | undefined;

export function getDb() {
  if (!pool) {
    const env = getServerEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  const result = await getDb().query<T>(text, values);
  return result;
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getDb().connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
