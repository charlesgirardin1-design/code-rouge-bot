import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `prisma generate` ne nécessite pas de connexion : une URL vide suffit dans ce cas.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
