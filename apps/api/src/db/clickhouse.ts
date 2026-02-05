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
  const url = new URL(config.clickhouse.url);
  url.searchParams.set("user", config.clickhouse.user);
  if (config.clickhouse.password) {
    url.searchParams.set("password", config.clickhouse.password);
  }
  url.searchParams.set("query", `INSERT INTO ${table} FORMAT JSONEachRow`);

  const body = rows.map((row) => JSON.stringify(row)).join("\n");
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

export async function clickhouseExec(sql: string) {
  const url = new URL(config.clickhouse.url);
  url.searchParams.set("user", config.clickhouse.user);
  if (config.clickhouse.password) {
    url.searchParams.set("password", config.clickhouse.password);
  }
  url.searchParams.set("query", sql);

  const response = await fetch(url, {
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ClickHouse exec error ${response.status}: ${text}`);
  }
}
