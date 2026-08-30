# syntax=docker/dockerfile:1

# The public site as a container. Built from the repository root, never from
# this directory — the workspace it belongs to is what pnpm resolves against:
#
#   docker build -f apps/web/Dockerfile -t mariva-web .
#
# It sits here rather than at the root because the root holds workspace
# configuration and nothing else (docs/architecture/repository-structure.md),
# and this file describes one workspace member. Its context is filtered by
# `apps/web/Dockerfile.dockerignore` rather than by the root `.dockerignore`,
# which excludes exactly the sources this image is made of.
#
# ## This is not how the site is deployed
#
# apps/web deploys to Vercel (docs/architecture/infrastructure.md §Hosting), and
# Vercel builds it from the repository rather than from an image. This container
# exists so the whole system — API, both front ends and Postgres — can be run on
# one machine with no cloud account, which is what `compose.yaml` does and what
# `docs/deployment.md` names as the rehearsal before any of it is deployed.
#
# ## The API address is compiled in, not configured
#
# `NEXT_PUBLIC_API_URL` is read by the browser, so Next inlines it into the
# client bundle when the site is compiled. It is a build argument here and not a
# runtime variable, because setting it in the container's environment would
# change nothing a page actually reads — the value is already in the JavaScript
# that was shipped. Pointing this image at a different API means rebuilding it.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Corepack reads `packageManager` from the root manifest, so the image gets the
# same pnpm the lockfile was written by rather than whatever is newest. The
# prompt would otherwise block a non-interactive build waiting for a keystroke.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS compile
WORKDIR /repo

# The default matches the fallback every caller in `lib/api.ts` and
# `features/auth/lib/` already applies, so an unconfigured image is the same site
# a developer runs rather than one pointed at `undefined`.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# What turns `output: "standalone"` on in next.config.mjs. Set for this image and
# nowhere else: Vercel must not see it, because Next's standalone server lands
# under `.next/standalone/` and a platform expecting its own output would not
# find a site there.
ENV NEXT_OUTPUT_STANDALONE=1
# Nothing about a container is worth reporting, and the notice Next prints on a
# first run is noise in a log nobody reads interactively.
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
# Filtered to this app's own subgraph — `...` includes what it depends on, which
# is packages/shared, packages/tokens and packages/api-client. --frozen-lockfile
# because a tree that quietly resolved differently than CI's is one nobody can
# reproduce.
#
# --ignore-scripts is what makes that install finish at all. The root manifest's
# `prepare` runs `lefthook install`, which needs a git binary and a .git
# directory — neither of which belongs in an image, and the second of which the
# ignore-file removes on purpose.
#
# Nothing this image needs is lost with it. The scripts pnpm-workspace's
# `allowBuilds` names are Playwright's browser download (a capture script's, not
# this app's), @swc/core (the API's test transform), esbuild (drizzle-kit's) and
# lefthook. sharp is the one that would matter, since `next/image` optimises on
# request — and its platform binary arrives as the `@img/sharp-linux-x64`
# optional dependency, which pnpm resolves and unpacks without running anything.
#
# `sharing=locked` because three images share this one store and `compose build`
# starts all three at once. BuildKit's default lets them write to it
# concurrently, which is a pnpm store two processes are indexing at the same
# time; the install that loses that race fails with no useful message.
RUN --mount=type=cache,id=pnpm-store,sharing=locked,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter=@mariva/web...
# turbo, not `next` directly: this app's build task `dependsOn: ["^build"]`, and
# the three packages it imports publish types and JS out of their own dist.
# Calling next here would compile against a dist that was never written.
#
# The task is `next build` followed by `scripts/check-bundle-budget.ts`, which
# reads the emitted chunks and fails if the funnel picked up three / gsap /
# lenis. It runs inside the image for the reason it runs in CI: a compile that
# shipped the WebGL stack into the conversion path should not produce an
# artifact at all.
RUN pnpm exec turbo run build --filter=@mariva/web

FROM base AS runtime
WORKDIR /app
# Set only now. Declaring it in the stage above would have made `pnpm install`
# skip the devDependencies that compile the site.
ENV NODE_ENV=production
ENV PORT=3000
# Next's standalone server binds 127.0.0.1 unless told otherwise, which inside a
# container is reachable from nothing outside it.
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Three copies and not one, because `output: "standalone"` deliberately writes
# three things to three places: the traced server with the node_modules it
# actually reached, then the static chunks and the public assets, which Next
# leaves behind because it assumes a CDN in front — and which nothing here would
# serve if they were missing. The paths keep the workspace's shape, because
# `outputFileTracingRoot` is the repository root, so the server sits under
# apps/web the way it does in the tree.
COPY --from=compile --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=compile --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=compile --chown=node:node /repo/apps/web/public ./apps/web/public

# Nothing here writes to disk and nothing needs to install: the process renders
# from its own bundle and reads everything else from the API.
USER node
EXPOSE 3000

# Directly, with no shell wrapper and no init: a shell in front of the server
# would take SIGTERM itself and leave Next's own handler waiting for a signal
# that never arrives, so a `compose down` would end in a ten-second kill.
CMD ["node", "apps/web/server.js"]
