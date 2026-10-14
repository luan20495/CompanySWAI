# 05 — Organizational Memory & Learning

Baseline `3ecdab1`; hồ sơ `.companyswai/` (snapshot 2026-10-14).

## 1. Các cơ chế bộ nhớ — lưu trữ vs sử dụng

| Cơ chế | Hiện thực | Lưu trữ quan sát | Sử dụng thật | Nhãn |
|---|---|---|---|---|
| Project memory: `PLAN`, `REQUIREMENTS`, `ARCHITECTURE`, `DECISIONS`, `HANDOFFS`, `REVIEWS`, `BLOCKERS`, `QA`, `STATUS`, `RETROSPECTIVE` (`src/project-memory.ts:9`), ghi idempotent theo marker (`:60-70`) | IMPL + TEST | 3.440 file / 344 project | Agent **không đọc lại**; tóm tắt cho người | OBSERVED (lưu), không REUSED |
| Company experience (`src/company-experience.ts`; `.companyswai/company-experience.json`) | IMPL + TEST (`company-experience.test.ts` 8, `planning-learning.test.ts` 10) | 10 mục: 3 VALIDATED, 1 PENDING_APPROVAL, 1 REJECTED, 5 CANDIDATE | **0/341 plan chứa "LESSONS FROM PRIOR WORK"** | OBSERVED (lưu), không REUSED |
| Tiêm lesson vào prompt | `src/autonomous.ts:64-66` nạp lesson project + `validatedLessons()`; `learningFor` (`src/plan-compiler.ts:12-20`) nối vào system prompt **lúc compile** (`:44,48,49`) | — | Chỉ chạy trên đường *brief*; 340/341 run đưa plan thẳng → bị bỏ qua | IMPLEMENTED BUT NOT OBSERVED |
| Retrospective (`src/retrospective.ts:55-84`) | IMPL + TEST | 341 file | Chỉ ~7 câu khuôn mẫu từ `PATTERNS` (`:36-45`): failure, capacity, cost overrun, contract violation, revision theo vai/skill/domain (≥2 CHANGES_REQUIRED); **không LLM viết lesson, không root cause** | OBSERVED, không EFFECTIVE |
| Blocker registry | IMPL | 376 mục | **376/376 OPEN**; không severity; `clearBlocker` (`src/project-memory.ts:87`) không dùng | OBSERVED, không có lifecycle |
| Decision / handoff record | IMPL | 384 / 59 file (handoffs chỉ ở 12 project nhiều task) | Tái sử dụng chéo task: UNKNOWN | OBSERVED |
| `contextRefs` | IMPL | 295 attempt có ref: `artifact:` 332, `evidence:` 270, `upstream:` 70 | Không có ref nào tới lesson/experience/memory/retro | OBSERVED |

**Chi tiết quan trọng:**
- Lesson bị **đóng băng trong plan đã lưu** lúc compile ⇒ project resume không bao giờ nhận lesson mới.
- Learning chỉ chạy sau khi mọi task xong (`src/autonomous.ts:141`); run có task fail bị coi là "parked" ⇒ **project thất bại không bao giờ dạy công ty**.
- Lesson được tiêm không được trace trong execution record; không có so sánh trước/sau; confidence chỉ là số lần quan sát (`src/company-experience.ts:24-27`).
- Logic scope bị nhân đôi: `CompanyExperienceStore.lessonsFor` (`src/company-experience.ts:116-123`) chỉ test dùng.

**Ca kiểm chứng cụ thể:** `runs/hblxweb-mx2.plan.json` (start 2026-10-11T19:20Z, sau khi 3 lesson được VALIDATED lúc 15:55Z) có task `business-analyst` với skill `knowledge-matrix` và signals `takeover`, `read-only-audit`, `reconciliation` — khớp scope `SKILL:knowledge-matrix`, `DOMAIN:takeover`, `DOMAIN:reconciliation`. System prompt **không chứa** lesson. Nguyên nhân: run có `briefHash == planHash` (plan đưa thẳng; `src/autonomous.ts:62-68` chỉ gọi `compileBriefToProjectPlan(asBrief, learning)` khi input là brief).

## 2. Nội dung `company-experience.json` (đầy đủ)

| Pattern (rút gọn) | Scope | Quan sát | Confidence | Trạng thái |
|---|---|---|---|---|
| tech-lead cần sửa nhiều sau review → siết Done-only-when | ROLE:tech-lead | 1 (`hblxweb-org`) | 0,467 | CANDIDATE |
| knowledge-matrix cần sửa nhiều → làm rõ hướng dẫn skill | SKILL:knowledge-matrix | 2 (`org`, `wave1`) | 0,733 | **VALIDATED** (by validator) |
| domain takeover cần sửa nhiều → nêu ràng buộc domain trước | DOMAIN:takeover | 2 | 0,733 | **VALIDATED** |
| domain read-only-audit … | DOMAIN:read-only-audit | 2 | 0,733 | PENDING_APPROVAL ("protected topic") |
| domain reconciliation … | DOMAIN:reconciliation | 2 | 0,733 | **VALIDATED** |
| "Provider or task failures occurred; inspect failed execution records before reusing the same routing strategy." | GLOBAL | **42 project** | 1,0 | **REJECTED** — "describes operational/provider behaviour, which is temporary" (2026-10-13T22:04Z) |
| frontend-engineer cần sửa nhiều | ROLE:frontend-engineer | 1 (`fec5`) | 0,467 | CANDIDATE |
| verification-before-completion cần sửa nhiều | SKILL:verification-before-completion | 1 | 0,467 | CANDIDATE |
| domain implementation / frontend … | DOMAIN:implementation, DOMAIN:frontend | 1 | 0,467 | CANDIDATE |

Nhận xét: mọi lesson là câu khuôn mẫu chung chung, không chứa root cause cụ thể (ví dụ lỗi biên dịch, mode file, mutant sống sót). Bộ lọc an toàn (`src/company-experience.ts:36-54`: loại lesson operational/temporary/"weaken review", hoặc nhắc project id, URL, email, path, file, con số, secret, vai/skill không xác định) đã **REJECT đúng loại bài học cần thiết nhất** (họ lỗi lặp 42 lần). `company/LEARNING.md` + `company-experience.test.ts:80` cấm learning sửa rule/gate/policy.

## 3. Taxonomy họ lỗi (phụ lục bắt buộc #2)

Phân loại 141 attempt FAILED theo chữ ký evidence/error (phân loại heuristic bằng regex — xem script ở 11; các nhóm "gradle-build-failed-other" và "other" chứa cả compile/test/static-guard):

| Họ lỗi | Số attempt | Lần đầu | Lần cuối | Theo ngày (10-11 / 10-12 / 10-13 / 10-14) |
|---|---|---|---|---|
| Gradle build failed (khác) | 45 | 10-11 16:31Z `hblxweb-w112` | 10-13 21:40Z `hblxweb-d3a` | 3 / 14 / 28 / 0 |
| Test assertion failure | 37 | 10-12 02:20Z `iss019a1a` | 10-14 00:22Z `fee1a` | 0 / 18 / 18 / 1 |
| Khác (assertion Node, static guard fail …) | 32 | 10-12 05:59Z `corerb` | 10-14 00:16Z `fee1a` | 0 / 12 / 19 / 1 |
| TypeScript type error | 15 | 10-12 07:45Z `cored2b` | 10-14 00:09Z `fee1a` | 0 / 7 / 7 / 1 |
| Kotlin compile error | 7 | 10-12 08:39Z `core13a1` | 10-13 20:24Z `d1c` | 0 / 1 / 6 / 0 |
| Provider timeout 600s | 3 | 10-13 15:52Z `fec7b` | 10-13 16:12Z `fec7b` | 0 / 0 / 3 / 0 |
| Integration conflict | 2 | 10-12 12:14Z `p108b` | 10-13 09:47Z `fec1` | 0 / 1 / 1 / 0 |

Theo nguồn error: gate `unit-tests` 102, gate `backend` 31, gate `typecheck` 3, timeout 3, "Refusing to integrate" 1, conflicting patches 1.

## 4. Truy vết họ lỗi lặp & hiệu quả phòng ngừa

| Họ | Lần 1 | Lần 2 / 3+ | Root cause chung | Rule phòng ngừa đã có | Vì sao thất bại | Leo thang cấp công ty? | Ngăn tái phát? |
|---|---|---|---|---|---|---|---|
| **F1. Code maker fail gate** (Gradle/Kotlin/TS/test/guard) | 10-11 `w112` | 10-12 (53 attempt), 10-13 (82 attempt) | Maker không có shell, không thấy repo → nộp code chưa từng biên dịch | Skill `verification-before-completion` (tiêm 359 lần) | Không thể thực hiện (không shell) | Lesson GLOBAL 42 quan sát bị **REJECTED** | **Không** — tăng theo ngày |
| **F2. Reviewer bỏ sót lỗi tuân thủ spec** | 10-11 `w112` | 10-12 `iss011`, `cored2a`, `core13a1`, `p105a`, `rest3e2`; 10-13 `ux2u2b` | Reviewer cùng model; không có checklist rút từ các QA FAIL trước | Không | — | Không | Không |
| **F3. QA FAIL/BLOCKED nhưng ACCEPTED** | 10-11 `iss001` (BLOCKED) | 20 lần | `final-status` không đọc QA verdict khi QA là task riêng | Không | — | Không | Không |
| **F4. Agent nhận artifact bị cắt** (lịch sử) | `a271aa3` | `bfe6395`, `135e39e` | Giới hạn ký tự upstream | Fix cục bộ 3 lần | Giới hạn 30k vẫn còn (`src/orchestrator.ts:76`) | Không (fix, không phải rule) | UNKNOWN |
| **F5. Lỗi tooling era 1** ("escaped newline") | `48edf07` | `00175b6`, `78ba401`, `0244fed`, `dddc554` | Commit qua API mà không biên dịch | Chuyển sang Claude Code local + lockfile + CI | — | **Có** (thay đổi quy trình, ngầm, do người) | **Có** — 0 lần ở era 2. Ví dụ cải tiến hiệu quả duy nhất |
| **F6. Timeout provider (Opus)** | `fec7b` ×3 | — | Opus + timeout cố định 600s | Failover | Chỉ có 1 profile | Không | UNKNOWN |
| **F7. Quy tắc vòng đời nhánh Git** | (sự cố vận hành của owner, không có record trong repo) | — | — | `a7e53f4` biến thành `docs/GIT-BRANCH-LIFECYCLE.md` + tool cleanup | — | Có, do người khởi xướng | Chưa merge — UNKNOWN |

Phân biệt: F1 là *khác triệu chứng, cùng root cause* (compile error, type error, test fail, guard fail ⇐ maker mù). F4 là *cùng root cause, sửa 3 lần* ở 3 triệu chứng khác (reviewer, downstream, QA). F2 và F3 là lỗi *mới về bản chất tổ chức* (thiết kế verdict).

## 5. Chính sách leo thang 1-2-3

| Bước | Yêu cầu | Hiện trạng |
|---|---|---|
| Lần 1 | Fix + regression test | Có cho lỗi của *chính CompanySWAI* (era 2: mỗi fix kèm test). Với lỗi của *output agent*: chỉ có gate repair trong run |
| Lần 2 (cùng root cause) | Rule/checklist/skill toàn công ty | **NOT IMPLEMENTED** — không có chữ ký lỗi, không phát hiện lặp; lesson chỉ là prompt advisory và không được tiêm |
| Lần 3 | Postmortem + sửa orchestration | **NOT IMPLEMENTED** (`grep recurr/postmortem/occurrence` trong src = 0) |

Không có lesson nào có tính cưỡng chế (đều là "advisory prompt text"). Tỷ lệ lỗi lặp **không giảm** (attempt maker fail: 5% → 35% → 44% theo ngày; không kiểm soát độ khó).

## 6. Learning có truyền giữa agent không?

Không quan sát được: 0 lesson tiêm; project memory không được agent đọc; `contextRefs` chỉ trỏ artifact upstream của *cùng run*. Tri thức thực sự được truyền là qua **pack do operator soạn** (bên ngoài CompanySWAI) — UNKNOWN nội dung.

## 7. Instrumentation còn thiếu

- Chữ ký lỗi chuẩn hóa (gate, ngôn ngữ, mã lỗi, vai, skill) + bộ đếm lặp.
- Trace lesson được tiêm (`contextRefs: lesson:<id>`) và đo outcome trước/sau.
- Lifecycle blocker (OPEN → OWNER → RESOLVED/WAIVED).
- Dispatch ledger cho mọi lần operator/người re-dispatch, đổi model, đổi plan.
- `companyVersion` (hash của `company/`, `agents/`, `skills/`) trên mỗi run để gán thay đổi hành vi cho thay đổi tổ chức.
