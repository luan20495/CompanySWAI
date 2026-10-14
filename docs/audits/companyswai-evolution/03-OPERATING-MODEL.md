# 03 — Operating Model (workflow, giao việc, phối hợp, review, QA, delivery)

Baseline `3ecdab1`. Nhãn: IMPL = IMPLEMENTED, TEST = có test, DOC = chỉ docs, OBS = OBSERVED trong `.companyswai/`.

## 1. Workflow end-to-end

Phase của engine (IMPL + TEST): `PLAN → ESTIMATE → APPROVAL → EXECUTE → FINALIZE → RETROSPECTIVE → DONE` (`src/run-store.ts:10`; `src/autonomous.ts:59-144`). Research, requirements, architecture, coding, review, QA **không phải phase** — chúng là task trong DAG ở phase EXECUTE. `company/WORKFLOW.md:3-12` liệt kê 10 bước theo vai (DOC); thứ tự vai chỉ được hiện thực qua dependency artifact.

| Giai đoạn | Owner | DoR / Gate | Mức bằng chứng |
|---|---|---|---|
| Idea / Discovery | Con người | — | NOT IMPLEMENTED |
| Requirements | BA (prompt) + validator REQ/AC (`src/validators.ts:124`) | Validator | IMPL; OBS ít (6 run BA). Thực tế requirement chủ yếu nằm trong pack của operator |
| Analysis / UX / Architecture | tech-lead, ux-ui | Architecture lens + validator | IMPL; OBS 14 + 3 run |
| Planning | Planner xác định | DAG | IMPL nhưng **bị đi vòng** (340/341) |
| Engineering | Engineers | Gate fail-closed (`src/runner.ts:126-135`), 2 vòng repair | **OBS + EFFECTIVE một phần**: 42/66 task fail gate lần đầu được cứu |
| Review | reviewer | PASS/CHANGES_REQUIRED; số vòng theo policy | OBS: 270 verdict |
| QA | qa-engineer | Traceability (`src/validators.ts:79-102`) | OBS: 117 task; vòng QA FAIL → rework **chưa chạy live** (`docs/BENCHMARK-RESULTS.md`) |
| Integration | Worktree cherry-pick + chạy lại gate; revert nếu fail | Gate trên merged tree | OBS: 2 conflict; **race ngoài lock** (`src/worktrees.ts:96-99`) |
| UAT | — | — | NOT IMPLEMENTED |
| Release / Ops / Maintenance | — | — | NOT IMPLEMENTED |
| Improvement | Retrospective theo khuôn mẫu | — | OBS nhưng không có hiệu lực (xem 05) |

**Definition of Ready (IMPL):** "không bắt đầu được" = thiếu artifact bắt buộc, cưỡng chế bởi DAG (`src/work-planner.ts:66,75`; `src/orchestrator.ts:493`).

**Definition of Done:** danh sách "Done only when" theo vai chỉ là P. Code thực sự cưỡng chế: output contract 5 section + repair (`src/runner.ts:59-91`); validators (`src/validators.ts:124`); review; gate bắt buộc fail-closed nếu chưa cấu hình (`src/runner.ts:131-132`); `complete` (`src/orchestrator.ts:110`).

**Quality modes (IMPL):** FAST / BALANCED / MAX_QUALITY (`company/POLICY.md:12-28`; parse ở `src/company.ts:38-45`; áp dụng ở `src/plan-compiler.ts:38-39`, `src/work-planner.ts:71,81`).

**Review levels (IMPL):** NORMAL 1 reviewer / 2 vòng; CRITICAL 2 / 3; HIGH_RISK 2 / 4 + check, gate qa và security (`company/POLICY.md:2-6`; `src/policy.ts:6-13`). Gate "checks" của HIGH_RISK yếu: pass nếu maker record có *bất kỳ* dòng evidence hoặc *bất kỳ* gate PASS (`src/orchestrator.ts:108-109`).

**QA depth (IMPL):** light/standard/deep → `minTestsPerRequirement` (`src/work-planner.ts:81-82`). QA rework giới hạn bởi `qaReworkRounds` (`src/orchestrator.ts:349-357`).

## 2. Phân biệt trạng thái hoàn thành

| Cấp | Có trong code? | Ở đâu |
|---|---|---|
| CODE COMPLETE | Có | Execution record `SUCCEEDED` + gate PASS (`src/execution-record.ts:7,15`) |
| TASK ACCEPTED | Có | `taskHistory.complete` → operator `DONE` (`src/orchestrator.ts:110`; `src/operator.ts:28`) |
| FEATURE COMPLETE | **Không** | Chỉ có traceability theo requirement |
| PRODUCT RELEASE READY | **Không** | Không có trạng thái release/deploy; output devops không bao giờ được thực thi |

Final status cấp project (`src/run-store.ts:14`; `src/final-status.ts:16-38`): ACCEPTED, ACCEPTED_WITH_RISKS, FAILED_QA, BLOCKED, FAILED, PARKED, INCOMPLETE. ACCEPTED là cấp project, **không có chữ ký người, không kiểm deploy**. Thiếu bằng chứng gate cho code chỉ bị hạ xuống ACCEPTED_WITH_RISKS (`src/final-status.ts:31-33`). `src/closeout.ts:7-13` chỉ ghi retrospective + chạy learning loop.

Các enum khác: execution record STARTED/CHECKPOINTED/SUCCEEDED/FAILED/PAUSED_CAPACITY (`src/execution-record.ts:7`); checkpoint READY/DOING/REVIEW/BLOCKED/PAUSED_CAPACITY/DONE (`src/checkpoint-store.ts:7`; READY và DOING không bao giờ được ghi); operator TaskState DONE/RUNNING/BLOCKED/PAUSED/AWAITING_APPROVAL/WAITING/READY/INTERRUPTED (`src/operator.ts:28`); takeover DONE/PARTIAL/NOT_DONE/BLOCKED/UNKNOWN (`docs/TAKEOVER.md:32-35`).

## 3. Orchestration (IMPL + TEST, xác định hoàn toàn)

| Cơ chế | Hiện thực | Test | Điểm yếu |
|---|---|---|---|
| Phân rã | Planner tạo **1 task / maker agent active**, id = agent id (`src/work-planner.ts:107-108`); prompt = objective + "Assigned responsibility: <dòng đầu identity>". Không có phân rã cấp feature/sub-task; takeover dùng 4 task cố định (`src/takeover-plan.ts:80`) | `scheduler.test.ts` | Thô: một lượt LLM cho cả phần việc của vai |
| Token | Ước lượng cố định 3000/3000, `maxTokens` 4096 (6000 critical) (`src/plan-compiler.ts:46`); provider claude-code bỏ qua `maxTokens` (`src/providers/claude-code.ts:34-42`) | — | |
| Gán vai | Task role = agent id; reviewer = `reviewedBy`, khác vai (`src/work-planner.ts:83`; `src/orchestrator.ts:138`) | có | **Không có reassignment** sang vai khác; chỉ failover provider (`src/orchestrator.ts:291`) |
| Scheduling | DAG event-driven, không polling (`src/orchestrator.ts:494-509`); ưu tiên critical-path + aging (`:79-86`); validate plan trước khi gọi (trùng id, thiếu dependency, cycle, reviewer independence; `:133-147`) | `scheduler.test.ts` (12), `orchestration.test.ts` | |
| Concurrency | ≤4 task/project mặc định (`src/orchestrator.ts:76,463`); `maxConcurrency` theo profile qua `KeyedSemaphore` (`src/semaphore.ts`) | có | `slots.wait()` không timeout (`src/orchestrator.ts:252`) |
| Worktree | Mỗi task code có detached worktree; gate pass → cherry-pick dưới lock; conflict → abort + gọi model lại 1 lần (`src/worktrees.ts:59-73`; `src/orchestrator.ts:308-313`); gate lại trên merged tree, revert nếu fail (`src/worktrees.ts:85-104`); dọn worktree >15 phút khi bắt đầu run (`src/orchestrator.ts:452`) | `gates-worktrees.test.ts` (13) | **Race:** gate merged-tree + revert chạy ngoài lock; key lock khác nhau (`src/repo-workspace.ts:113` vs `src/worktrees.ts:60`); chưa test |
| Handoff | Kiểm `##` section bắt buộc (`src/output-parser.ts:27-32`); validators research-evidence, requirements-ids, qa-traceability, architecture-review, code-delivery (`src/validators.ts:124-126`); tối đa 2 vòng repair (`src/runner.ts:38,78-83`); handoff record cho từng task downstream (`src/runner.ts:180-185`); downstream chỉ nhận section upstream (`src/context.ts:45-54`) | `validators.test.ts` (17) | Docs nói "1 vòng" |
| Shared state | JSONL append-only là nguồn sự thật (`src/execution-store.ts`); vị trí task luôn tính lại từ log (`src/orchestrator.ts:94-118`); JSON ghi atomic write-then-rename (`src/fs-atomic.ts`), không fsync | có | `append()` đọc lại toàn bộ log mỗi lần ghi → O(n²) (`src/execution-store.ts:18`) |
| Retry/timeout | Provider: ≤8 attempt + failover (`src/orchestrator.ts:76,291-293`); cooldown ≤120s rồi PAUSED_CAPACITY (`:254-260`); gate repair ≤2 (`:315-321`); conflict retry 1; claude-code CLI 600s rồi SIGTERM/SIGKILL (`src/providers/claude-code.ts:16,93`); mỗi check 300s (`src/repo-workspace.ts:16`) | có | Không có giới hạn wall-clock cho task/run |
| Crash recovery | 2 bước: generate → CHECKPOINTED, finalize → SUCCEEDED; response đã trả tiền được finalize khi resume mà không gọi lại (`src/runner.ts:42-58`; `src/orchestrator.ts:162-165,240-241`); torn line bị cách ly (`src/execution-store.ts:27-40`); checkpoint hỏng bị đổi tên (`src/checkpoint-store.ts:31-32`) | `resilience.test.ts`, `failure-injection.test.ts`, `autonomous.test.ts` | Run state/plan/rework JSON hỏng → `load` throw, không cách ly (`src/run-store.ts:37-38`; `src/rework-store.ts:28-29`) |
| Blocker | Section `## Blockers` lưu OPEN (`src/runner.ts:166-170`); task vẫn SUCCEEDED và chảy downstream | — | Không bao giờ resolve (`clearBlocker` ở `src/project-memory.ts:87` và status RESOLVED ở `src/artifact-store.ts:12` không dùng); status view gợi ý "unblock" nhưng không có lệnh (`src/operator.ts:196`; `src/operator-commands.ts:35-53`) |
| Review loop | Slot reviewer độc lập chạy song song, context mới (`src/orchestrator.ts:422-435`); round limit từ POLICY; hết vòng → `ReviewExhaustedError` (`:409-421`) | `orchestration.test.ts`, `review-policy.test.ts` | **Review exhaustion vĩnh viễn**: resume tính lại cùng số vòng và throw lại; không override; `--replan` giữ log |
| QA loop | QA FAIL → route từng finding tới owner (bắt buộc `| owner:`), rồi QA kiểm lại; giới hạn `qaReworkRounds` (`src/orchestrator.ts:349-374,511-518`; `src/rework-store.ts`) | `qa-rework.test.ts` (7) | **Chưa chạy live**; QA không chạy gì, `evidence:` là free text chỉ kiểm định dạng (`src/validators.ts:90`) |
| Completion | Maker succeeded + không còn rework + mọi slot PASS + (nếu policy yêu cầu) gate PASS (`src/orchestrator.ts:108-114`) | có | |
| Chống trùng việc | Trong 1 process: state từ log; benchmark kiểm trùng (`src/benchmark.ts:119`) | có | **Không có lock giữa process**: chỉ `engineGuard` dò pid từ telemetry (`src/operator-commands.ts:96,112`; `src/telemetry.ts:43-47`); `npm run company` (`src/company-cli.ts`) và takeover bỏ qua guard |
| Stale/deadlock | INTERRUPTED suy ra từ pid chết (`src/operator.ts:131`); deadlock bất khả về cấu trúc (kiểm cycle) | — | |
| Stop | Stop hợp tác gắn `runId`, kiểm giữa các bước (`src/stop-store.ts`; `src/orchestrator.ts:380-388,394,497`) | `operator.test.ts` | |

**Ai quyết định?** Orchestration là **code xác định 100%**; không có LLM manager. LLM chỉ sinh artifact và verdict (dòng đầu PASS/CHANGES_REQUIRED; QA PASS/FAIL/BLOCKED) — verdict điều khiển chuyển vòng.

**Agent là completion text-only:** code được giao dưới dạng block file nguyên vẹn (fence ```` ```file <path> ````), parse bởi `parseFilePatches` (`src/repo-workspace.ts:26-30`); không hỗ trợ xóa file. Maker **không bao giờ thấy file repo** — context chỉ là artifact upstream (`src/context.ts:45-54`); ngoại lệ: takeover dựng snapshot read-only (`src/takeover-plan.ts:41-49`).

## 4. Lỗ hổng chuyển tiếp nghiêm trọng

1. **Integrate trước review:** patch được apply, gate, commit/cherry-pick vào workspace chính khi maker finalize (`src/runner.ts:150-153`; `src/worktrees.ts:64,92`); review chạy sau (`src/orchestrator.ts:422-433`). Review fail/exhausted (`ReviewExhaustedError`, `:411`) **không revert commit** (`autoCommit` mặc định false — `src/work-planner.ts:23`; thực tế các plan quan sát có `autoCommit: true`, ví dụ `runs/hblxweb-ab1a.plan.json`).
2. **QA verdict không có hiệu lực khi QA chạy như task riêng:** QA run có `maxQAReworkRounds: 0`, `final.qa = {status: NOT_RUN, required: false}` → ACCEPTED dù output QA nói FAIL (OBS, xem 06).
3. **Blocker không chặn scheduling.**

## 5. Governance & an toàn

| Cơ chế | Nhãn | Bằng chứng |
|---|---|---|
| Agent không tool: `claude -p --output-format json --tools "" --no-session-persistence --setting-sources project`, thư mục tạm rỗng, strip env API/Bedrock/Vertex/Foundry | IMPL | `src/providers/claude-code.ts:22,34-46,60,86` |
| MCP cấp user có gắn được vào agent không? (không có `--strict-mcp-config`, không có `--disallowedTools`) | UNKNOWN | — |
| Gate/setup command: chỉ tên executable trần; chạy trên host, không sandbox, không giới hạn mạng, trên code do model viết; chỉ strip env có tên giống secret | IMPL (rủi ro) | `src/repo-workspace.ts:92,95`; `src/worktrees.ts:89`; `src/secrets.ts:37-43` |
| Patch confinement: không path tuyệt đối, `..`, `.git`, `.companyswai`, không symlink thoát, không nội dung giống credential, không target dirty, rollback khi fail | IMPL | `src/repo-workspace.ts:18,49-60,119-130,139-163` |
| Git safety: không push/merge/reset --hard; chỉ `add`, `commit --only`, `reset -q -- paths`, `cherry-pick`, `cherry-pick --abort`, `revert` | IMPL | `src/repo-workspace.ts:155-159`; `src/worktrees.ts:64-79`; takeover dùng allow-list git read-only (`src/takeover-probe.ts:21-25`) |
| Prompt injection: research fence UNTRUSTED-WEB-DATA + sanitize; skill text được scan; excerpt takeover được sanitize | IMPL | `src/research-connectors.ts:77-97`; `src/skill-registry.ts:110`; `docs/TAKEOVER.md:20-22` |
| Artifact upstream và nội dung repo hiển thị cho reviewer **không được fence** | Gap | — |
| Redaction secret trước khi lưu; doctor quét file tracked; `config/providers.json` bị gitignore | IMPL | `src/secrets.ts:4-34`; `src/runner.ts:89`; `src/doctor-cli.ts:93-95` |
| Audit trail: log append-only + `contextRefs` + `skillTrace` + telemetry + project memory + approval | IMPL + OBS | Không chống giả mạo; operator chỉ được dặn không sửa (`CLAUDE.md:21`, P) |
| Status server HTTP 127.0.0.1 không auth, trả output thô | IMPL (rủi ro) | `src/status-server.ts:34` |
| Phân loại lỗi provider bằng regex trên message: lỗi gate chứa "timed out" (`src/repo-workspace.ts:101`) hoặc output model chứa "quota"/"network" có thể bị coi là lỗi provider → sinh lại việc + đánh dấu profile RATE_LIMITED/UNAVAILABLE; ngược lại unknown-model và `CLAUDE_BAD_OUTPUT` không failover | IMPL (suy luận từ code, chưa test) | `src/orchestrator.ts:290`; `src/provider-selector.ts:33-41` |

**Single points of failure:** 1 profile model (`maxConcurrency: 1`); 1 persona reviewer; approval "owner" không xác thực; state dir dạng file (1 state dir / operator — `docs/TAKEOVER.md:75`); 1 operator (dispatch + pack); 1 con người cho mọi approval, scope và failure.

## 6. Resilience — đã quan sát vs chỉ có test

| Tình huống | Cơ chế | Nhãn |
|---|---|---|
| Provider timeout | failover → cooldown 15s → retry; hết → task FAILED | **OBSERVED** (`hblxweb-fec7b`: 3 lần, 2026-10-13 16:02–16:22 UTC) |
| Provider bận | `provider.waiting` "busy" | OBSERVED (14 sự kiện waiting tổng) |
| Hết quota / rate limit | PAUSED_CAPACITY; `--supervise` backoff 30s → 10 phút, tối đa 6h (`src/autonomous.ts:161-170`) | TESTED, **chưa quan sát** |
| Auth failure | Pre-flight `claude auth status` bỏ profile chưa login (`src/runtime.ts:76-78`; `src/providers/claude-code.ts:112-132`); giữa run → UNAVAILABLE → PAUSED | IMPL; chưa quan sát |
| Model unavailable | Không khớp regex → fail ngay, không failover | IMPL (gap) |
| Crash giữa lượt gọi | Finalize từ CHECKPOINTED | TESTED |
| Hai engine cùng project | Không chặn | NOT IMPLEMENTED |
| Integration conflict | Abort + gọi lại 1 lần | OBSERVED (2 lần: `hblxweb-p108b`, `hblxweb-fec1`) |
| Selector state (health/cooldown/quota) | Chỉ trong bộ nhớ, mất giữa các process | IMPL (gap) |

Không được mô phỏng trong test: hai engine một project; race integration; output bị cắt `max_tokens`; auth hết hạn giữa run; unknown model; run/plan/rework JSON hỏng; đĩa đầy; phân loại lỗi sai; phục hồi review-exhaustion.
