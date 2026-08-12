import { PrismaClient } from "@prisma/client";

/**
 * Global PrismaClient singleton.
 *
 * Replaces the previous pattern of creating a new PrismaClient on every
 * function call via `new Function("specifier", "return import(specifier)")`.
 * That pattern re-established a database connection (TCP handshake + auth)
 * on every single query, which was the primary cause of slow page navigation.
 *
 * With this singleton, the connection pool is reused across all requests.
 */
const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
