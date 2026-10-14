# 00 — Executive Summary

Baseline: `3ecdab1` · Ngày audit: 2026-10-14 · Hồ sơ vận hành: `.companyswai/` (2026-10-08 → 2026-10-14)

## A. Phán quyết

**IMPROVING (execution engine) · FLAT (tổ chức) · INSUFFICIENT EVIDENCE (tự cải tiến)**

1. **So với V0 đã tiến hóa thật — nhưng thành một execution engine, không phải một công ty.**
   - V0 (2026-10-07): 21 file Markdown vai trò, `config/departments.json` 33 vai trò, gần như không có code chạy, 0 test (OBSERVED qua git: `56e1971`…`5de6671`).
   - HEAD (`3ecdab1`): runtime xác định, crash-safe, gate fail-closed, worktree cô lập, review độc lập theo context, 317 test (IMPLEMENTED).
   - Runtime đó đã thực thi thật 383 maker task (2026-10-08 → 10-14); **93,2%** cuối cùng thành công dưới gate thật (OBSERVED).
2. **Phần "công ty" hầu như không được dùng trong vận hành thật.**
   - **340/341 run nhận plan dựng sẵn** (`briefHash == planHash`, xem `src/autonomous.ts:49,62-68`) → đi vòng qua planner công ty (`src/work-planner.ts`), kích hoạt vai trò, và tiêm bài học (`src/plan-compiler.ts:12-20`).
   - 329/341 run chỉ có **1 task**. Phân rã và quản lý thực tế do một phiên Claude Code operator bên ngoài + con người.
3. **Không có bằng chứng tự học/tự cải thiện.**
   - **0/341 plan chứa "LESSONS FROM PRIOR WORK"** dù có 3 lesson `VALIDATED`.
   - Họ lỗi lớn nhất (maker nộp code fail gate — 141 attempt thất bại) có lesson GLOBAL với 42 quan sát bị **REJECTED** là "operational/temporary".
   - 376/376 blocker vẫn `OPEN`.
   - Tỷ lệ attempt maker thất bại theo ngày: 5% (10-11) → 35% (10-12) → 44% (10-13) — *quan sát không có đối chứng độ khó*.
4. **Mâu thuẫn chất lượng mang tính hệ thống:** 20/117 QA run có verdict FAIL/BLOCKED nhưng run kết thúc `ACCEPTED`; 7/7 ca QA FAIL đều đã có reviewer PASS + gate PASS trước đó.

Câu trả lời cho câu hỏi gốc: CompanySWAI **đã tích lũy năng lực thực thi thật** (gate, resume, review loop có dấu vết vận hành) nhưng **chưa trở thành tổ chức tự quản/tự học**; phần lớn "trí tuệ tổ chức" hiện nằm ở operator bên ngoài.

## Điểm mạnh đã kiểm chứng

| Điểm mạnh | Nhãn | Bằng chứng |
|---|---|---|
| Deterministic gates fail-closed bắt lỗi trước integrate | OBSERVED + EFFECTIVE | 447 lần chạy gate; 141 attempt bị chặn; 42/66 task fail gate lần đầu được cứu bằng repair loop (`src/orchestrator.ts:315-321`) |
| Crash-safe, log-driven resume | IMPLEMENTED + TESTED; OBSERVED một phần | `src/runner.ts:42-58`, `test/failure-injection.test.ts` (10 kịch bản) |
| Failover/cooldown khi provider timeout | OBSERVED | Telemetry `hblxweb-fec7b`: 3× `provider.failover` → `provider.waiting` 15s → `provider.retry` |
| An toàn agent (không tool, patch bị giới hạn phạm vi, redaction secret) | IMPLEMENTED | `src/providers/claude-code.ts:22,35`; `src/repo-workspace.ts:49-61,122`; `src/secrets.ts` |
| Ghi vết đầy đủ (execution log, skillTrace, telemetry, review record) | OBSERVED | 798 attempt record, 775 có `skillTrace`, 270 review record |
| Báo cáo benchmark trung thực (ghi nhận thất bại) | DOCUMENTED | `docs/BENCHMARK-RESULTS.md` (`e1fa010`, `3a7ed56`) |
| Sửa quy trình commit giữa era 1 → era 2 loại bỏ lỗi tooling | OBSERVED + EFFECTIVE (do con người) | 5 lần "remove escaped newline" ở era 1, 0 ở era 2 |

## Điểm yếu hệ thống

| Điểm yếu | Bằng chứng chính |
|---|---|
| Quản lý/phân rã nằm ngoài CompanySWAI | 340/341 plan được đưa thẳng; 329 run 1 task |
| Maker làm việc "mù" (không shell, không thấy repo) | 349/354 output maker tự khai "không có shell / không chạy gì"; `--tools ""` |
| QA không có quyền chặn | 20 QA FAIL/BLOCKED → `ACCEPTED`; `final.qa = NOT_RUN, required:false` |
| Học tập không được áp dụng | 0 lesson được tiêm; lesson quan trọng nhất REJECTED |
| Reviewer cùng model, bỏ sót | 7/7 QA FAIL sau review PASS; maker & reviewer cùng profile Sonnet |
| Không có model escalation có hệ thống | 1 lần Opus thủ công (`fec7b`) → 3× timeout 600s → FAILED |
| Governance: integrate trước review; approval không xác thực; không có engine lock | `src/runner.ts:150-153`; `src/approve-cli.ts:8`; `src/company-cli.ts` |
| Thiếu release/ops/maintenance; không có FEATURE COMPLETE / RELEASE READY | `src/run-store.ts:14` |

## Quyết định cuối (bắt buộc)

1. **Mức trưởng thành hiện tại:** ≈ **L1–L2** (orchestration và engineering gates L2; học tập, release, quản lý L0–L1). Chi tiết: `07-MATURITY-SCORECARD.md`.
2. **Tiến hóa đã chứng minh:** từ giấy → execution engine thật: 798 lượt gọi model, 447 lần chạy gate, 357 maker task được giao với xác nhận của gate.
3. **Chỉ có trên giấy:** công ty "elastic"; model escalation; học tập có hiệu lực; release/ops; Playwright/scanner được agent thực thi; vai trò quản lý.
4. **Chạy được nhưng chưa chứng minh giá trị:** skill injection, LLM reviewer, retrospective, project memory, takeover.
5. **Có cải thiện đo được:** gate fail-closed + repair (42/66 task được cứu); crash-safe resume; thay đổi quy trình commit era 1→2.
6. **Điểm yếu lớn nhất:** quản lý/phân rã ngoài CompanySWAI; maker làm việc mù; QA không có hiệu lực; học tập không được áp dụng.
7. **Nâng cấp quan trọng nhất:** P0-1…P0-5 (`10-UPGRADE-ROADMAP.md`).
8. **Bằng chứng còn thiếu trước khi gọi là "tự trị, tự cải tiến":** benchmark có đối chứng chứng minh first-pass/rework/token cải thiện qua version; dispatch ledger cho thấy can thiệp/feature giảm; ít nhất một chuỗi khép kín "lỗi lặp → rule tự đề xuất → được duyệt → tái phát giảm, có số liệu"; feature giao tới release-ready mà không cần operator soạn plan.

## T. Trả lời 20 câu hỏi phán quyết

| # | Câu hỏi | Trả lời |
|---|---|---|
| 1 | Công ty hay framework? | Hiện là **framework thực thi đa agent có kỷ luật**; chức năng "công ty" chủ yếu nằm ở operator bên ngoài |
| 2 | Tiến hóa từ khi tạo? | Giấy (V0) → engine đã test và đã vận hành; tổ chức thu gọn 33 → 11 vai; phần tổ chức hầu như không đổi từ 2026-10-07 23:11 (`0ebf151`) |
| 3 | Quản lý có hiệu quả? | Không — bị đi vòng; quản lý thật diễn ra thủ công qua operator |
| 4 | Orchestration điều phối thông minh? | Xác định, tin cậy, nhưng không thông minh: không reassignment, không escalation, phân rã thô |
| 5 | Agent chuyên môn hóa thật? | Một phần, qua prompt; 11 `IDENTITY.md` dùng chung boilerplate; năng lực bị giới hạn vì không có tool |
| 6 | Biết chọn/dùng skill? | Biết *chọn* theo quy tắc (có lỗi chọn sai: `android` khớp `keyword:kotlin` 111 lần); **không biết *dùng*** (không tool); giá trị chưa đo |
| 7 | Tốc độ cải thiện? | Không có bằng chứng; token/task thành công tăng 103k → 225k trong 3 ngày (không có đối chứng) |
| 8 | Độ chính xác cải thiện? | Không có bằng chứng; tỷ lệ fail tăng theo ngày (không có đối chứng) |
| 9 | Giao sản phẩm hoàn chỉnh tin cậy? | Không: benchmark chưa có `ACCEPTED` sạch; không có release; QA không chặn |
| 10 | Học từ lỗi? | Không có hiệu lực (0 tiêm; lesson lớn nhất REJECTED) |
| 11 | Học tập truyền giữa agent? | Không quan sát được |
| 12 | Tự phát hiện bottleneck? | Không (không có cơ chế phát hiện lỗi lặp) |
| 13 | Giảm can thiệp người? | Không đo được; bằng chứng gián tiếp: 16 re-dispatch thủ công, plan do operator soạn |
| 14 | Nhiều team đồng thời? | Chưa chứng minh: song song tối đa 4 run, 1 profile, không có lock liên process |
| 15 | Phục hồi an toàn? | Tốt cho crash/timeout (test + quan sát); ngõ cụt với review-exhaustion và blocker |
| 16 | Chức năng thiếu | Release/ops/maintenance, scope management, agent evaluation, failure-pattern analysis, design system, cost governance cho subscription |
| 17 | Thành phần không cần | 11 IDENTITY boilerplate, `reviewDepth` chết (`src/company.ts:22`), 3 cách suy ra status, docs "elastic", đường brief-planner hiện không được dùng (dùng lại hoặc bỏ) |
| 18 | 5 nâng cấp lớn nhất | (1) QA có hiệu lực; (2) phân rã/dispatch nội bộ + plan provenance; (3) maker có sandbox tự kiểm; (4) failure registry + thang 1-2-3; (5) model escalation + reviewer đa dạng |
| 19 | Thế hệ kế tiếp | Delivery Controller (code) + Planner gộp + Maker có sandbox + Verifier có quyền veto + Learning service đo được (`09-TARGET-ORGANIZATION.md`) |
| 20 | Bằng chứng tiến bộ trong 30 ngày | Trên benchmark cố định: first-pass ↑, token rework ↓ so với baseline; 0 `ACCEPTED` khi QA FAIL; lesson injection rate > 0; ≥1 lỗi lặp giảm sau rule; can thiệp/task ↓ (dispatch ledger) |
