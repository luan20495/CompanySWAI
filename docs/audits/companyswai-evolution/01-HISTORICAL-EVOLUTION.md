# 01 — Historical Evolution (commit đầu → HEAD)

Nguồn: `git log`, `git show`, `git blame` trên repo; baseline `3ecdab1`. Commit time theo +0700.

## 1. Hai thời kỳ phát triển

| Thời kỳ | Commit | Đặc điểm | Tổng dòng | Loại commit | Tỷ lệ fix |
|---|---|---|---|---|---|
| **Era 1** — tác giả `luan20495` (2026-10-07 20:28 → 10-08 10:52) | 93 (`56e1971` → `153a9fa`) | 50 commit đầu (đến `9fab3bb`) mỗi commit chạm đúng 1 file, cách nhau vài giây; 5 commit có committer `GitHub` (`03bbd2d`, `6691bb4`, `6791311`, `8c74f16`, `668a431`). Suy luận (không chắc chắn): commit qua GitHub API/web bởi công cụ LLM — có chuỗi `\n` literal lọt vào code TS. Không có lockfile tới `b41eec3`. | +3.601 / −1.264 | 30 feat, 20 fix, 18 "agents", 12 "architecture" | **40%** |
| **Era 2** — tác giả `Hoang Luan` + `Co-Authored-By: Claude Sonnet 5.5` (2026-10-08 11:29 → 10-11 17:50) + `a7e53f4` (Opus 5.5) | 42 + 1 | Commit lớn nhiều file, kèm test; ~34 commit trong 10-08 11:29–14:44 | +13.305 / −1.846 | 26 feat, 8 fix | **24%** |

Dòng thêm/xóa theo ngày: 10-07 +2.747/−789 · 10-08 +9.062/−2.095 · 10-09 +47/−12 · 10-10 +1.624/−46 · 10-11 +3.426/−168 · nhánh `a7e53f4` +471/−1.

## 2. Ảnh chụp V0 (sau `5de6671`, 2026-10-07 20:40; 32 file)

| Chiều | Trạng thái V0 | Nhãn |
|---|---|---|
| Cấu trúc | `config/departments.json`: 7 phòng ban (product 2–6, architecture 1–3, backend 0–8, frontend 0–8, design 0–6, platform 0–5, qa 2–8), 26 vai trò; `81ad0e4` (21:01) thêm mobile → **8 phòng ban, 33 vai trò** | DOCUMENTED |
| File agent | 21 file Markdown (tổng 1.105 từ): product-lead, ba, researcher, product-critic, ux-researcher, ux-designer, ui-designer, design-reviewer, tech-lead, backend-lead/dev/reviewer, frontend-architect/dev/reviewer, devops, sre, qa-lead, functional-api-qa, automation-e2e-qa, performance-security-qa. 13 vai trong JSON chưa từng có file | DOCUMENTED |
| Quản lý | Product Lead là đầu mối; department lead; Maker → Reviewer → Approver (`docs/ELASTIC-ORGANIZATION.md` @`e433daa`) | DOCUMENTED |
| Workflow | Owner → Product Lead → Tech Lead → specialists → review gates → QA → Product Lead → Owner (`README.md` @`56e1971`) | DOCUMENTED |
| "Elastic" | `src/company.ts` @`d00594d`: `composeCompany` hard-code; complexity ≥3 thêm agent (ví dụ backend-dev thứ hai) | IMPLEMENTED (tối thiểu) |
| Orchestration / routing / CLI | Không có; `package.json` trỏ `src/index.ts` không tồn tại | NOT IMPLEMENTED |
| Skill | Không có | NOT IMPLEMENTED |
| Memory | Prose (`docs/MEMORY-AND-LEARNING.md`, `projects/README.md`, `company-experience/README.md`); schema CANDIDATE → VALIDATED trong `src/contracts.ts`, `canPromote` trong `src/retrospective.ts` | DOCUMENTED + schema |
| Review/QA | Chỉ schema Zod `Review` | DOCUMENTED |
| Test | 0 | — |
| Autonomy | Không | — |

## 3. Timeline các mốc

| Ngày | SHA | Thay đổi | Impl/Docs | Số phận / hiệu quả |
|---|---|---|---|---|
| 10-07 20:28–20:40 | `56e1971`…`5de6671` | Bootstrap: README, departments.json, company.ts, contracts.ts, 3 docs, 21 agent .md | Docs + ~50 dòng TS, 0 test | **Bị xóa trong 2,5h–1 ngày**: agent + departments.json (`60d87c5`), contracts.ts (`201a4ab`), projects/ + company-experience/ (`b0712dd`) |
| 10-07 21:01–21:10 | `81ad0e4`, `05e0870`, `f8d17d5`, `2da53cd`, `833d3e5`, `e291f39`, `fa92f48`, `b5f8e4d` | Mobile dept, composition theo capability, capacity/cost routing, scheduler, provider interface, checkpoint; 3 test đầu | Impl | `src/scheduler.ts` chỉ được `test/core.test.ts` dùng → xóa như dead code ở `b41eec3`; scheduler mới ở `c5d4f69`/`c55face` |
| 10-07 21:03 | `47e2ef9`, `0e9cbee` | ENGINEERING-BASELINE.md, ORCHESTRATION.md | Docs | ENGINEERING-BASELINE xóa ở `b0712dd`; ORCHESTRATION viết lại 7 lần |
| 10-07 22:20–22:53 | `03bbd2d`, `6691bb4`, `6791311`, `8c74f16`, `668a431`, `f2e5a1a`, `208d25c` | Runtime chạy được đầu tiên (anthropic + echo, CI), review gates, status API, OpenRouter, budget/failover, approvals | Impl + test | `src/index.ts`, echo xóa ở `b41eec3`; `test/orchestrator.test.ts` (7 lần sửa, +133/−133) xóa ở `201a4ab` |
| 10-07 23:11–23:16 | `0ebf151`, `1b4c3a6`, `8417089`, `60d87c5`, `7b64dbf` | **Roster 11 agent Markdown-first** (`agents/<id>/{IDENTITY,RULES}.md`, `company/*.md`, 11 `skills/*.md`, `md-agent-loader.ts`) | Impl | **Vẫn là hiện trạng**; 416/496 dòng `agents/` có từ era 1 |
| 10-08 10:30–10:52 | `272e34c`…`153a9fa` | Project memory, code patch + gate, approvals, multi-account, budget hierarchy, company experience — **14 fix trong 22 phút** | Impl | Phần lớn bị thay bởi `201a4ab` (+1.003/−407, 44 file) |
| 10-08 11:29–11:44 | `b41eec3`, `9053f68`, `77252d9`, `c3f125d`, `201a4ab`, `a5a6089`, `b0712dd`, `c73e096` | Dọn dẹp + tái kiến trúc era 2: lockfile, xóa dead code, provider registry, orchestration log-driven crash-safe, learning loop, xóa docs cũ, `noUnusedLocals` | Impl + test (34 → 91) | Lõi hiện tại |
| 10-08 12:02 | `6747d48` | Provider `claude-code` (`claude -p`, subscription) | Impl | **Provider duy nhất được dùng trong mọi live run** (OBSERVED) |
| 10-08 12:11–12:48 | `cb1b52d`, `c5d4f69`, `c55face`, `1279623`, `c4f691f`, `ac8716c`, `3a8a14d`, `2e546a4`, `047a02d` | Dynamic skills, POLICY modes, isolated contexts, multi-reviewer, validators, routing pools, worktrees + gates, learning scopes, autonomous mode, failure injection + benchmark, research connectors | Impl + test (91 → 198) | Đang dùng; gate/worktree **OBSERVED** (447 gate runs) |
| 10-08 12:52–14:44 | `a271aa3`, `bfe6395`, `5516b90`, `ab3ad79`, `fa3cdae`, `0a86a41`, `1d247d7`, `e1fa010`, `92b1ff9`, `c365bf1`, `924282a` | Fix từ live run: review context, định dạng requirement, round limits, worktree base, QA evidence, race git-index, QA rework loop, Node 18 policy | Impl + test | Đang dùng |
| 10-09 00:00–00:30 | `f1bfedc`, `135e39e`, `3a7ed56` | Fix phạm vi gate, verifier thấy toàn bộ artifact, closure results | Impl + docs | Đang dùng |
| 10-10 18:30 | `557a9b9` | Claude Code làm **operator** (CLAUDE.md contract, `npm run operator`, stop/resume/priority) | Impl + 25 test | OBSERVED gián tiếp; thực tế operator còn tự soạn plan (xem 02) |
| 10-11 08:15 | `ff22c19` | Skill layer có kiểm toán: registry (provenance/license/injection scan), resolver, 10 skill mới, `docs/SKILLS-AUDIT.md` | Impl + test | **OBSERVED**: `skillTrace` trên 775/798 attempt; giá trị UNKNOWN |
| 10-11 15:13–17:50 | `5312319`, `1a6cd24`, `3ecdab1` | Brownfield **takeover**: probe read-only, evidence pack, kiểm tra citation, write có approval, JUnit executed evidence; `3ecdab1` áp review findings 10 phút sau `1a6cd24` | Impl + test (275 → 317) | **OBSERVED**: 3 takeover (`.companyswai/takeover/{hblxweb,hblxweb-v2,hblxweb-v3}`) |
| 10-14 05:32 | `a7e53f4` (chưa merge; merge-base `3ecdab1`; PR #7) | Quy tắc vòng đời nhánh Git + `npm run branches -- audit|cleanup` (không bao giờ `-D`) | Impl + test (326) | Ví dụ duy nhất "bài học vận hành → quy tắc", **do con người khởi xướng, chưa merge** |

## 4. Tiến hóa roster

21 file / 33 vai cấu hình → **11 agent** (`0ebf151`; manifest `agents/AGENTS.md` ở `1b4c3a6`; loader giới hạn ở `8417089`; xóa file cũ + departments.json ở `60d87c5`, 2026-10-07 23:14). 21 file gốc tồn tại ~2,5 giờ.

Roster hiện tại (không đổi từ đó): product-lead, business-analyst, researcher, tech-lead, backend-engineer, frontend-engineer, mobile-engineer, ux-ui-designer, reviewer, qa-engineer, devops-sre.

| Vai cũ | Hiện nay |
|---|---|
| backend-lead, frontend-architect, architect, security/performance/platform/mobile-architect | **tech-lead** (bỏ mọi department lead) |
| product-critic, backend/frontend/design/mobile-reviewer, platform-security-reviewer | 1 **reviewer** + POLICY "lens" |
| ux-researcher, ux-designer, ui-designer, design-reviewer | **ux-ui-designer**; ux-research thành dynamic skill |
| qa-lead + 3 QA specialist | **qa-engineer**; e2e/perf/security thành skill |
| devops + sre | **devops-sre** |
| data-specialist, performance-specialist, android/ios specialist | dynamic skills (`skills/dynamic/{database,frontend-performance,android,ios}.md`) |

- **"Elastic headcount" bị bỏ:** planner tạo 1 task/maker agent (`src/work-planner.ts`, vòng `for(const agent of makers)`); không còn min/max, không còn instance thứ hai. `docs/ELASTIC-ORGANIZATION.md` vẫn giữ tiêu đề nhưng chỉ còn stub 3 đoạn.
- **File agent mỏng:** 11 `IDENTITY.md` có đoạn "## Behaviour" giống hệt nhau (cùng md5), mỗi file ~70 từ. Logic vai trò thật nằm ở vài `RULES.md` (qa-engineer 438 từ, reviewer 268, researcher 250, BA 203; còn lại 64–124 từ).

## 5. Churn & rework

| File | Số commit | Ghi chú |
|---|---|---|
| `src/orchestrator.ts` | 31 (15 era 1 / 16 era 2) | +1.033 / −505 |
| `src/runner.ts` | 20 | |
| `README.md` | 17 | |
| `src/plan-compiler.ts` | 17 | |
| `src/work-planner.ts` | 16 | |
| `src/project.ts` | 15 | |
| `package.json` | 15 | |
| `src/company.ts` | 10 | Thiết kế lại 2 lần: hard-code (`d00594d`) → capability (`05e0870`) → Markdown registry (`0ebf151`) |

**Viết lại không có lợi ích lâu dài:** departments.json (tạo/viết lại/xóa trong 2,5h), 21 file agent, `src/contracts.ts`, `src/scheduler.ts` (không bao giờ nối vào runtime), `src/workspace.ts` + echo provider, 5 file test era 1 (e2e-company, execution, failover, orchestrator, resume-review — xóa ở `201a4ab`). `git blame` tại main: chỉ **1.342/12.888 dòng (10%) từ era 1** (src 590/6.575, test 212/4.388, agents 416/496).

**Fix era 1 (40%) là lỗi cơ học, không phải lỗi hành vi:**
- 5 "remove escaped newline": `48edf07`, `00175b6`, `78ba401`, `0244fed`, `dddc554`.
- 9 schema-default/type plumbing: `e23b576`, `f952794`, `204f866`, `b09bec6`, `d4503b4`, `f73294b`, `d31c5df`, `a6f2114`, `153a9fa`.
- 4 wiring: `91b4342`, `0cc48f1`, `ccf0171`, `f9690cd`; 2 manifest: `1b4c3a6`, `8417089`.
- Fix đến 1–6 phút sau feature (ví dụ `272e34c`/`210c036` 10:30–10:32 → 4 fix tới 10:34; `1d13d8b`/`0eae97a` 10:47–10:48 → 8 fix tới 10:52) ⇒ code được commit khi chưa biên dịch.

**Fix era 2 (24%) là lỗi hành vi lộ ra từ live run.** Đáng chú ý: **cùng một root cause bị sửa 3 lần** — agent nhận artifact bị cắt: `a271aa3` (reviewer thấy toàn bộ artifact) → `bfe6395` (mọi section) → `135e39e` (QA verifier thấy toàn bộ upstream). Giới hạn `DEFAULT_UPSTREAM_CHARS=30_000` vẫn còn (`src/orchestrator.ts:76`).

## 6. Tăng trưởng test

| SHA | Thời điểm | Số test (`test(`/`it(`) | File test |
|---|---|---|---|
| `b5f8e4d` | 10-07 21:10 | 3 | — |
| `03bbd2d` | 10-07 22:20 | 6 | — |
| `7b64dbf` | 10-07 23:16 | 21 | 11 |
| `153a9fa` | cuối era 1 | 35 | 20 |
| `201a4ab` | 10-08 11:39 | 80 | — |
| `ac8716c` | 10-08 12:41 | 187 | — |
| `3a7ed56` | 10-09 00:30 | 221 | 31 |
| `557a9b9` | 10-10 | 246 (commit message nói 249) | — |
| `ff22c19` | 10-11 | 275 | — |
| **`3ecdab1`** | **HEAD** | **317** | 36 |
| `a7e53f4` | nhánh | 326 | 37 |

## 7. Docs drift

| Docs | Khẳng định | Thực tế |
|---|---|---|
| `README.md` @`56e1971` | "Claude-compatible provider adapter, CLI runner", `.env.example`, `npm run dev` | Không tồn tại tới `03bbd2d`/`668a431`; `src/index.ts` sau đó bị xóa (`b41eec3`) |
| `config/departments.json` V0 | 13 vai trò | Chưa từng có định nghĩa |
| `docs/ELASTIC-ORGANIZATION.md` @`e433daa` | "UI → Designer inspection of running product", scale maker theo complexity | Không bao giờ triển khai; `docs/TAKEOVER.md` nói "agents are text-in/text-out: they never read a workspace" |
| `projects/README.md` | Layout `projects/<id>/brief, requirements…` | Không dùng; thay bằng `.companyswai/projects/`; xóa ở `b0712dd` |
| `company-experience/` | Thư mục kinh nghiệm | Thay bằng `.companyswai/company-experience.json` (`src/company-experience.ts:59`); xóa ở `b0712dd` |
| Vai QA V0 | Automated E2E, performance, security testing | `agents/qa-engineer/RULES.md`: "You cannot run code yourself"; `ff22c19` chỉ dò PATH, "never installed or run" |
| `README.md:71` | "work stealing" | Chỉ xuất hiện như tên test (`test/scheduler.test.ts:54`); không xác minh được hành vi — UNKNOWN |
| `README.md:33`, `src/autonomous.ts:18` | "decomposition … are the plan's tasks" | Planner tạo 1 task/vai; `technical-plan` không thành task (`src/work-planner.ts:107`) |
| `docs/ORCHESTRATION.md`, `src/validators.ts:6` | "1 repair round" | Code cho 2 (`src/runner.ts:38`) |
| `docs/BENCHMARK-RESULTS.md` | Kết quả live đến 10-09 | Không phản ánh 340 run thật 10-11 → 10-14 trong `.companyswai/` |

## 8. Kết quả benchmark được ghi trong repo (DOCUMENTED, `docs/BENCHMARK-RESULTS.md`)

Mọi run dùng provider `claude-code` (subscription) ⇒ không có chi phí tiền.

| Run | Kết quả | Token | Thời gian |
|---|---|---|---|
| Library (semver) lần 1, BALANCED, gate thật | 5/5 task, 9 lượt gọi model, 64 test pass, 1 gate retry; QA FAIL (1 deviation + 1 blocked) → **`FAILED_QA`** | 135k in / 61k out | 495s |
| Closure 1 (resume) | `ACCEPTED_WITH_RISKS` — tài liệu tự nhận "not a clean measurement" (gồm 12 attempt thất bại) | — | — |
| Closure 2 (clean, trước fix verifier) | **`BLOCKED`** — do cắt 30k ký tự (lỗi của CompanySWAI) | — | — |
| Closure 3 (clean, sau fix) | 5/5 task; 4 review PASS 0 revision; QA PASS 27 requirement ↔ 27 test; 2 gate-repair → **`ACCEPTED_WITH_RISKS`** | 155k in / 77k out | 757s |
| Commerce, MAX_QUALITY, gate no-op | 2 reviewer HIGH_RISK từ chối 4 vòng vì gate là `node -e process.exit(0)` → **`FAILED`** | 1,40M in / 0,37M out | 2.414s |
| "Four earlier live runs" | "failed on defects in CompanySWAI itself" | — | — |

⇒ Qua ≥7 live run được ghi trong docs: **0 lần `ACCEPTED` sạch**. Tài liệu thừa nhận vòng QA FAIL → rework "has not fired against a real model".

**Hiệu chỉnh quan trọng:** sau 10-09, docs không ghi thêm kết quả, nhưng hồ sơ runtime `.companyswai/` cho thấy **340 run thật trong 2026-10-11 → 10-14** (xem `06-PERFORMANCE-AND-QUALITY.md`). 45 run trong ngày 10-11 có thể chạy trên commit trước `3ecdab1` (17:50); các run từ 10-12 chạy trên `3ecdab1` (không có commit mới trên main sau đó).

## 9. So sánh V0 ↔ hiện tại

| Chiều | V0 | Hiện tại | Đánh giá |
|---|---|---|---|
| Cấu trúc | 33 vai "elastic" trên giấy | 11 vai cố định, 1 instance | Đơn giản hóa hợp lý; tên "elastic" còn trong docs |
| Orchestration | Không | DAG, crash-safe, review/QA loop | **Cải thiện thật** (IMPLEMENTED + OBSERVED) |
| QA | Schema | Gate xác định chạy thật + QA LLM đọc output gate | Cải thiện thật; nhưng QA verdict không có hiệu lực |
| Model routing | Không | Đa provider trong code; thực tế 1 profile Sonnet | Chỉ có trong code |
| Học tập | Prose | Vòng lesson theo khuôn mẫu; 0 lần tiêm thật | Lưu trữ ≠ sử dụng |
| Test | 0 | 317 | Cải thiện thật |

**Đánh giá tổng:** cải thiện thật ở hạ tầng (runtime có test, resume, gate, policy, báo cáo trung thực; fix era 2 truy được về lỗi live). Viết lại không lợi ích: toàn bộ buổi tối đầu tiên của era 1. Độ phức tạp tổ chức giảm, hạ tầng/policy tăng; ba commit cuối (operator, skill layer, takeover) là tooling quanh engine — không thay đổi cách agent sản xuất phần mềm.
