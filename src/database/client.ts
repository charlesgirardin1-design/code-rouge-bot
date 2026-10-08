import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

let instance: PrismaClient | undefined;

/** Instance unique de Prisma par processus (un seul pool de connexions). */
export function getPrisma(): PrismaClient {
  if (!instance) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) throw new Error("DATABASE_URL n'est pas défini");
    instance = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return instance;
}

export async function disconnectPrisma(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
    instance = undefined;
  }
}

export * from "../generated/prisma/client.js";
