# syntax=docker/dockerfile:1
# ─── Build : dépendances, client Prisma, compilation TypeScript et dashboard ───
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY dashboard/frontend/package.json dashboard/frontend/
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# ─── Migrations : exécute `prisma migrate deploy` puis s'arrête ───
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ─── Exécution : uniquement le nécessaire, utilisateur non root ───
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/dashboard/frontend/package.json dashboard/frontend/
RUN npm ci --omit=dev --ignore-scripts --workspaces=false && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dashboard/frontend/dist ./dashboard/frontend/dist
USER node
CMD ["node", "dist/bot/index.js"]
