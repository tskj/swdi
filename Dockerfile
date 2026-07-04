# Deterministic build (avoids Railway's nixpacks nix-env step, which can stall during the build).
# Single stage keeps node_modules available for both the build and the runtime start/preDeploy
# (migrations) — fine for a small app. The runtime start command is set in railway.json.
FROM node:24-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

WORKDIR /app

# Install ALL deps (devDeps are needed for `next build`). This is a pnpm workspace, so the lockfile
# resolve needs every member's package.json in place — copy just those manifests first to keep the
# install layer cacheable across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY extension/package.json extension/
RUN pnpm install --frozen-lockfile

# Build. `next build` imports the db module (which requires DATABASE_URL) while collecting route
# config; pages are dynamic so nothing actually connects. Give it a throwaway URL for the build step
# only — Railway injects the real DATABASE_URL at runtime.
COPY . .
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm build

EXPOSE 3000
# Overridden by railway.json deploy.startCommand, but sane as a default.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
