import { defineConfig } from "prisma/config";
import { readFileSync } from "fs";
import { resolve } from "path";

// Prisma 7 doesn't auto-load .env for the config file — load it manually.
// DIRECT_URL is used by the CLI (db push / migrate) for a direct Postgres connection.
// TRANSACTION_URL (pooled) is passed to PrismaClient at runtime in src/lib/db.ts.
// SESSION_URL is available in .env as an additional fallback.
function loadEnv(path: string) {
  try {
    const lines = readFileSync(path, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* .env not found */ }
}

loadEnv(resolve(process.cwd(), ".env"));

// SESSION_URL = pooler session mode port 5432 (DDL-safe, but blocked by some VPNs)
// TRANSACTION_URL = pooler transaction mode port 6543 (works through VPN, simple DDL ok)
// DIRECT_URL = direct db host port 5432 (usually blocked by Supabase network rules)
// Try each URL in order of port availability.
// SESSION_URL (5432) is blocked by some VPNs — fall through to TRANSACTION_URL (6543).
const candidates = [
  process.env.SESSION_URL,
  process.env.TRANSACTION_URL,
  process.env.DIRECT_URL,
].filter(Boolean) as string[];
const cliUrl = candidates.find((u) => !u.includes(":5432")) ?? candidates[0];

export default defineConfig({
  datasource: {
    url: cliUrl,
  },
});
