FROM node:20-alpine

ENV NODE_ENV=production
EXPOSE 8080/tcp
WORKDIR /app

RUN corepack enable
COPY ["package.json", "pnpm-lock.yaml", "./"]
RUN pnpm install --prod --frozen-lockfile

COPY . .

ENV PORT=8080
CMD ["node", "src/index.js"]
