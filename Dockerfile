FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=995:985 /app/package.json ./package.json
COPY --from=build --chown=995:985 /app/node_modules ./node_modules
COPY --from=build --chown=995:985 /app/dist ./dist

USER 995:985
EXPOSE 4100

CMD ["npm", "start"]
