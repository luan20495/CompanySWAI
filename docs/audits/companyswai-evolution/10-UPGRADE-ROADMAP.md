# 10 — Upgrade Roadmap (P0/P1/P2, 30/60/90, EvoBench, Metrics)

> **Chỉ là đề xuất.** Không triển khai trong audit. Effort: S ≤2 ngày, M ≤1 tuần, L >1 tuần (ước lượng thô, chưa kiểm chứng).

## 1. P0 — Điểm yếu hệ thống nghiêm trọng

### P0-1. QA verdict có hiệu lực chặn
- **Vấn đề:** 20 QA FAIL/BLOCKED vẫn `ACCEPTED`.
- **Root cause:** QA chạy như maker task; `src/final-status.ts` chỉ đọc QA phase; plan `maxQAReworkRounds: 0`.
- **Bằng chứng:** `runs/hblxweb-w112-qa.json` (`final.qa = NOT_RUN, required:false`); 06 §3.5.
- **Chức năng:** Quality / Verification.
- **Thay đổi:** `final-status` đọc verdict từ mọi task `qa-engineer` (và reviewer); run chỉ có QA nhận `FAILED_QA`/`BLOCKED` tương ứng.
- **Cách làm:** đọc QA status đã parse (`src/structured.ts`) trong execution record; thêm trường `verdict` có cấu trúc.
- **Effort:** S · **Rủi ro:** thấp (có thể làm nhiều run "fail" hơn — đó là mục tiêu).
- **Phụ thuộc:** không.
- **Acceptance:** replay 117 QA run cũ → các run FAIL/BLOCKED đổi trạng thái; test hồi quy mới.
- **Đo:** incorrect-completion rate = 0.
- **Rollback:** feature flag.

### P0-2. Đưa phân rã/dispatch vào engine + plan provenance
- **Vấn đề:** 340/341 plan đưa thẳng, đi vòng planner + lesson injection; can thiệp không được ghi.
- **Root cause:** planner quá thô (1 task/vai); không có đường "plan đã phân rã" chính thức.
- **Bằng chứng:** `briefHash == planHash`; `src/autonomous.ts:49,62-68`.
- **Thay đổi:** chấp nhận plan do operator đưa như "brief đã phân rã" nhưng **vẫn áp `learningFor`, skill routing, risk theo task**, ghi `planSource` (brief/operator/human) và `companyVersion`; thêm **dispatch ledger** (ai, khi nào, vì sao: dispatch, re-dispatch, đổi model, sửa plan).
- **Effort:** M · **Rủi ro:** trung bình (đổi luồng PLAN).
- **Acceptance:** 100% run mới có `planSource`, `companyVersion`; lesson được tiêm khi scope khớp (kiểm bằng ca `mx2`).
- **Đo:** lesson injection rate; can thiệp / task được chấp nhận.
- **Rollback:** flag giữ đường cũ.

### P0-3. Maker có vòng tự kiểm chứng trong sandbox
- **Vấn đề:** 349/354 maker không chạy được gì; 141 attempt fail; 23,7% token rework.
- **Root cause:** `--tools ""` + không view repo.
- **Thay đổi:** cho maker đọc repo (read-only) và chạy **đúng** lệnh gate trong worktree cô lập (allow-list, không mạng, giới hạn thời gian); hoặc tối thiểu runtime chạy gate "dry" và trả lỗi vào **cùng attempt** trước khi kết thúc.
- **Effort:** L · **Rủi ro:** bề mặt thực thi → cần sandbox, giới hạn mạng, allow-list lệnh.
- **Acceptance:** trên EvoBench, tỷ lệ attempt fail ≤15% (hiện 35–44%); token rework ≤10%.
- **Đo:** first-pass, rework token share.
- **Rollback:** flag per-role.

### P0-4. Failure registry + thang leo thang 1-2-3
- **Vấn đề:** không phát hiện lỗi lặp; lesson quan trọng bị REJECTED; blocker không có lifecycle.
- **Thay đổi:** chữ ký lỗi (gate, ngôn ngữ, mã lỗi, vai, skill); lần 1 fix + test; lần 2 rule/checklist được tiêm (có trace); lần 3 postmortem bắt buộc + ticket orchestration; không REJECT lesson "operational" khi lặp ≥3; project thất bại cũng được học; blocker OPEN → OWNER → RESOLVED/WAIVED.
- **Effort:** M · **Rủi ro:** lesson nhiễu → giữ approval cho rule cấp công ty.
- **Acceptance:** báo cáo lỗi lặp hằng ngày; lỗi cùng chữ ký giảm ≥30% sau 30 ngày trên EvoBench.
- **Rollback:** tắt tiêm rule theo id.

### P0-5. Siết governance
- **Vấn đề:** integrate trước review; approval không xác thực, ghi được không cần request; không lock engine liên process.
- **Bằng chứng:** `src/runner.ts:150-153`; `src/approve-cli.ts:8`; `src/approval-store.ts:27-29`; `src/company-cli.ts`.
- **Thay đổi:** review trước integrate (hoặc auto-revert khi review fail/exhausted); lock file theo project; approval gắn request id + danh tính; đóng race integration (`src/worktrees.ts:96-99`) bằng lock thống nhất.
- **Effort:** M · **Acceptance:** test failure-injection cho từng điểm (2 engine, race, approval không request).
- **Rollback:** flag.

## 2. P1 — Giá trị cao

| # | Nâng cấp | Vấn đề / bằng chứng | Acceptance | Effort |
|---|---|---|---|---|
| P1-6 | Policy escalation model: Sonnet → Opus sau 2 lần fail gate cùng chữ ký, timeout lớn hơn | `fec7b`: Opus timeout 600s ×3 | Escalation được ghi (ledger) với outcome + chi phí; tỷ lệ cứu được đo | M |
| P1-7 | Đa dạng reviewer: model khác hoặc lens "spec-conformance diff" bắt buộc + checklist từ các QA FAIL trước | 7/7 bỏ sót | Defect escape giảm trên EvoBench (bộ diff cài lỗi) | M |
| P1-8 | Sửa skill routing: bỏ khớp keyword đơn (kotlin→android), điều kiện loại trừ, đo skill → outcome | `android` 111 lần qua `keyword:kotlin` | Precision skill ≥90% trên bộ brief chuẩn | S |
| P1-9 | Risk theo task | `src/work-planner.ts:41` | Task code nhạy cảm nhận review HIGH_RISK, prose không | S |
| P1-10 | Dashboard tổ chức từ log thật | Không metric first-pass/throughput | Hiển thị 12 metric ở §5 | M |
| P1-11 | Đồng bộ docs | Mâu thuẫn 08 §4 | 0 mâu thuẫn đã liệt kê | S |
| P1-12 | Review exhaustion có lối ra (override có approval) + lệnh `unblock` | `src/orchestrator.ts:411`; `src/operator.ts:196` | Resume sau override thành công | S |
| P1-13 | Upstream không bị cắt cứng 30k / tóm tắt có cấu trúc | `src/orchestrator.ts:76` | Không còn finding "artifact bị cắt" | S |

## 3. P2 — Chiến lược

| # | Nâng cấp |
|---|---|
| P2-14 | Trạng thái FEATURE COMPLETE và RELEASE READY + quy trình release/rollback (owner duyệt) |
| P2-15 | Lifecycle nâng cấp tổ chức an toàn (09 §5) với `companyVersion`, flag, A/B |
| P2-16 | Lưu health/quota provider liên process; đa profile; lập lịch đa dự án |
| P2-17 | Đánh giá hiệu năng agent theo vai/skill với số liệu thật |
| P2-18 | Log append O(1), fsync, cách ly JSON hỏng; auth cho status server |

## 4. Lộ trình 30/60/90 ngày

| Giai đoạn | Việc | Bằng chứng thành công |
|---|---|---|
| **0–30** | P0-1, P0-2, P0-5; dashboard tối thiểu; **đóng băng baseline EvoBench trên `3ecdab1`** | Baseline đo được; 0 run ACCEPTED khi QA FAIL; 100% run có `planSource` + `companyVersion` |
| **31–60** | P0-3, P0-4, P1-6, P1-7, P1-8 | EvoBench: first-pass ↑, token rework ↓, reviewer miss ↓ so với baseline |
| **61–90** | Controller/Planner nội bộ thay dispatch thủ công; P2-14; P2-15; thí nghiệm scaling | Can thiệp / task được chấp nhận ↓ ≥50%; ≥1 rule tự đề xuất → được duyệt → chứng minh giảm lỗi lặp |

## 5. Khung metric tiến hóa

| Metric | Định nghĩa | Tử số | Mẫu số | Cửa sổ | Nguồn | Kết quả hiện tại | Xu hướng |
|---|---|---|---|---|---|---|---|
| Lead time | intake → accepted | — | — | — | (chưa có intake) | UNKNOWN | — |
| Cycle time task | start attempt 1 → task DONE | — | — | 10-11→10-14 | executions | Attempt trung vị 52s; run trung vị 2,8 phút | — |
| Accepted throughput | run ACCEPTED / giờ bận | 309 | 27,9h | 10-08→10-14 | runs | ≈11/h | — |
| Queue/wait | khoảng chờ giữa run | 218 khoảng | — | | runs | trung vị 3,2 phút, tổng 33,1h | — |
| First-pass maker | attempt 1 qua gate | 313 | 383 | | executions | 81,7% | 99% → 83% → 71% |
| First-pass + review vòng 1 | | — | — | | executions + reviews | **UNKNOWN** (cần join) | — |
| Gate failure rate | attempt fail / maker attempt | 141 | 528 | | executions | 26,7% | 5% → 35% → 44% |
| Rework token | token attempt fail / tổng | 14,07M | 59,37M | | executions | 23,7% | — |
| Review CHANGES_REQUIRED | | 35 | 270 | | reviews | 13% | — |
| Reviewer miss | QA FAIL có review PASS trước | 7 | 7 | | reviews + QA output | 100% | — |
| Incorrect completion | ACCEPTED dù QA FAIL/BLOCKED | 20 | 117 | | runs + QA output | ≈17% | — |
| Reopened work | re-dispatch sau FAILED | 16 | 32 | | runs | 50% | — |
| Can thiệp / task | | — | — | | (chưa có ledger) | UNKNOWN (≥1 dispatch/run + 16 re-dispatch) | — |
| Autonomous completion | task xong không cần người | — | — | | | UNKNOWN | — |
| Recovery success | timeout → phục hồi | 0 (fec7b) | 1 chuỗi | | telemetry | Đúng cơ chế, kết quả FAILED | — |
| Lesson injection | plan có lesson | 0 | 341 | | runs/*.plan.json | 0% | — |
| Cross-agent reuse | | — | — | | | 0 quan sát | — |
| Skill reuse thật (tool chạy) | | 0 | — | | executions | 0 | — |
| Failure-to-learning time | | — | — | | | không có học | — |
| Token / task được chấp nhận | | 59,37M | 357 | | | ≈166k | 103k → 157k → 225k |
| Cost / task | | — | — | | | UNKNOWN (subscription) | — |
| Utilization / idle / parallel efficiency | | — | — | | | UNKNOWN | — |

Khi không đo được lịch sử: dùng kế hoạch instrumentation ở `05` §7 + EvoBench dưới đây.

## 6. Thí nghiệm scaling có kiểm soát (thiết kế, chưa chạy)

- Cùng 12 task cố định (6 BE, 4 FE, 2 devops) trên repo fixture có SHA.
- Cấu hình concurrency 1 / 2 / 4 / 8 × 2 profile; mỗi cấu hình lặp 3 lần.
- Đo: wall-clock tới accepted, accepted throughput, tỷ lệ conflict, queue/review wait, token/task được chấp nhận, provider wait.
- Tiêu chí: tăng concurrency là "có ích" khi accepted throughput tăng ≥1,5× mỗi lần nhân đôi và tỷ lệ conflict <5%.

## 7. CSWAI-EvoBench v1 — benchmark tiến hóa tái lập (thiết kế, chưa chạy)

Fixture: repo cố định (Node + Kotlin nhỏ) có SHA; brief + AC cố định; gate cố định; ngân sách token/thời gian cố định; model cố định; mỗi version chạy 3 lần; ghi `companyVersion`.

| Nhóm | Task mẫu | Điều kiện chấp nhận |
|---|---|---|
| Requirements | Brief mơ hồ → REQ/AC | Bao phủ 10 AC chuẩn, 0 AC bịa |
| Planning & delegation | Feature 3 tầng | DAG hợp lệ, ≤N task, đúng vai |
| Engineering | 4 task BE/FE có test ẩn | Gate + test ẩn PASS |
| Independent review | 5 diff cài sẵn lỗi | Tỷ lệ phát hiện |
| QA & defect detection | 3 build có lỗi spec (mode file, mutant, byte-identity) | QA FAIL đúng; run **không** ACCEPTED |
| Skill selection | 6 brief có/không có tín hiệu | Precision/recall |
| Cross-agent knowledge reuse | Lỗi X ở run 1 → biến thể ở run 2 | Run 2 không lặp lỗi |
| Failure recovery | Kill giữa chừng, timeout, conflict | Resume đúng, 0 việc trùng |
| End-to-end coordination | Feature nhỏ brief → release-ready | Trạng thái cuối đúng |

Metric: thời gian tới accepted, first-pass, số vòng rework, số can thiệp, token/chi phí, điểm chất lượng/hoàn chỉnh, tỷ lệ lỗi lặp. **341 run lịch sử không phải thí nghiệm có đối chứng** và không được dùng thay EvoBench.
