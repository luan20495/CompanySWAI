# 08 — Organizational Gaps, Process Defects & Root Causes

## 1. Top 10 vấn đề tổ chức

| # | Vấn đề | Bằng chứng | Root cause | Tác động |
|---|---|---|---|---|
| 1 | **Bộ máy "công ty" bị đi vòng; operator bên ngoài là ban quản lý thật** | 340/341 run `briefHash == planHash` (`src/autonomous.ts:49`); 329 run 1 task; plan trỏ tới scratchpad của phiên operator khác | Planner chỉ tạo 1 task/vai cho cả dự án (`src/work-planner.ts:107`) — quá thô cho brownfield; không có đường "plan đã phân rã" chính thức | Mọi cơ chế quản lý, học tập, staffing của CompanySWAI không có hiệu lực |
| 2 | **QA verdict không có hiệu lực → completion sai** | 20 QA FAIL/BLOCKED → `ACCEPTED` (ví dụ `runs/hblxweb-w112-qa.json`: `final.qa = NOT_RUN, required:false`) | QA chạy như maker task; `src/final-status.ts` chỉ đọc QA phase | Báo cáo sai mức hoàn thành; người tin "ACCEPTED" |
| 3 | **Maker làm việc mù** | 349/354 output khai không có shell; 141 attempt fail; 23,7% token lãng phí | `--tools ""` (`src/providers/claude-code.ts:35`) + không có view repo (`src/context.ts:45-54`) | First-pass code ≈69%; rework |
| 4 | **Học tập không được áp dụng và bị lọc sai** | 0/341 plan có lesson; lesson GLOBAL 42 quan sát REJECTED | Tiêm chỉ trên đường brief (`src/plan-compiler.ts:44-49`); bộ lọc "operational" (`src/company-experience.ts:36-54`); project fail không dạy (`src/autonomous.ts:141`) | Lỗi lặp không giảm (5% → 44%) |
| 5 | **Reviewer cùng model, bỏ sót** | 7/7 QA FAIL sau review PASS | Không đa dạng model/lens; không checklist từ lỗi QA trước | Lỗi lọt xuống QA/người dùng |
| 6 | **Không có escalation model/task có hệ thống** | 1 lần Opus thủ công (`fec7b`): 3× timeout 600s → FAILED; 16 re-dispatch thủ công | Không có policy; timeout cố định; 1 profile | Con người/operator làm dispatcher |
| 7 | **Integrate trước review; approval không xác thực; không lock engine** | `src/runner.ts:150-153`; `src/approve-cli.ts:8`; `src/approval-store.ts:27-29`; `src/company-cli.ts` không có `engineGuard` | Thiết kế ưu tiên tốc độ/đơn giản | Rủi ro governance; code chưa review có thể nằm trong repo |
| 8 | **Không có release/ops/maintenance; không có FEATURE/RELEASE state** | `src/run-store.ts:14` | Phạm vi dừng ở artifact | Không giao được "sản phẩm hoàn chỉnh" |
| 9 | **Blocker và review-exhaustion là ngõ cụt** | 376/376 OPEN; `ReviewExhaustedError` tái phát khi resume (`src/orchestrator.ts:411`); "unblock" không có lệnh (`src/operator.ts:196`) | Không có lifecycle resolve | Cần người can thiệp |
| 10 | **Không có metric tổ chức/dashboard tiến hóa; docs lệch thực tế** | Không first-pass metric; `docs/BENCHMARK-RESULTS.md` không ghi 340 run; docs "1 repair round" vs code 2 | Telemetry có nhưng không tổng hợp; không có `companyVersion` trên run | Không chứng minh được tiến bộ |

## 2. Gap analysis theo tác động

Thang: ↑ cao · → trung bình · ↓ thấp · — không đáng kể.

| Gap | Tốc độ | Chính xác | Hoàn chỉnh | Chi phí | Tự chủ | Tin cậy | Ưu tiên |
|---|---|---|---|---|---|---|---|
| Phân rã/dispatch nằm ngoài công ty | ↑ | → | → | → | ↑ | → | P0 |
| QA verdict không chặn | — | ↑ | ↑ | — | → | ↑ | P0 |
| Maker không tool/repo | ↑ | ↑ | → | ↑ | → | → | P0 |
| Học tập không áp dụng + lọc sai | → | ↑ | → | → | ↑ | → | P0 |
| Governance (integrate trước review, approval, lock) | — | → | → | — | — | ↑ | P0 |
| Không escalation model/task | → | → | — | → | ↑ | → | P1 |
| Reviewer đơn model | — | ↑ | → | → | — | → | P1 |
| Risk theo project, không theo task | → | → | — | → | — | — | P1 |
| Skill routing sai (keyword) | ↓ | ↓ | — | → | — | — | P1 |
| Không metric/dashboard | → | → | → | → | ↑ | → | P1 |
| Docs drift | ↓ | → | — | — | → | — | P1 |
| Không release/ops/feature state | — | → | ↑ | — | → | ↑ | P2 |
| Selector state không bền liên process | → | — | — | → | → | → | P2 |
| O(n²) log append; JSON hỏng không cách ly | → | — | — | — | — | → | P2 |
| Status server không auth | — | — | — | — | — | → | P2 |

**Không đề xuất thêm agent**: mọi gap trên giải quyết được bằng orchestration, consolidation hoặc instrumentation.

## 3. Đặc biệt lưu ý (theo yêu cầu audit)

| Chủ đề | Phát hiện |
|---|---|
| Trách nhiệm mờ | Không ai chấp nhận requirement; không ai giải quyết bất đồng; operator vừa là relay vừa là PM thực tế |
| Số agent thừa | Không thừa về số lượng chạy (1 instance/vai); thừa về định nghĩa (11 IDENTITY boilerplate, 3 vai engineer cùng output) |
| Việc trùng | Không quan sát; rủi ro do không có lock liên process |
| Handoff yếu | Upstream bị cắt 30k ký tự (sửa 3 lần, vẫn còn); maker không thấy repo |
| Review kém hiệu quả | 7/7 bỏ sót; cùng model |
| Thiếu quality gate | Không có gate cho vai không viết code; QA không chặn; không release gate |
| Gate thừa | Không có bằng chứng; `node -e process.exit(0)` (benchmark commerce) là gate giả gây 4 vòng từ chối |
| Không dùng skill thật | Skill chỉ là prompt; 0 tool được agent chạy |
| Bộ nhớ không dùng | 0 lesson tiêm; project memory không được đọc lại |
| Lỗi lặp | F1 tăng theo ngày; F4 sửa 3 lần |
| Phục hồi yếu | Review exhaustion vĩnh viễn; blocker không resolve |
| Completion sai | 20 ca |
| Thiếu telemetry | Can thiệp người, prompt, lesson trace, `companyVersion`, chi phí tiền |
| Micromanagement | Plan, pack, gate, re-dispatch, đổi model đều thủ công qua operator |

## 4. Mâu thuẫn docs ↔ config ↔ code ↔ vận hành

| # | Nguồn A | Nguồn B | Mâu thuẫn |
|---|---|---|---|
| 1 | `CLAUDE.md:14-22` (operator không làm việc dự án) | Hồ sơ runtime | Operator (phiên khác) soạn pack code + gate, chạy mutation check |
| 2 | `README.md:33`, `src/autonomous.ts:18` ("decomposition … are the plan's tasks") | `src/work-planner.ts:107` | 1 task/vai; `technical-plan` không thành task |
| 3 | `docs/ORCHESTRATION.md`, `src/validators.ts:6` ("1 repair round") | `src/runner.ts:38` | Code cho 2 |
| 4 | `docs/ELASTIC-ORGANIZATION.md`, README "elastic" | `src/work-planner.ts` | Roster cố định 1 instance |
| 5 | `docs/BENCHMARK-RESULTS.md` | `.companyswai/runs` | 340 run không được ghi |
| 6 | `src/final-status.ts:35-36` (risk quality-shortfall) | `src/orchestrator.ts:280` | Risk không bao giờ kích hoạt được |
| 7 | `src/work-planner.ts:23` (`autoCommit` mặc định false) | Plan quan sát (`autoCommit: true`) | Operator bật auto-commit → integrate-trước-review có hiệu lực thật |
| 8 | Profile hiện tại `sonnet` (`config/providers.json`) | Execution record `claude-opus-5-5` ×3 (`fec7b`) | Config bị đổi tạm thời, không có dấu vết thay đổi |
| 9 | `src/operator.ts:196` gợi ý "unblock" | `src/operator-commands.ts:35-53` | Lệnh không tồn tại |
| 10 | Kết luận của sub-agent lịch sử ("sau 10-09 không có live delivery") | `.companyswai/` | Bị hồ sơ runtime bác bỏ — đã hiệu chỉnh trong báo cáo |
