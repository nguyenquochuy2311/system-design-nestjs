# [PATTERN] Multi-stage build cho @lab/api trong monorepo pnpm. Build từ gốc monorepo:
#   docker build -f apps/api/Dockerfile --target runtime -t lab-17-01/api:multi .
#   docker build -f apps/api/Dockerfile --target test .      # CI: chạy test, không tạo image runtime
# Stage build và runtime cùng họ Debian bookworm (glibc) để native module (nếu có) chạy được ở runtime.
ARG NODE_IMAGE=node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# --- base: Node + pnpm, chỉ dùng cho các stage build; không stage runtime nào kế thừa nó.
FROM ${NODE_IMAGE} AS base
LABEL lab.id="17-01"
RUN npm install -g pnpm@10.32.0
WORKDIR /app

# --- deps: [PATTERN] chỉ chép manifest + lockfile, nên layer cài đặt chỉ đổi khi dependency đổi.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# --- build: biên dịch @lab/shared rồi @lab/api (`nest build`). Chỉ chép thư mục package cần, không `COPY . .`.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter "@lab/api..." run build

# --- test: [PATTERN] chỉ được build khi gọi `--target test`; runtime không phụ thuộc stage này.
FROM build AS test
LABEL lab.stage="test"
RUN pnpm --filter @lab/api test

# --- prod-deps: [PATTERN] `pnpm deploy --prod` tạo thư mục tự đủ: package.json, dist (theo `files`)
# và node_modules chỉ gồm dependency production (kể cả @lab/shared đã build, được inject).
FROM build AS prod-deps
RUN pnpm --filter @lab/api deploy --prod /out

# --- runtime: [PATTERN] base gọn, chỉ nhận dist + node_modules production; không pnpm, không mã nguồn.
FROM ${NODE_IMAGE} AS runtime
LABEL lab.id="17-01" lab.variant="multi-stage" lab.stage="runtime"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /out/package.json ./package.json
COPY --from=prod-deps /out/node_modules ./node_modules
COPY --from=prod-deps /out/dist ./dist
# [PATTERN] chạy bằng user `node` (uid 1000) có sẵn trong image node, không chạy root.
USER node
EXPOSE 3000
# Chạy thẳng node, không qua pnpm/npm (không cần trình quản lý gói ở runtime).
CMD ["node", "dist/main.js"]
