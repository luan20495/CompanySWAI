# 04 — Skills, Tools & Model Intelligence

Baseline `3ecdab1`; hồ sơ `.companyswai/executions/*/records.jsonl` (798 attempt, 775 có `skillTrace`).

## 1. Cơ chế skill

| Thành phần | Mô tả | Nhãn |
|---|---|---|
| 11 permanent skill | `skills/*.md`, ~3 dòng mỗi file, không metadata; gắn qua `skills:` trong IDENTITY (`src/md-agent-loader.ts:66`); luôn được tiêm | IMPL (P) |
| 25 dynamic skill | `skills/dynamic/*.md`, metadata zod: name, version, appliesTo, capabilities, keywords, tags, minComplexity, source + commit, license, riskLevel, requires*, overlapGroup, reviewMethod, outputContract (`src/skill-registry.ts:34-74`) | IMPL |
| — 18 native | accessibility, android, backend-reliability, database, devops, distributed-systems (minComplexity 5), flutter, frontend-performance, ios, mobile-native, observability, performance, security, testing, ux-research, knowledge-matrix, verification-before-completion, fuzz-property-testing | IMPL |
| — 7 adapted + pinned | web-research (requiresNetwork), api-quality, code-review (chỉ reviewer), migration-review, security-review (cần gitleaks, semgrep, trufflehog, trivy, grype), e2e-browser-testing (cần playwright-cli), skill-development | IMPL |
| Reference | `skills/references/e2e-browser-testing/{playwright-cli,triage}.md`, `skills/references/security-review/scanners.md` | DOC |
| Chọn skill | Xác định: `appliesTo` theo vai → khớp capability/tag/keyword nguyên từ trên objective + signals của brief, cộng facts của task (`delivers-code`, `risk-*`, `reviews-code`, `security-review`, `external-evidence`) → policy mạng/browser → overlapGroup → tối đa 4 (reviewer 5) → ngân sách 7.000 ký tự (reviewer 9.000) (`src/skill-selector.ts:66-103`; `src/work-planner.ts:44-58,77,90-91`) | IMPL |
| Ghi vết | `skillTrace` (used/skipped/lý do/matched/contextChars) trên mỗi execution record (`src/runner.ts:52`; `src/skill-registry.ts:85-91`) | IMPL + **OBS** |
| An toàn tải skill | Fail-closed: allow-list license, commit pin, giới hạn kích thước, quét lệnh nguy hiểm/injection (`src/skill-registry.ts:12-19,98-112`) | IMPL |
| Ghi nhận kết quả | Retrospective gán revision cho skill → lesson candidate scope SKILL (`src/retrospective.ts:41,75`) — chỉ thêm prompt advisory, **không đổi selection** | IMPL (yếu) |
| Tool bên ngoài | `src/tool-probe.ts:13-23` chỉ dò PATH cho `requiresExternalBinary`; không bao giờ chạy hay cài; chỉ skills view dùng (`src/skills-view.ts:17`). Agent **không chạy được tool nào** (`--tools ""`); tool chỉ chạy dưới dạng gate do brief cấu hình (`docs/SKILLS-AUDIT.md:14,207`) | IMPL |

**Mức trưởng thành của việc chọn skill:** *rule-based*, có chút context-aware (signal project, risk task). Không model-based, không thích ứng theo kết quả. Brief ngắn dễ kích hoạt thiếu skill (`docs/SKILLS-AUDIT.md:210`).

## 2. Ma trận: cài đặt → khả dụng → được "dùng" → reuse → giá trị (phụ lục bắt buộc #1)

"Được dùng" ở đây = được runtime **tiêm vào prompt** (ghi trong `skillTrace.used`). 100% lần "dùng" là tự động theo policy (khớp tag/keyword); 0 lần được con người yêu cầu riêng trong hồ sơ. Không có liên kết skill → decision record, nên "ảnh hưởng quyết định" là UNKNOWN trừ khi nêu khác.

| Skill / tool | Cài đặt | Khả dụng | Được tiêm (lần) | Vai sử dụng (reuse chéo) | Cách khớp | Thực thi thành công | Ảnh hưởng / giá trị |
|---|---|---|---|---|---|---|---|
| verification-before-completion | có | có | **359** | backend, frontend, devops, tech-lead | `tag:delivers-code` + `tag:risk-high` (337), chỉ `delivers-code` (22) | **Không áp dụng — maker không có shell** (349/354 output maker tự khai không chạy được gì) | Không thể làm theo; retro còn gắn nó với revision (`company-experience.json`, CANDIDATE) |
| security | có | có | 164 | backend, qa, reviewer, tech-lead | `tag:security` (141), `keyword:authorization` (13), cả hai (9), `keyword:secret` (1) | — | UNKNOWN |
| android | có | có | **111** | qa-engineer, reviewer | **chỉ `keyword:kotlin`** | — | **Dấu hiệu chọn sai**: backend dự án là Kotlin/Gradle server (theo evidence gate), không phải Android → lãng phí context |
| api-quality | có | có | 41 | backend, reviewer, tech-lead | | — | UNKNOWN |
| database | có | có | 33 | backend, qa, tech-lead | | — | UNKNOWN |
| knowledge-matrix | có | có | 28 | BA, product-lead, tech-lead | | — | Retro gắn với 7 CHANGES_REQUIRED; lesson SKILL scope **VALIDATED nhưng không được tiêm** (xem 05) |
| testing | có | có | 15 | backend, frontend | | — | UNKNOWN |
| frontend-performance | có | có | 12 | frontend | | — | UNKNOWN |
| devops | có | có | 12 | devops-sre | | — | UNKNOWN |
| migration-review | có | có | 10 | backend | | — | UNKNOWN |
| accessibility | có | có | 9 | frontend | | — | UNKNOWN |
| e2e-browser-testing | có | prompt có; binary `playwright-cli` không được agent chạy | 6 | frontend | | **0** | Không có |
| ux-research | có | có | 5 | BA, PL, UX | | — | UNKNOWN |
| performance | có | có | 5 | frontend | | — | UNKNOWN |
| fuzz-property-testing | có | có | 2 | frontend | | **0** (agent không chạy test) | Không có |
| security-review (gitleaks, semgrep, trufflehog, trivy, grype) | có | chỉ dò PATH | 0 | — | — | 0 lần chạy scanner | Không có |
| web-research | có | cần mạng | 0 trong hồ sơ | — | — | — | UNKNOWN |
| code-review, skill-development, backend-reliability, distributed-systems, observability, flutter, ios, mobile-native | có | có | 0 trong `skillTrace` | — | — | — | UNKNOWN |
| Graphify, Chrome DevTools MCP, Beads, Trail of Bits, wshobson plugins | **không được tham chiếu trong repo** | — | — | — | — | — | NOT IMPLEMENTED ở tầng CompanySWAI |
| Serena, Context7, Playwright MCP | **REJECTED** có chủ đích (`docs/SKILLS-AUDIT.md:102`) | — | — | — | — | — | NOT IMPLEMENTED |
| `playwright-cli` (Claude Code skill) | chỉ ở cấp operator (`docs/SKILLS-AUDIT.md:13`) | — | — | — | — | UNKNOWN | UNKNOWN |

`skillTrace.skipped` = 0 và `warnings` = 0 trên toàn bộ hồ sơ; 23 attempt không có `skillTrace` (attempt "deterministic" hoặc trước khi có skill layer).

**Tổng hợp theo tầng:** cài đặt 25 dynamic + 11 permanent → khả dụng 25 → được tiêm 15 skill khác nhau → thực thi tool thành công 0 (không áp dụng) → reuse chéo vai: có (nhưng chỉ là tiêm prompt) → hiệu quả đã chứng minh: **0**. Không skill nào được đo kết quả.

**Trả lời:** CompanySWAI *chọn* skill một cách xác định và có lưu vết, nhưng **không biết dùng**: agent không có tool để thực thi; kết quả skill không được đo; không có vòng phản hồi cập nhật routing.

## 3. Trí tuệ agent

- Agent là completion text-in/text-out; không tool, không shell, không đọc repo (`src/providers/claude-code.ts:35`; `src/context.ts:45-54`).
- **349/354 output maker (backend/frontend/devops, có nội dung) tự khai không chạy/biên dịch được gì** (regex trên output; ví dụ `executions/hblxweb-ab1a`: *"Nothing was run (NOT RUN): I have no shell, so compile, … are all unverified."*).
- Hành vi: prompt-driven + orchestrator-controlled; không adaptive; không reassignment vai.
- Tỷ lệ first-pass theo vai: xem `06-PERFORMANCE-AND-QUALITY.md` §3. Vai không viết code đạt 100% vì **không có gate khách quan**.

## 4. Model routing & escalation (phụ lục bắt buộc #3)

| Mục | Hiện trạng | Nhãn |
|---|---|---|
| Profile cấu hình | 1 profile `claude-code-team`: provider `claude-code`, model `sonnet`, `qualityTier: 4`, `maxConcurrency: 1`, `contextWindow: 200000` (`config/providers.json` — gitignored, đọc local) | IMPL |
| Profile ví dụ | API, OpenRouter, local Sonnet (`config/providers.example.json`); không có Opus | DOC |
| "opus" trong src/config/company/agents | Không xuất hiện | — |
| Chiến lược routing | COST_FIRST / QUALITY_FIRST / BALANCED / LOCAL_FIRST (`src/capacity.ts:66-91`); BALANCED: quality 0,35, health 0,25, cost 0,25, latency 0,15; health = success rate trượt (`src/provider-selector.ts:51-56`); mode áp đồng nhất cho mọi task + reviewer (`src/plan-compiler.ts:39,45,50`) | IMPL + TEST (`routing.test.ts` 11, `provider-system.test.ts` 9) |
| Escalation theo risk/complexity | **Không có** — risk chỉ đổi số reviewer/số vòng | NOT IMPLEMENTED |
| Fallback | Failover giữa các profile đủ điều kiện (≤8 attempt; `src/orchestrator.ts:76,285-293`); cooldown (`:253-262`); thiếu tier → dùng best available + `QUALITY_SHORTFALL` (`src/provider-selector.ts:74`; `src/orchestrator.ts:280`) | IMPL; với 1 profile, failover không thể xảy ra |
| Bug | Risk quality-shortfall trong `src/final-status.ts:35-36` tìm "quality tier" trong `record.evidence`, nhưng shortfall chỉ ghi vào telemetry/STATUS.md → **không bao giờ kích hoạt** | IMPL (lỗi) |
| Reviewer độc lập | Khác vai (I, `src/orchestrator.ts:138`; `src/doctor-cli.ts:34`); context mới mỗi slot, không thấy suy luận của maker hay finding của reviewer khác (I, `src/context.ts:62-86`; 1 process/lượt gọi `src/providers/claude-code.ts:59-62`); **cùng model + provider + profile với maker** | IMPL |
| Model thực tế (execution record) | maker: `claude-sonnet-5-5` 515, `deterministic` 9, **`claude-opus-5-5` 3**, `sonnet` 1; review: `claude-sonnet-5-5` 256, `deterministic` 14 | OBSERVED |

**Escalation thực tế quan sát được — chỉ 1 chuỗi, thủ công:**

| Run | Model | Kết quả | Thời điểm (UTC) |
|---|---|---|---|
| `hblxweb-fec7` | Sonnet | 3 attempt, cả 3 fail gate `backend` → FAILED | 2026-10-13 15:25–15:51 |
| `hblxweb-fec7b` | **Opus** (re-dispatch; profile `claude-code-team` tạm đổi model — config hiện tại lại là `sonnet`) | 3 attempt, **cả 3 timeout 600s** → failover/cooldown/retry → FAILED | 15:52–16:22 |
| `hblxweb-fec7c` | Sonnet | FAILED | 16:25 |
| `hblxweb-fec7d` | Sonnet | **ACCEPTED** | 16:54 |

- Escalation do operator/người thực hiện (đổi profile + dispatch run mới), **không** do policy.
- Escalated work không thành công; chi phí tăng thêm: token UNKNOWN (attempt timeout không ghi token), thời gian ≈30 phút.
- Không có thay đổi quy trình nào sau sự cố (không commit, không lesson).

**Maker thất bại sau nhiều attempt:** 24 task fail sau 3 attempt (2 vòng repair); 16/32 run FAILED được dispatch lại thủ công bằng run mới cùng tiền tố (chuỗi dài nhất 4 run: `fec7` → `fec7d`; các chuỗi khác: `iss006` → `iss006r2` → `iss006r3`, `d1` → `d1b` → `d1c`, `env2` → `env2b` → `env2c` (không có maker run ACCEPTED sau đó nhưng `env2-qa` ACCEPTED lúc 01:11 UTC — UNKNOWN công việc có được hoàn tất ngoài CompanySWAI hay không)).

**Reviewer bỏ sót:** 7/7 run QA FAIL có run maker tương ứng đã nhận reviewer PASS + gate PASS (xem 06 §4).
