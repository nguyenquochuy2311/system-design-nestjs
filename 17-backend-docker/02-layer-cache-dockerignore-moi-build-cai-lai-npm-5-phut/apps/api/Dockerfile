# [PATTERN] Layer caching cho @lab/api trong monorepo pnpm. Build từ gốc monorepo (`.dockerignore` ở gốc context):
#   docker buildx build -f apps/api/Dockerfile --target runtime \
#     --cache-from type=registry,ref=localhost:58500/lab-17-02/api:buildcache \
#     --cache-to type=registry,ref=localhost:58500/lab-17-02/api:buildcache,mode=max .
# Thứ tự stage theo tần suất thay đổi: lockfile (hiếm) → manifest → thư viện chung → mã nguồn API (thường xuyên).
ARG NODE_IMAGE=node:20.20.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# --- base: Node + pnpm. Không phụ thuộc file nào của repo nên luôn trúng cache.
FROM ${NODE_IMAGE} AS base
LABEL lab.id="17-02"
RUN npm install -g pnpm@10.32.0
WORKDIR /app

# --- deps: [PATTERN] chỉ lockfile + file workspace → `pnpm fetch` tải gói vào kho; khóa cache chỉ đổi khi lockfile đổi.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
# [PATTERN] cache mount: kho gói pnpm nằm trong builder (không vào layer, không vào image), giữ giữa các lần build.
# Lockfile đổi thì bước này chạy lại nhưng chỉ tải gói chưa có trong kho.
RUN --mount=type=cache,id=lab-17-02-pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir /pnpm/store
# [PATTERN] manifest của mọi package trước mã nguồn; cài từ kho đã tải (`--prefer-offline`: kho trống — builder mới mà
# bước fetch lại trúng cache registry — thì vẫn tải được, không lỗi như `--offline`).
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=lab-17-02-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm/store

# --- shared: thư viện chung đổi ít hơn API nên build trước, ở stage riêng.
FROM deps AS shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
RUN pnpm --filter @lab/shared run build

# --- prod-deps: [PATTERN] `pnpm deploy --prod` đặt TRƯỚC mã nguồn API: sửa `apps/api/src` không làm bước này chạy lại,
# và runner mới không cần kho gói để dựng lại node_modules production (bước này trúng cache registry).
FROM shared AS prod-deps
RUN --mount=type=cache,id=lab-17-02-pnpm-store,target=/pnpm/store \
    pnpm --filter @lab/api deploy --prod --prefer-offline --store-dir /pnpm/store /out

# --- build: mã nguồn API (đổi thường xuyên nhất) vào sau cùng; chỉ chép thứ cần để biên dịch.
FROM shared AS build
COPY apps/api/package.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json apps/api/
COPY apps/api/src apps/api/src
RUN pnpm --filter @lab/api run build

# --- runtime: chỉ node_modules production + dist (như bài 17/01), chạy user `node`.
FROM ${NODE_IMAGE} AS runtime
LABEL lab.id="17-02" lab.variant="pattern" lab.stage="runtime"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /out/package.json ./package.json
COPY --from=prod-deps /out/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

# --- context-probe: chỉ dùng để kiểm build context mà BuildKit nhận sau khi áp `.dockerignore` (test (a)).
FROM scratch AS context-probe
COPY . /ctx
