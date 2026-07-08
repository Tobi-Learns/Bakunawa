import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// TRANSACTION_URL = pooled connection for all runtime queries.
// SESSION_URL / DIRECT_URL are for CLI (db push) — see prisma.config.ts.
function makeClient() {
  const adapter = new PrismaPg({ connectionString: process.env.TRANSACTION_URL! });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
