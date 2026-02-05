import { config } from "../config";

export type ClickHouseResult<T> = {
  data: T[];
  rows: number;
  statistics?: Record<string, unknown>;
};

function buildUrl(sql: string) {
  const url = new URL(config.clickhouse.url);
  url.searchParams.set("user", config.clickhouse.user);
  if (config.clickhouse.password) {
    url.searchParams.set("password", config.clickhouse.password);
  }
  url.searchParams.set("query", `${sql} FORMAT JSON`);
  return url;
}

function buildAuthUrl() {
  const url = new URL(config.clickhouse.url);
  url.searchParams.set("user", config.clickhouse.user);
  if (config.clickhouse.password) {
    url.searchParams.set("password", config.clickhouse.password);
  }
  return url;
}

export async function clickhouseQuery<T>(sql: string): Promise<ClickHouseResult<T>> {
  const response = await fetch(buildUrl(sql), {
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickHouse error ${response.status}: ${text}`);
  }

  const payload = await response.json();
  return {
    data: payload.data ?? [],
    rows: payload.rows ?? 0,
    statistics: payload.statistics,
  } as ClickHouseResult<T>;
}

export async function clickhouseInsert(table: string, rows: unknown[]) {
  if (!rows.length) return;
  const chunkSize = Math.max(1, config.clickhouse.insertBatchRows);

  async function insertChunk(chunk: unknown[]) {
    const url = buildAuthUrl();
    url.searchParams.set("query", `INSERT INTO ${table} FORMAT JSONEachRow`);

    const body = chunk.map((row) => JSON.stringify(row)).join("\n");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ClickHouse insert error ${response.status}: ${text}`);
    }
  }

  function isMemoryError(error: unknown) {
    return /MEMORY_LIMIT_EXCEEDED|memory limit exceeded/i.test(String(error));
  }

  async function insertAdaptive(chunk: unknown[]): Promise<void> {
    if (!chunk.length) return;
    try {
      await insertChunk(chunk);
      return;
    } catch (error) {
      if (chunk.length > 1 && isMemoryError(error)) {
        const mid = Math.floor(chunk.length / 2);
        await insertAdaptive(chunk.slice(0, mid));
        await insertAdaptive(chunk.slice(mid));
        return;
      }
      throw error;
    }
  }

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await insertAdaptive(chunk);
  }
}

export async function clickhouseExec(sql: string) {
  const url = buildAuthUrl();
  url.searchParams.set("query", sql);

  const response = await fetch(url, {
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickHouse exec error ${response.status}: ${text}`);
  }
}
