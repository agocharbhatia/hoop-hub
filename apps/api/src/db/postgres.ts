import postgres from "postgres";
import { config } from "../config";

let sqlClient: ReturnType<typeof postgres> | null = null;

export function getPostgres() {
  if (!config.postgresUrl) {
    throw new Error("POSTGRES_URL is not configured");
  }
  if (!sqlClient) {
    sqlClient = postgres(config.postgresUrl, { max: 5 });
  }
  return sqlClient;
}
