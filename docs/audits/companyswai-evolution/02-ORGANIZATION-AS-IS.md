# 02 — Organization AS-IS

Baseline `3ecdab1`. Nhãn: **I** = IMPLEMENTED (cưỡng chế trong code), **D** = DOCUMENTED, **P** = chỉ là text tiêm vào prompt, **U** = UNKNOWN.

## 1. Sơ đồ tổ chức AS-IS — theo thiết kế

Nguồn: `agents/AGENTS.md`, `agents/*/IDENTITY.md` + `RULES.md`, `src/work-planner.ts`, `src/md-agent-loader.ts:26` (manifest 11 agent được cưỡng chế; `src/doctor-cli.ts:21`).

```
Human Owner (brief, approvals, scope, release — thủ công)
   └─ Claude Code Operator (CLAUDE.md: relay/dispatch, "không làm việc dự án")
        └─ Engine xác định (src/autonomous.ts: PLAN→ESTIMATE→APPROVAL→EXECUTE→FINALIZE→RETROSPECTIVE→DONE)
             ├─ product-lead → (researcher) → business-analyst → tech-lead → ux-ui-designer
             ├─ backend / frontend / mobile engineer, devops-sre   [stage 50, có thể song song]
             ├─ reviewer (1 persona, nhiều "lens")                 [không ai review reviewer]
             └─ qa-engineer                                       [không chạy được code]
```

| Vai | Kích hoạt | Input → output | Được review bởi | Skill thường trực | Capability model |
|---|---|---|---|---|---|
| product-lead | luôn, stage 10 | (research?) → product-plan | reviewer | requirements-analysis, research-evidence | reasoning, product |
| researcher | complexity ≥3, stage 15 | — → research (validator research-evidence) | **không ai** | research-evidence | reasoning |
| business-analyst | luôn, stage 20 | product-plan → requirements (validator requirements-ids) | reviewer | requirements-analysis | reasoning, product |
| tech-lead | luôn, stage 30 | requirements → architecture, technical-plan; architecture lens | reviewer | architecture-system-design, engineering-fundamentals, independent-review | reasoning, architecture |
| ux-ui-designer | capability web-ui/mobile, stage 40 | requirements, architecture → design-spec | reviewer | ux-ui-quality, requirements-analysis | reasoning, design |
| backend / frontend / mobile engineer | capability backend / web-ui / mobile, stage 50 | requirements, architecture (+ design-spec cho FE/mobile) → implementation; delivers code | reviewer | engineering-fundamentals + skill domain | reasoning, coding |
| devops-sre | capability deployment, stage 50 | architecture → deployment; delivers code | reviewer | platform-reliability, engineering-fundamentals | reasoning, deployment |
| reviewer | luôn, stage 60, mode reviewer | → review (PASS / CHANGES_REQUIRED) | **không ai** | independent-review, engineering-fundamentals | reasoning, review |
| qa-engineer | luôn, stage 70 | requirements, implementation → qa-report (validator qa-traceability) | **không ai** | qa-risk-testing, requirements-analysis | reasoning, testing |

Mức cưỡng chế:
- Activation: **I** (`src/md-agent-loader.ts:77-85`; `src/company.ts:13`).
- Dependency + mỗi artifact bắt buộc phải có producer đang active: **I** (`src/work-planner.ts:66,75`).
- "Done only when": **P** (nối vào prompt ở `src/md-agent-loader.ts:87-89`).
- Agent không có tool, text-in/text-out: **I** (`--tools ""` ở `src/providers/claude-code.ts:35`; `docs/SKILLS-AUDIT.md:14`).
- `reviewDepth` (`src/company.ts:22`) được tính nhưng không dùng — **dead code**.

Chồng lấn / khoảng trống:
- backend, frontend, mobile cùng produce `implementation`.
- Owner fallback của QA route FAIL tới mọi dependency có code (`src/orchestrator.ts:359`).
- 1 persona reviewer đảm nhiệm mọi slot review; chỉ khác "lens" (`src/work-planner.ts:95-104`).
- Output của QA và reviewer không bao giờ được review.
- Risk được gán **theo project, không theo task** (`projectRisk`, `src/work-planner.ts:41,84`) ⇒ prose của product-lead và code thanh toán chịu cùng mức review.

## 2. Sơ đồ tổ chức AS-IS — thực tế quan sát (341 run trong `.companyswai/`)

```
Human Owner
   └─ Operator Claude Code ở một phiên/dự án khác (soạn "pack" code + spec + gate; tự chạy mutation check)
        │   = Giám đốc dự án + PM + BA + Tech lead + Delivery manager + Learning (thực chất)
        └─ CompanySWAI engine = "dịch vụ thực thi 1 task"
             ├─ maker (run theo vai: FE 103 / BE 90 / devops 34 / TL 14 / BA 6 / PL 5 / UX 3 / researcher 1 / reviewer 1)
             ├─ reviewer (cùng model Sonnet với maker)
             ├─ deterministic gates (unit-tests / backend / typecheck / …)
             └─ qa-engineer chạy như một "maker task" riêng (114 run có hậu tố "-qa")
```

| Bằng chứng | Giá trị | Nhãn |
|---|---|---|
| Run có `briefHash == planHash` (plan đưa thẳng, không biên dịch từ brief; `src/autonomous.ts:49`) | **340/341** (ngoại lệ duy nhất: `example-commerce`, 2026-10-08) | OBSERVED |
| Run chỉ có 1 task | 329/341 | OBSERVED |
| Run nhiều task | 12 (ví dụ `hblxweb-org` 6 task, `hblxweb-wave1` 4 task, `example-commerce` 9 task) | OBSERVED |
| Lệnh gate trong plan trỏ tới scratchpad của một phiên Claude Code ở dự án khác | Có (ví dụ `runs/hblxweb-ab1a.plan.json`) | OBSERVED |
| Kích thước prompt mỗi task (system + prompt) | trung vị **88,5k ký tự**, p90 163k, tối đa 374k — phần lớn là "pack" do operator soạn | OBSERVED |
| Output QA trích "Operator mutation check" | Có (`executions/hblxweb-w112-qa`) | OBSERVED |
| Quality mode | 341/341 `BALANCED` | OBSERVED |

**Kết luận:** vai trò quản lý (phân rã, giao việc, soạn requirement/pack, chọn gate, retry, chuyển model) được thực hiện **bên ngoài** CompanySWAI. Ai (người hay AI operator) quyết định từng bước: UNKNOWN (không có dispatch ledger).

## 3. Coverage chức năng tổ chức

| Chức năng | Trạng thái | Owner / bằng chứng |
|---|---|---|
| Executive direction | **Thiếu** | Con người viết brief (`src/work-planner.ts:12-24`) |
| CTO / technical leadership | Một phần | tech-lead chỉ phụ trách kiến trúc |
| Operations management | Một phần | Engine: scheduler, budget, stop/resume (I) |
| Project / delivery management | Một phần (code) / **thực tế do operator** | DAG + critical-path priority (`src/plan-compiler.ts:23-34`; `src/orchestrator.ts:78-86`); không có vai PM |
| Resource allocation | Một phần | Routing trong code (`src/capacity.ts:66-91`); thực tế 1 profile `maxConcurrency: 1` (`config/providers.json`) |
| Prioritization / escalation | Một phần | Operator `priority` (`src/operator-commands.ts:127-150`); escalation = BLOCKED chờ người (`src/orchestrator.ts:438-444`) |
| Product management / PO | Có (P) | product-lead; thực tế 5 run |
| BA / system analysis | Có | business-analyst; REQ/AC id (I, `src/validators.ts:124`); thực tế 6 run |
| Requirement verification | Một phần | Reviewer của BA; QA traceability (I) |
| Acceptance-criteria ownership | Một phần | BA viết, QA kiểm; không có chấp nhận của con người |
| Scope management | **Thiếu** | Người sửa brief + `--replan` (`CLAUDE.md:53`; `src/autonomous.ts:61`) |
| Solution / software architecture | Có | tech-lead |
| Architecture review | Có | Lens + validator (I, `company/GATES.md:24`; `src/validators.ts:104-118`) |
| UI/UX | Có | ux-ui-designer (3 run thực tế) |
| Design system | **Thiếu** | — |
| Backend / Frontend / Mobile | Có | Engineers (không tool, không thấy repo) |
| Database | Một phần | Chỉ skill (database, migration-review) |
| Integration | Một phần | api-quality skill; worktree integration (I) |
| Infra / DevOps | Một phần | devops-sre viết deployment text/code; không có gì được deploy |
| Code review | Có | reviewer + code-review skill |
| QA | Có, yếu | Không chạy code; dựa vào output gate (`agents/qa-engineer/RULES.md:40-41`); verdict không có hiệu lực (xem 03) |
| Test automation | Một phần | Gate từ brief chạy xác định (`src/repo-workspace.ts:75-105`) |
| Security | Một phần | Lens security ở slot 2 khi HIGH_RISK (`src/work-planner.ts:96`); gate security chỉ khi được cấu hình |
| Performance | Một phần | Chỉ skill |
| Release management | **Thiếu** | — |
| Production operations | **Thiếu** | — |
| Maintenance | **Thiếu** | Takeover chỉ là audit |
| Knowledge management | Một phần | Project memory (I, `src/project-memory.ts`) |
| Skill management | Một phần | Registry/scan/validate (I, `src/skill-registry.ts`); con người tuyển chọn |
| Agent performance evaluation | **Thiếu** | Chỉ đếm revision theo vai trong retrospective (`src/retrospective.ts:61-73`) |
| Failure analysis | Một phần | Retrospective, BLOCKERS.md |
| Continuous improvement | Một phần | Learning loop, advisory prompt text (`src/company-experience.ts`) |
| Organizational evolution | **Thiếu** | 11 vai cố định (`src/md-agent-loader.ts:26`); thay đổi chỉ do người sửa |

## 4. Bản đồ thẩm quyền

| Quyết định | Ai | Nơi cưỡng chế |
|---|---|---|
| Chấp nhận requirement | **Không ai rõ ràng** — output BA + reviewer PASS là đủ | `src/orchestrator.ts:98-115` (I) |
| Duyệt design/architecture | reviewer với architecture lens; implementation bị chặn tới khi pass (qua dependency) | `src/work-planner.ts:96-103`; `src/validators.ts:113`; `src/orchestrator.ts:493` (I) |
| Giao task | Planner xác định theo activation + stage | `src/work-planner.ts:64-111` (I) — **thực tế: operator** |
| Chọn model/provider | Routing trong code theo capability, tier, cost, health | `src/capacity.ts:32-91`; `src/provider-selector.ts:69-91` (I) |
| Chọn skill | Resolver dựa trên quy tắc | `src/skill-selector.ts:66-103` (I) |
| Chọn tool | Không áp dụng — agent không có tool | `src/providers/claude-code.ts:35` |
| Từ chối việc | reviewer (CHANGES_REQUIRED), QA (FAIL), contract validators (2 vòng repair), gates | `src/runner.ts:38,81-91`; `src/orchestrator.ts:315,408` (I) |
| Kích hoạt rework | Engine: review → maker sửa (`src/orchestrator.ts:408-419`); QA FAIL → owner (`:346-372`); gate fail → tối đa 2 repair (`:315`) | I |
| Duyệt hoàn thành | Engine tự suy ra: maker done + mọi slot review PASS + gate OK + final status | `src/orchestrator.ts:98-115`; `src/final-status.ts:11-38` (I); **không có chữ ký người** |
| Giải quyết bất đồng | Không có trọng tài; maker sửa theo mọi finding, có thể bác một finding trong Decisions; hết vòng → BLOCKED | `src/orchestrator.ts:411-416` (I); prompt (P) |
| Đổi quy trình | Người sửa Markdown; CI chạy check + doctor (`.github/workflows/ci.yml:19-22`); learning chỉ thêm lesson advisory | `company/LEARNING.md:19` (D); `src/company-experience.ts:41,97` (I) |
| Hành động rủi ro cao | CLI cho người: `approve` (budget), `takeover approve`, `experience approve` | `src/approve-cli.ts`; `src/takeover.ts:81-89`; `src/company-experience.ts:105-109` (I) |

**Lỗ hổng trong luồng approval:**
- `approvedBy` là free-text, mặc định "owner" (`src/approve-cli.ts:8`; `src/approval-store.ts:27`); không xác thực người duyệt.
- Có thể ghi approval mà **không có request đang chờ**, chỉ cần có cost (`src/approval-store.ts:28-29`).
- Approval là file JSON thường trong `.companyswai/approvals`.
- Quy tắc "chỉ owner được duyệt" chỉ là P/D (`CLAUDE.md:16,44`); repo không có `.claude/` settings hay hooks.
- Với profile `claude-code` (subscription), budget tiền và ngưỡng approval **không bao giờ kích hoạt** (`src/orchestrator.ts:223`; `src/estimate.ts:24-38`).

## 5. Mô hình operator (CLAUDE.md)

Claude Code là relay hội thoại, dispatcher lệnh, cầu nối approval; **cấm** làm việc dự án hoặc sửa `.companyswai` (`CLAUDE.md:14-22,24-45`).
- Cưỡng chế: test kiểm tra sự hiện diện của câu chữ (`test/operator-contract.test.ts:10-26`); lệnh operator hẹp: stop, resume, priority (`src/operator-commands.ts:95-150`).
- Không có cơ chế kỹ thuật ngăn Claude sửa file hay chạy `approve` (P).
- **Mâu thuẫn quan sát được:** hồ sơ runtime cho thấy operator (ở phiên khác) soạn pack code + gate và chạy mutation check — tức là làm việc dự án.

Việc con người còn phải làm thủ công: viết brief (objective, capability, complexity, mode, signals, budget, workspace, gate, check); cấu hình provider; mọi approval (cost, takeover, lesson được bảo vệ); quyết định và sửa scope/cấu trúc rồi `--replan`; xử lý task BLOCKED/ReviewExhausted và FAILED_QA khi hết vòng rework; ghi executed evidence cho takeover (`docs/TAKEOVER.md:40-57`); release/deploy/vận hành; tuyển chọn skill và agent Markdown; đọc retrospective (`docs/RETROSPECTIVE.md:5-9`); diễn giải ACCEPTED_WITH_RISKS.

## 6. Tầng thừa / trùng lặp

- 11 `IDENTITY.md` có đoạn "Behaviour" giống hệt (cùng md5).
- `reviewDepth` chết (`src/company.ts:22`).
- 3 cách suy ra status: `src/status.ts`, `src/telemetry.ts` (`buildProjectStatus`), `src/operator.ts` (`classifyTasks`).
- `CompanyExperienceStore.lessonsFor` (`src/company-experience.ts:116-123`) trùng logic với `learningFor` (`src/plan-compiler.ts:12-20`); chỉ test dùng.
- Đường brief → planner → activation (thiết kế cốt lõi của "công ty") gần như không được dùng trong vận hành (340/341 run đi vòng).
