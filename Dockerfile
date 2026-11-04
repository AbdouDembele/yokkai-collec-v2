# Front image built by GitHub Actions (.github/workflows/image.yml) and pulled
# by Coolify, so production no longer builds on the game server.
# Mirrors railpack.json exactly: Node 22, npm ci --include=dev, Webpack build,
# npm run start. Dev dependencies stay installed, as with Railpack.
#
# NEXT_PUBLIC_* values and CSP_ENFORCE are inlined at build time: they come from
# the repository Actions variables. Server secrets (Supabase secret key, VAPID
# private key, Stripe, push secret...) are never build arguments: Coolify
# provides them at runtime only.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# The prepare script only configures local git hooks.
RUN npm ci --include=dev --ignore-scripts && npm rebuild
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_GIPHY_API_KEY
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_AUTH_SUPPORT_URL
ARG NEXT_PUBLIC_STABLE_BINDERS_ENABLED
ARG NEXT_PUBLIC_I18N_ENABLED
ARG CSP_ENFORCE
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
