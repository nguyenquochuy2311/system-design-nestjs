# Danh mục nguồn tham khảo được phép trích dẫn

Đây là **danh mục chuẩn** của repo. Mọi pattern trong README bài toán phải truy được về một mục ở đây
hoặc về tài liệu chính thức của công nghệ đang dùng. Nguồn mới: thêm vào đúng nhóm, kèm năm và URL
(nếu có) trước khi dùng. Nguồn chưa chắc tồn tại: ghi `(cần xác minh)` ở cả đây và ở bài.

Thứ tự ưu tiên khi trích dẫn: tài liệu của tác giả gốc → spec / RFC / docs chính thức → sách tổng
hợp → paper → case study công khai → blog kỹ thuật.

## A. Sách nền tảng

| Mã | Tài liệu | Dùng cho |
|---|---|---|
| PoEAA | Martin Fowler, *Patterns of Enterprise Application Architecture*, Addison-Wesley, 2002. Catalog: https://martinfowler.com/eaaCatalog/ | Layering, Service Layer, Repository, Transaction Script, Domain Model, Optimistic/Pessimistic Offline Lock, Gateway, Session State |
| DDIA | Martin Kleppmann, *Designing Data-Intensive Applications*, O'Reilly, 2017 | Encoding & evolution (ch.4), Replication (ch.5), Partitioning (ch.6), Transactions (ch.7), Consistency & Consensus (ch.9), Stream processing & CDC (ch.11) |
| EIP | Gregor Hohpe & Bobby Woolf, *Enterprise Integration Patterns*, Addison-Wesley, 2003. https://www.enterpriseintegrationpatterns.com/patterns/messaging/ | Competing Consumers, Dead Letter Channel, Idempotent Receiver, Claim Check, Request-Reply, Correlation Identifier, Resequencer, Message Bus |
| MSP | Chris Richardson, *Microservices Patterns*, Manning, 2018. Catalog: https://microservices.io/patterns/ | Saga, API Gateway, API Composition, Database per Service, Transactional Outbox, Idempotent Consumer, Service Discovery, CQRS |
| BM | Sam Newman, *Building Microservices*, 2nd ed., O'Reilly, 2021 | Decomposition, ownership, communication styles |
| M2M | Sam Newman, *Monolith to Microservices*, O'Reilly, 2019 | Strangler Fig, Branch by Abstraction, Parallel Run, tách DB |
| RI | Michael Nygard, *Release It!*, 2nd ed., Pragmatic Bookshelf, 2018 | Circuit Breaker, Bulkhead, Timeouts, Fail Fast, Steady State |
| SRE | Google, *Site Reliability Engineering*, O'Reilly, 2016. https://sre.google/sre-book/table-of-contents/ | SLO (ch.4), Monitoring & Four Golden Signals (ch.6), Handling Overload (ch.21), Cascading Failures (ch.22) |
| SREW | Google, *The Site Reliability Workbook*, O'Reilly, 2018. https://sre.google/workbook/table-of-contents/ | Implementing SLOs (ch.2), Alerting on SLOs (ch.5) |
| DDD | Eric Evans, *Domain-Driven Design*, Addison-Wesley, 2003 | Bounded Context, Aggregate, Ubiquitous Language |
| CA | Robert C. Martin, *Clean Architecture*, Prentice Hall, 2017 | Dependency rule, ports & adapters |
| IIR | Manning, Raghavan, Schütze, *Introduction to Information Retrieval*, Cambridge UP, 2008. https://nlp.stanford.edu/IR-book/ | Inverted index (ch.1), evaluation: precision@k, MRR (ch.8), faceted search |
| SP | Brendan Gregg, *Systems Performance*, 2nd ed., Addison-Wesley, 2020 | USE method, benchmarking (ch.12), flame graphs |
| DSO | Cindy Sridharan, *Distributed Systems Observability*, O'Reilly, 2018 | Logs/metrics/traces |
| AIE | Chip Huyen, *AI Engineering*, O'Reilly, 2025 | Model selection, evaluation, RAG & agents, inference optimization |
| DMLS | Chip Huyen, *Designing Machine Learning Systems*, O'Reilly, 2022 | Data distribution shift (ch.8), monitoring |
| SEG | Winters, Manshreck, Wright (eds.), *Software Engineering at Google*, O'Reilly, 2020. https://abseil.io/resources/swe-book | Code review (ch.9), Version control & monorepo (ch.16) |
| DAM | Peter Krogh, *The DAM Book*, O'Reilly, 2005/2009 | Quy tắc backup 3-2-1 |

## B. Danh mục pattern trực tuyến

| Mã | Tài liệu | Ghi chú |
|---|---|---|
| AAC | Microsoft Azure Architecture Center, *Cloud Design Patterns*. https://learn.microsoft.com/azure/architecture/patterns/ | Cache-Aside, Circuit Breaker, Bulkhead, Retry, Queue-Based Load Leveling, Competing Consumers, Asynchronous Request-Reply, Claim-Check, Sequential Convoy, Priority Queue, Publisher-Subscriber, Gateway Aggregation/Routing/Offloading, Backends for Frontends, Strangler Fig, CQRS, Event Sourcing, Materialized View, Sharding, Valet Key, Static Content Hosting, Health Endpoint Monitoring, Rate Limiting, Throttling, Sidecar, Ambassador, Anti-Corruption Layer, Saga, Choreography, Pipes and Filters, Scheduler Agent Supervisor, Federated Identity |
| AAC-MT | Microsoft, *Architect multitenant solutions on Azure* (storage & data; identity). https://learn.microsoft.com/azure/architecture/guide/multitenant/overview | Multi-tenant |
| MS-SaaS | Microsoft Learn, *Multitenant SaaS database tenancy patterns*. https://learn.microsoft.com/azure/azure-sql/database/saas-tenancy-app-design-patterns | Shared schema / schema-per-tenant / DB-per-tenant |
| MSIO | microservices.io (Chris Richardson). https://microservices.io/patterns/index.html | Xem mã MSP |
| FB | Martin Fowler bliki: CQRS (2011) https://martinfowler.com/bliki/CQRS.html · Event Sourcing (2005) https://martinfowler.com/eaaDev/EventSourcing.html · StranglerFigApplication (2004) https://martinfowler.com/bliki/StranglerFigApplication.html · ParallelChange (Danilo Sato, 2014) https://martinfowler.com/bliki/ParallelChange.html · BranchByAbstraction (2014) https://martinfowler.com/bliki/BranchByAbstraction.html · CircuitBreaker (2014) https://martinfowler.com/bliki/CircuitBreaker.html · CanaryRelease (2014) https://martinfowler.com/bliki/CanaryRelease.html · BlueGreenDeployment (2010) https://martinfowler.com/bliki/BlueGreenDeployment.html · Audit Log https://martinfowler.com/eaaDev/AuditLog.html · Reporting Database https://martinfowler.com/bliki/ReportingDatabase.html · Feature Toggles (Pete Hodgson, 2017) https://martinfowler.com/articles/feature-toggles.html | |
| BFF | Sam Newman, "Pattern: Backends For Frontends", 2015. https://samnewman.io/patterns/architectural/bff/ | |
| ABL | Amazon Builders' Library. https://aws.amazon.com/builders-library/ — "Timeouts, retries, and backoff with jitter" (Marc Brooker); "Making retries safe with idempotent APIs"; "Avoiding insurmountable queue backlogs"; "Using load shedding to avoid overload"; "Caching challenges and strategies" | |
| AWS-JIT | Marc Brooker, "Exponential Backoff And Jitter", AWS Architecture Blog, 2015. https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ | |
| AWS-WA | AWS Well-Architected Framework (Reliability, Performance Efficiency pillars). https://docs.aws.amazon.com/wellarchitected/ | |
| AWS-CACHE | AWS whitepaper, *Database Caching Strategies Using Redis*. https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/ | Cache-aside, write-through, TTL |
| 12F | Adam Wiggins, *The Twelve-Factor App*, 2011. https://12factor.net/ | Config, Backing services, Processes, Disposability, Dev/prod parity, Logs |
| TBD | Paul Hammant, *Trunk Based Development*. https://trunkbaseddevelopment.com/ | |
| HEX | Alistair Cockburn, "Hexagonal architecture", 2005. https://alistair.cockburn.us/hexagonal-architecture/ | |
| MMP | Kamil Grzybek, "Modular Monolith: A Primer", 2019. https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer | |
| SB-MM | Simon Brown, "Modular Monoliths" (bài nói, 2015+). https://simonbrown.je/ (cần xác minh URL slide) | |
| USE | Brendan Gregg, "The USE Method". https://www.brendangregg.com/usemethod.html | |
| RED | Tom Wilkie, "The RED Method: key metrics for microservices architecture", 2018 (bài nói / Grafana Labs blog) | (cần xác minh URL) |
| ALERT | Rob Ewaschuk, "My Philosophy on Alerting" (nền của SRE ch.6). https://docs.google.com/document/d/199PqyG3UsyXlwieHaqbGiWVa8eMWi8zzAn0YfcApr8Q | |
| OGO | OpenGitOps principles. https://opengitops.dev/ | |
| 12FA | Dex Horthy, *12-Factor Agents*, 2025. https://github.com/humanlayer/12-factor-agents | Own your prompts, context window, launch/pause/resume |
| EY-LLM | Eugene Yan, "Patterns for Building LLM-based Systems & Products", 2023. https://eugeneyan.com/writing/llm-patterns/ | Evals, RAG, caching, guardrails, feedback |
| HH-EVAL | Hamel Husain, "Your AI Product Needs Evals", 2024. https://hamel.dev/blog/posts/evals/ | Eval, error analysis |
| OFFLINE | Jake Archibald, "The Offline Cookbook", web.dev. https://web.dev/articles/offline-cookbook | Service worker strategies |
| UTIL | Markus Winand, *Use The Index, Luke*. https://use-the-index-luke.com/ | Index, keyset pagination |
| KLEP-LOCK | Martin Kleppmann, "How to do distributed locking", 2016. https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html | Phản biện Redlock |
| TENE | Gil Tene, "How NOT to Measure Latency" (bài nói, 2015; Strange Loop). | Coordinated omission, percentiles |
| FLAME | Brendan Gregg, "The Flame Graph", CACM 59(6), 2016. https://queue.acm.org/detail.cfm?id=2927301 | |
| NIELSEN | Jakob Nielsen, "Response Times: The 3 Important Limits", 1993. https://www.nngroup.com/articles/response-times-3-important-limits/ | 0.1s / 1s / 10s |

## C. Tài liệu chính thức theo công nghệ

| Công nghệ | URL gốc |
|---|---|
| PostgreSQL | https://www.postgresql.org/docs/ — Full Text Search, Table Partitioning, Row Security Policies, Continuous Archiving & PITR, High Availability/Replication, EXPLAIN |
| PostgreSQL wiki | https://wiki.postgresql.org/wiki/Number_Of_Database_Connections |
| PostgreSQL (trang cụ thể, URL kiểm 2026-10-09) | Release notes 15.0 https://www.postgresql.org/docs/release/15.0/ (thay đổi không tương thích "Remove PUBLIC creation permission on the public schema"; "Change the owner of the public schema to be the new pg_database_owner role"; psql thêm `\getenv`) · Schemas, mục 5.9.6 Usage Patterns https://www.postgresql.org/docs/16/ddl-schemas.html (secure schema usage pattern) · `GRANT` https://www.postgresql.org/docs/16/sql-grant.html · `ALTER DEFAULT PRIVILEGES` https://www.postgresql.org/docs/16/sql-alterdefaultprivileges.html · psql (`\getenv`, `\gexec`) https://www.postgresql.org/docs/16/app-psql.html |
| PgBouncer | https://www.pgbouncer.org/ |
| pgvector | https://github.com/pgvector/pgvector |
| PGMQ | https://github.com/pgmq/pgmq |
| Redis | https://redis.io/docs/ — Pub/Sub, Streams, Keyspace notifications, Client-side caching, "Distributed Locks with Redis" https://redis.io/docs/latest/develop/use/patterns/distributed-locks/ |
| Elasticsearch | https://www.elastic.co/guide/ — Analysis, asciifolding, ICU plugin, Completion suggester, search_as_you_type, Aggregations, function_score, Aliases, Reindex |
| Debezium | https://debezium.io/documentation/ (Outbox Event Router) |
| Apache Kafka | https://kafka.apache.org/documentation/ (Design: delivery semantics, ordering) |
| RabbitMQ | https://www.rabbitmq.com/docs (Dead Letter Exchanges, Delayed Message plugin) |
| NATS / JetStream | https://docs.nats.io/ (Request-Reply) |
| Moleculer | https://moleculer.services/docs/ (Transporters) |
| BullMQ | https://docs.bullmq.io/ |
| Temporal | https://docs.temporal.io/ |
| AWS SQS | https://docs.aws.amazon.com/sqs/ (Dead-letter queues, Delay queues) |
| AWS S3 | https://docs.aws.amazon.com/s3/ (Presigned URLs, Multipart upload, Lifecycle, Storage classes, Versioning, Object Lock) |
| AWS CloudFront | Serving private content with signed URLs and signed cookies |
| AWS Auto Scaling | Target tracking, predictive scaling |
| MinIO | https://min.io/docs/ |
| tus | https://tus.io/protocols/resumable-upload |
| ClamAV | https://docs.clamav.net/ |
| sharp | https://sharp.pixelplumbing.com/ |
| Kubernetes | https://kubernetes.io/docs/ — Probes, Deployments, Pod Lifecycle, Resource Management, HPA, Secrets/ConfigMaps, Ingress, PDB, Affinity, Schedule GPUs, Service |
| External Secrets Operator | https://external-secrets.io/ |
| cert-manager | https://cert-manager.io/docs/ |
| Argo Rollouts | https://argo-rollouts.readthedocs.io/ |
| Argo CD | https://argo-cd.readthedocs.io/ |
| KEDA | https://keda.sh/docs/ |
| Knative Serving | https://knative.dev/docs/serving/ |
| Istio | https://istio.io/latest/docs/ · Linkerd https://linkerd.io/docs/ |
| Docker | https://docs.docker.com/ — Multi-stage builds, Build cache, .dockerignore, HEALTHCHECK, Build secrets, `--init`; Compose `depends_on` conditions |
| Docker (trang cụ thể, URL kiểm 2026-10-09) | Multi-stage builds https://docs.docker.com/build/building/multi-stage/ (mục "Differences between legacy builder and BuildKit": BuildKit chỉ build stage mà target phụ thuộc) · Build context / .dockerignore https://docs.docker.com/build/concepts/context/ (ignore-file riêng `<Dockerfile>.dockerignore` được ưu tiên hơn `.dockerignore` ở gốc) · Build cache https://docs.docker.com/build/cache/ · containerd image store https://docs.docker.com/engine/storage/containerd/ · Image chính thức `registry` https://hub.docker.com/_/registry, `docker` (dind) https://hub.docker.com/_/docker |
| Docker build cache (trang cụ thể, URL kiểm 2026-10-09) | Optimize cache usage https://docs.docker.com/build/cache/optimize/ (Order your layers, Keep the context small, Use cache mounts, Use an external cache) · Cache invalidation https://docs.docker.com/build/cache/invalidation/ · Cache storage backends https://docs.docker.com/build/cache/backends/ (`mode=min` mặc định chỉ cache layer của image kết quả, `mode=max` cache cả bước trung gian; driver `docker` chỉ hỗ trợ registry cache khi bật containerd image store) · Registry cache https://docs.docker.com/build/cache/backends/registry/ · Dockerfile reference `RUN --mount=type=cache` https://docs.docker.com/reference/dockerfile/ · Docker container driver https://docs.docker.com/build/builders/drivers/docker-container/ · Image `moby/buildkit` https://hub.docker.com/r/moby/buildkit |
| Docker Compose và image `postgres` (trang cụ thể, URL kiểm 2026-10-09) | Merge Compose files https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/ (mặc định đọc `compose.yaml` và `compose.override.yaml`) · `docker compose up` https://docs.docker.com/reference/cli/docker/compose/up/ (`--wait`) · Image chính thức `postgres` https://hub.docker.com/_/postgres, nội dung trang tại https://github.com/docker-library/docs/blob/master/postgres/content.md (mục "Initialization scripts": chỉ chạy khi thư mục dữ liệu trống, server tạm chỉ nghe Unix socket) |
| Node.js Docker image | https://hub.docker.com/_/node (biến thể bookworm, bookworm-slim, alpine) · "Docker and Node.js Best Practices" https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md (user `node` có sẵn, `NODE_ENV=production`, chạy thẳng `node`) (URL kiểm 2026-10-09) |
| pnpm và Docker | `pnpm fetch` https://pnpm.io/cli/fetch (tải gói từ lockfile, bỏ qua manifest; thiết kế cho Docker; URL kiểm 2026-10-09) · `pnpm deploy` https://pnpm.io/cli/deploy (pnpm 10 đòi `inject-workspace-packages=true` hoặc `--legacy`) · "Working with Docker" https://pnpm.io/docker · Settings (`injectWorkspacePackages`, `syncInjectedDepsAfterScripts`) https://pnpm.io/settings (URL kiểm 2026-10-09) |
| distroless | https://github.com/GoogleContainerTools/distroless |
| Trivy | https://trivy.dev/ · Container image target https://trivy.dev/latest/docs/target/container_image/ (URL kiểm 2026-10-09) · Syft https://github.com/anchore/syft |
| OCI Image spec | https://github.com/opencontainers/image-spec |
| NGINX | https://nginx.org/en/docs/ (HTTP load balancing; `ngx_http_limit_req_module`) |
| gRPC | https://grpc.io/docs/ · Protocol Buffers https://protobuf.dev/ ("Updating A Message Type") · Apache Avro https://avro.apache.org/docs/ |
| GraphQL | https://graphql.org/learn/ · Apollo Client/Federation https://www.apollographql.com/docs/ |
| OpenAPI | https://spec.openapis.org/oas/latest.html · Microsoft REST API Guidelines https://github.com/microsoft/api-guidelines |
| Công cụ OpenAPI | openapi-typescript / openapi-fetch https://openapi-ts.dev/ · Ajv https://ajv.js.org/ (draft 2020-12) · Spectral https://github.com/stoplightio/spectral · Prism https://github.com/stoplightio/prism · oasdiff https://github.com/oasdiff/oasdiff (URL lấy từ metadata npm/OCI label, 2026-10-08) |
| tRPC | https://trpc.io/docs |
| Socket.IO | https://socket.io/docs/v4/redis-adapter/ |
| Phoenix.Presence | https://hexdocs.pm/phoenix/Phoenix.Presence.html |
| Yjs | https://docs.yjs.dev/ |
| TanStack Query | https://tanstack.com/query/latest · SWR https://swr.vercel.app/ |
| Workbox | https://developer.chrome.com/docs/workbox |
| MDN HTTP caching | https://developer.mozilla.org/docs/Web/HTTP/Caching |
| Redux "Normalizing State Shape" | https://redux.js.org/usage/structuring-reducers/normalizing-state-shape |
| Next.js | https://nextjs.org/docs · Vite https://vite.dev/guide/ |
| NestJS | https://docs.nestjs.com/ |
| Rails Guides (N+1) | https://guides.rubyonrails.org/active_record_querying.html |
| pnpm Workspaces | https://pnpm.io/workspaces · Turborepo https://turborepo.com/docs · Nx https://nx.dev/docs · Changesets https://github.com/changesets/changesets |
| GitHub CODEOWNERS | https://docs.github.com/articles/about-code-owners |
| Semantic Versioning | https://semver.org/ |
| OpenTelemetry | https://opentelemetry.io/docs/ · GenAI semantic conventions https://opentelemetry.io/docs/specs/semconv/gen-ai/ |
| Prometheus | https://prometheus.io/docs/ (Histograms and summaries) |
| Grafana Pyroscope | https://grafana.com/docs/pyroscope/ · Parca https://www.parca.dev/docs/ |
| k6 | https://grafana.com/docs/k6/ (open vs closed model) |
| Toxiproxy | https://github.com/Shopify/toxiproxy (toxic `limit_data`, `timeout`; HTTP API điều khiển) |
| Langfuse | https://langfuse.com/docs · Arize Phoenix https://docs.arize.com/phoenix |
| LiteLLM | https://docs.litellm.ai/ |
| vLLM | https://docs.vllm.ai/ (Automatic Prefix Caching, metrics) |
| Hugging Face TEI | https://huggingface.co/docs/text-embeddings-inference |
| NVIDIA | Kubernetes device plugin https://github.com/NVIDIA/k8s-device-plugin · MIG User Guide https://docs.nvidia.com/datacenter/tesla/mig-user-guide/ |
| Qdrant | https://qdrant.tech/documentation/ (Filtering, Quantization, Multitenancy) |
| Weaviate | https://weaviate.io/developers/weaviate (Named vectors) |
| Pinecone | https://docs.pinecone.io/ (Metadata filtering) |
| Faiss | https://github.com/facebookresearch/faiss/wiki |
| ANN-Benchmarks | https://ann-benchmarks.com/ |
| Cohere Rerank | https://docs.cohere.com/docs/rerank-overview · sentence-transformers https://www.sbert.net/ |
| LangChain / LlamaIndex | https://python.langchain.com/docs/ · https://docs.llamaindex.ai/ · LangGraph https://langchain-ai.github.io/langgraph/ |
| DSPy | https://dspy.ai/ |
| NeMo Guardrails | https://docs.nvidia.com/nemo/guardrails/ |
| Keycloak | https://www.keycloak.org/documentation |
| Auth0 Refresh Token Rotation | https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation |
| Curity Token Handler | https://curity.io/resources/learn/the-token-handler-pattern/ |
| SpiceDB / OpenFGA | https://authzed.com/docs · https://openfga.dev/docs |
| Let's Encrypt / ACME | https://letsencrypt.org/docs/ |
| Node.js | https://nodejs.org/docs/ (process signals, streams, diagnostics) |
| Argon2 (Node) | `@node-rs/argon2` https://www.npmjs.com/package/@node-rs/argon2 (napi-rs, prebuilt theo nền tảng, có darwin-arm64) · node-argon2 https://github.com/ranisalt/node-argon2 (URL kiểm 2026-10-08; node-argon2 0.45.1 prebuild darwin-arm64 lỗi — nhật ký 19/01) |
| Reactive Streams | https://www.reactive-streams.org/ · WHATWG Streams https://streams.spec.whatwg.org/ |

## D. Chuẩn, RFC, spec

| Mã | Tài liệu |
|---|---|
| RFC 9111 | HTTP Caching (2022) |
| RFC 5861 | HTTP Cache-Control Extensions for Stale Content (stale-while-revalidate) |
| RFC 6455 | The WebSocket Protocol |
| HTML-SSE | HTML Living Standard, "Server-sent events" https://html.spec.whatwg.org/multipage/server-sent-events.html |
| RFC 6585 | Additional HTTP Status Codes (định nghĩa 429 Too Many Requests) |
| RFC 6265bis | IETF draft-ietf-httpbis-rfc6265bis, *Cookies: HTTP State Management Mechanism* https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis (tiền tố `__Host-`/`__Secure-`, `SameSite`, điều kiện cookie `Secure`) |
| MDN Set-Cookie | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie (`HttpOnly`, `Secure`, `SameSite`, `Path`, `Domain`, tiền tố cookie) |
| OWASP ZAP | ZAP Baseline Scan https://www.zaproxy.org/docs/docker/baseline-scan/ (quét passive, image `ghcr.io/zaproxy/zaproxy:stable`) |
| RFC 7519 | JSON Web Token (JWT) · RFC 8725 JWT Best Current Practices |
| RFC 6749 | OAuth 2.0 Authorization Framework · RFC 7636 PKCE · RFC 8705 OAuth 2.0 Mutual-TLS · RFC 9700 Best Current Practice for OAuth 2.0 Security (2025) |
| OAUTH-BROWSER | IETF draft, "OAuth 2.0 for Browser-Based Apps" (draft-ietf-oauth-browser-based-apps) |
| OIDC | OpenID Connect Core 1.0 https://openid.net/specs/openid-connect-core-1_0.html |
| OIDC-BCL | OpenID Connect Back-Channel Logout 1.0 https://openid.net/specs/openid-connect-backchannel-1_0.html (cần xác minh URL) |
| RFC 6238 | TOTP · W3C Web Authentication (WebAuthn) Level 3 https://www.w3.org/TR/webauthn-3/ · FIDO Alliance passkeys https://fidoalliance.org/passkeys/ |
| RFC 9106 | Argon2 |
| IDEMP-KEY | IETF draft, "The Idempotency-Key HTTP Header Field" (draft-ietf-httpapi-idempotency-key-header), bản mới nhất -07 (15/10/2025, J. Jena, S. Dalal; datatracker ghi đã hết hạn) https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ |
| STDWEBHOOK | Standard Webhooks specification https://www.standardwebhooks.com/ |
| W3C-TC | W3C Trace Context https://www.w3.org/TR/trace-context/ |
| MCP | Model Context Protocol specification https://modelcontextprotocol.io/ |
| JSON Schema | https://json-schema.org/ |
| CycloneDX / SPDX | SBOM formats https://cyclonedx.org/ · https://spdx.dev/ |
| NIST RBAC | Ferraiolo & Kuhn, "Role-Based Access Controls" (1992); INCITS 359 · NIST SP 800-162 (ABAC Guide, 2014) |

## E. Paper

| Mã | Paper |
|---|---|
| SAGA87 | Garcia-Molina & Salem, "Sagas", SIGMOD 1987 |
| CH97 | Karger et al., "Consistent Hashing and Random Trees", STOC 1997 |
| DYNAMO | DeCandia et al., "Dynamo: Amazon's Highly Available Key-value Store", SOSP 2007 |
| MEMCACHE | Nishtala et al., "Scaling Memcache at Facebook", NSDI 2013 |
| STAMPEDE | Vattani, Chierichetti, Lowenstein, "Optimal Probabilistic Cache Stampede Prevention", VLDB 2015 |
| DAPPER | Sigelman et al., "Dapper, a Large-Scale Distributed Systems Tracing Infrastructure", Google, 2010 |
| MONOREPO | Potvin & Levenberg, "Why Google Stores Billions of Lines of Code in a Single Repository", CACM 2016 |
| ZANZIBAR | Pang et al., "Zanzibar: Google's Consistent, Global Authorization System", USENIX ATC 2019 |
| CRDT | Shapiro, Preguiça, Baquero, Zawirski, "Conflict-free Replicated Data Types", SSS 2011 |
| OT89 | Ellis & Gibbs, "Concurrency control in groupware systems", SIGMOD 1989 |
| BM25 | Robertson & Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond", 2009 |
| HNSW | Malkov & Yashunin, "Efficient and robust approximate nearest neighbor search using HNSW graphs", 2016 (TPAMI 2018) |
| PQ | Jégou, Douze, Schmid, "Product Quantization for Nearest Neighbor Search", TPAMI 2011 |
| FAISS | Johnson, Douze, Jégou, "Billion-scale similarity search with GPUs", 2017 |
| ANNB | Aumüller, Bernhardsson, Faithfull, "ANN-Benchmarks: A Benchmarking Tool for Approximate Nearest Neighbor Algorithms", 2018/2020 |
| MRL | Kusupati et al., "Matryoshka Representation Learning", NeurIPS 2022 |
| RAG20 | Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", NeurIPS 2020 |
| RAGSURVEY | Gao et al., "Retrieval-Augmented Generation for Large Language Models: A Survey", 2023 (arXiv 2312.10997) |
| RRF | Cormack, Clarke, Buettcher, "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods", SIGIR 2009 |
| HYDE | Gao et al., "Precise Zero-Shot Dense Retrieval without Relevance Labels", 2022 |
| BERT-RERANK | Nogueira & Cho, "Passage Re-ranking with BERT", 2019 |
| RAGAS | Es et al., "RAGAS: Automated Evaluation of Retrieval Augmented Generation", 2023 |
| SELFRAG | Asai et al., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection", 2023 |
| GRAPHRAG | Edge et al., "From Local to Global: A Graph RAG Approach to Query-Focused Summarization", Microsoft, 2024 |
| REACT | Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models", 2022 |
| TOOLFORMER | Schick et al., "Toolformer: Language Models Can Teach Themselves to Use Tools", 2023 |
| INJECT23 | Greshake et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection", 2023 |
| MEMGPT | Packer et al., "MemGPT: Towards LLMs as Operating Systems", 2023 |
| GENAGENTS | Park et al., "Generative Agents: Interactive Simulacra of Human Behavior", 2023 |
| TAUBENCH | Yao et al. (Sierra), "τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains", 2024 |
| JUDGE | Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", NeurIPS 2023 |
| FRUGAL | Chen, Zaharia, Zou, "FrugalGPT: How to Use LLMs While Reducing Cost and Improving Performance", 2023 |
| ROUTELLM | Ong et al., "RouteLLM: Learning to Route LLMs with Preference Data", 2024 |
| GPTCACHE | Bang, "GPTCache: An Open-Source Semantic Cache for LLM Applications", 2023 |
| LINGUA | Jiang et al., "LLMLingua: Compressing Prompts for Accelerated Inference of LLMs", 2023 |
| PAGED | Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention", SOSP 2023 |
| ORCA | Yu et al., "Orca: A Distributed Serving System for Transformer-Based Generative Models", OSDI 2022 |
| SPEC | Leviathan, Kalman, Matias, "Fast Inference from Transformers via Speculative Decoding", ICML 2023 |
| GPTQ | Frantar et al., "GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers", 2022 |
| AWQ | Lin et al., "AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration", 2023 |
| KD15 | Hinton, Vinyals, Dean, "Distilling the Knowledge in a Neural Network", 2015 |
| DSBS | Hsieh et al., "Distilling Step-by-Step!", 2023 |
| DSPY | Khattab et al., "DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines", 2023 |
| FAILLOUD | Rabanser, Günnemann, Lipton, "Failing Loudly: An Empirical Study of Methods for Detecting Dataset Shift", NeurIPS 2019 |
| LITTLE | J. D. C. Little, "A Proof for the Queuing Formula: L = λW", Operations Research, 1961 |

## F. Case study và blog kỹ thuật công khai

| Mã | Bài |
|---|---|
| STRIPE-IDEMP | Stripe API Reference, "Idempotent requests" https://docs.stripe.com/api/idempotent_requests |
| BRANDUR-IDEMP | Brandur Leach, "Implementing Stripe-like Idempotency Keys in Postgres", 2017. https://brandur.org/idempotency-keys |
| STRIPE-RL | Paul Tarjan, "Scaling your API with rate limiters", Stripe, 2017. https://stripe.com/blog/rate-limiters |
| STRIPE-VER | Brandur Leach, "APIs as infrastructure: future-proofing Stripe with versioning", 2017. https://stripe.com/blog/api-versioning |
| STRIPE-MIG | Stripe, "Online migrations at scale", 2017. https://stripe.com/blog/online-migrations |
| STRIPE-WH | Stripe docs, "Webhooks" (best practices, signature). https://docs.stripe.com/webhooks |
| SLACK-PAGE | Slack Engineering, "Evolving API Pagination at Slack", 2017. https://slack.engineering/evolving-api-pagination-at-slack/ |
| SHOPIFY-MM | Kirsten Westeinde, "Deconstructing the Monolith: Designing Software that Maximizes Developer Productivity", Shopify Engineering, 2019 |
| FB-GQL | Lee Byron, "GraphQL: A data query language", Facebook Engineering, 2015 |
| FB-PAGING | Facebook Graph API docs, "Paging" (cursor-based) |
| CF-RL | Cloudflare, "How we built rate limiting capable of scaling to millions of domains", 2017 |
| YELP-INIT | Yelp Engineering, "dumb-init: An init for Docker", 2016. https://engineeringblog.yelp.com/2016/01/dumb-init-an-init-for-docker.html |
| AWS-IMG | AWS Solutions, "Serverless Image Handler" (implementation guide) |

## G. Tài liệu Anthropic (dùng cho các scope AI)

Mọi URL dưới `https://platform.claude.com/docs/en/`. ID model và giá lấy từ trang Models/Pricing tại
thời điểm viết (2026-10): `claude-opus-5-5` ($4 / $20 mỗi triệu token vào/ra), `claude-sonnet-5-5`
($2 / $10), `claude-haiku-4-5` ($1 / $5). Không tự thêm hậu tố ngày vào ID model.

| Mã | Tài liệu |
|---|---|
| ANT-AGENTS | Anthropic, "Building effective agents", 2024-12. https://www.anthropic.com/engineering/building-effective-agents — workflows (prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) vs agents |
| ANT-MULTI | Anthropic, "How we built our multi-agent research system", 2025-06. https://www.anthropic.com/engineering/built-multi-agent-research-system |
| ANT-CTX | Anthropic, "Effective context engineering for AI agents", 2025-09. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| ANT-TOOLS | Anthropic, "Writing effective tools for agents — with agents", 2025-09. https://www.anthropic.com/engineering/writing-tools-for-agents |
| ANT-CR | Anthropic, "Introducing Contextual Retrieval", 2024-09. https://www.anthropic.com/news/contextual-retrieval |
| DOC-MODELS | about-claude/models/overview · about-claude/pricing · about-claude/models/optimizing-for-cost-and-intelligence |
| DOC-TOOLS | agents-and-tools/tool-use/overview · tool-search-tool · memory-tool · programmatic-tool-calling |
| DOC-BUILD | build-with-claude/prompt-caching · batch-processing · citations · structured-outputs · streaming · effort · adaptive-thinking · compaction · context-editing · context-windows · token-counting · files · pdf-support |
| DOC-API | api/errors · api/rate-limits · api/admin (usage & cost) |
| DOC-MCP | managed-agents/mcp-connector (MCP connector) |
| DOC-PLATFORM | build-with-claude/claude-on-amazon-bedrock · claude-platform-on-aws (đa nền tảng / failover) |

## H. Bảo mật

| Mã | Tài liệu |
|---|---|
| OWASP-CS | OWASP Cheat Sheet Series https://cheatsheetseries.owasp.org/ — Password Storage, Authentication, Credential Stuffing Prevention, Session Management, CSRF Prevention, File Upload, Docker Security |
| OWASP-API | OWASP API Security Top 10 (2023) https://owasp.org/API-Security/ — API1 Broken Object Level Authorization |
| OWASP-LLM | OWASP Top 10 for LLM Applications (2025) https://genai.owasp.org/ — LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency |

## Cách ghi trích dẫn trong README bài toán

```markdown
- Fowler, *PoEAA* (2002), "Optimistic Offline Lock" — https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html — định nghĩa pattern và điều kiện áp dụng.
- PostgreSQL docs, "Explicit Locking" — cơ chế `SELECT ... FOR UPDATE` dùng cho phương án so sánh.
```

Mỗi nguồn kèm một dòng nói nó đóng góp gì. Không liệt kê nguồn "cho đẹp".
