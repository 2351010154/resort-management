# syntax=docker/dockerfile:1

# The API as a container. Built from the repository root, never from this
# directory — the workspace it belongs to is what pnpm resolves against, so the
# context is the whole tree and `.dockerignore` at the root is what keeps that
# affordable:
#
#   docker build -f apps/api/Dockerfile -t mariva-api .
#
# It sits here rather than at the root because the root holds workspace
# configuration and nothing else (docs/architecture/repository-structure.md),
# and this file describes one workspace member.
#
# ## Migrations are not run here
#
# `main.ts` calls `assertMigrationsApplied` before the port opens, so a container
# pointed at a database behind this build refuses to start and says which
# migration is missing. That check is the reason an entrypoint does not migrate:
# a deploy that migrated on its own would have every replica racing to apply the
# same DDL, and the guard exists precisely to make "schema first, then process"
# an ordering somebody performs rather than one a container improvises.
# `docs/deployment.md` owns that step.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Corepack reads `packageManager` from the root manifest, so the image gets the
# same pnpm the lockfile was written by rather than whatever is newest. The
# prompt would otherwise block a non-interactive build waiting for a keystroke.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY . .
# Filtered to the API's own subgraph — `...` includes what it depends on, which
# is packages/shared and nothing else. --frozen-lockfile because a build that
# quietly resolved a different tree than CI did is a build nobody can reproduce.
#
# --ignore-scripts is what makes that install finish at all. The root manifest's
# `prepare` runs `lefthook install`, which needs a git binary and a .git
# directory — neither of which belongs in an image, and the second of which
# .dockerignore removes on purpose. It fails the whole install rather than the
# one hook nobody here is committing through.
#
# Nothing this image needs is lost with it. The install scripts pnpm-workspace's
# `allowBuilds` names link platform binaries for drizzle-kit's esbuild, vitest's
# @swc/core, Playwright and sharp — a migration tool, a test runner and two
# things belonging to apps/web. The build below is `tsc`, which needs none of
# them, and the runtime is plain node. @node-rs/argon2, the one native module
# that is a runtime dependency, resolves its platform binary through
# optionalDependencies rather than through a script, so it is unaffected.
#
# `sharing=locked` because three images now share this one store — the API, the
# public site and the staff console — and `compose build` starts all three at
# once. BuildKit's default lets them write to it concurrently, which is a pnpm
# store two processes are indexing at the same time; the install that loses that
# race fails with no useful message. Locked queues them instead, and the second
# build finds the packages the first just fetched.
RUN --mount=type=cache,id=pnpm-store,sharing=locked,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter=@mariva/api...
# turbo, not `tsc` directly: the API's build `dependsOn: ["^build"]`, and
# packages/shared publishes types and JS out of its own dist. Calling tsc here
# would compile against a dist that was never built.
RUN pnpm exec turbo run build --filter=@mariva/api
# Collapses the workspace into one self-contained directory: the API's own
# files, its production dependencies, and packages/shared resolved as a real
# directory rather than a symlink pointing outside the image. --prod drops the
# devDependencies the build needed and the runtime does not.
#
# --legacy because pnpm 10 made `deploy` refuse any workspace that has not set
# `inject-workspace-packages=true`. Turning that on is a workspace-wide change
# to how every local dependency is linked in development, which is a real
# decision for the repository rather than one an image build gets to make on its
# way past; the flag asks for the old behaviour here and leaves the workspace's
# own linking alone.
#
# --ignore-scripts again, and for the same reason as the install above: `deploy`
# resolves the production tree by running an install of its own into /app, which
# reaches the root `prepare` and the git binary that is not there.
RUN pnpm --filter=@mariva/api --prod --legacy --ignore-scripts deploy /app

FROM base AS runtime
WORKDIR /app
# Set only now. Declaring it in the build stage would have made `pnpm install`
# skip the devDependencies that compile TypeScript.
ENV NODE_ENV=production
# The port `env.ts` defaults to, so a platform that injects none still matches
# what this image advertises.
ENV PORT=3001

COPY --from=build --chown=node:node /app ./

# Nothing here writes to disk and nothing needs to install: the process reads
# its configuration from the environment and its state from Postgres.
USER node
EXPOSE 3001

# Directly, with no shell wrapper and no init: `enableShutdownHooks` in main.ts
# drains the pool on SIGTERM, and a shell in front of it would take the signal
# and leave in-flight queries cut at the socket.
CMD ["node", "dist/main.js"]
