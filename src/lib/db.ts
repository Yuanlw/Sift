import { Pool, type QueryResultRow } from "pg";
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
