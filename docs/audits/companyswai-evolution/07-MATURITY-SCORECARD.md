# 07 — Maturity Scorecard & Audit Coverage

Thang: **L0** Ad hoc · **L1** Structured · **L2** Managed · **L3** Reusable · **L4** Autonomous & Measured · **L5** Adaptive. "Ban đầu" = V0 (`5de6671`, 2026-10-07). Không có năng lực nào đạt L3+ vì không có tri thức tái sử dụng *được dùng thật*. Không gộp thành một điểm tổng để tránh che điểm yếu.

## 1. Ma trận 18 năng lực

| # | Năng lực | Ban đầu | Hiện tại | Mục tiêu 90 ngày | Bằng chứng chính | Confidence | Gap |
|---|---|---|---|---|---|---|---|
| 1 | Chiến lược & mục tiêu | L0 | L0–L1 | L2 | README/POLICY; không có cơ chế mục tiêu sản phẩm | Trung bình | Không KPI/goal |
| 2 | Cấu trúc tổ chức | L1 (giấy) | L2 thiết kế / **L1 thực tế** | L2 | Manifest 11 vai cưỡng chế (`src/md-agent-loader.ts:26`); 340/341 run đi vòng planner | Cao | Roster bị bỏ qua |
| 3 | Quản lý & quản trị | L0 | L1 | L2 | Approval CLI không xác thực (`src/approve-cli.ts:8`); operator quản lý thay | Cao | Thẩm quyền mờ |
| 4 | Workload & nguồn lực | L0 | L1–L2 | L3 | DAG, semaphore, capacity (IMPL+TEST); thực tế 1 profile, song song ≤4 | Trung bình | Không đa profile |
| 5 | Trí tuệ agent | L0 | L1 | L2 | `--tools ""`; 349/354 maker "không chạy được" | Cao | Không tool, không repo |
| 6 | Orchestration & phối hợp | L0 | **L2** | L3 | Crash-safe, gate, review/QA loop (IMPL+TEST+OBS) | Cao | Phân rã thô, không reassignment |
| 7 | Model/skill/tool | L0 | L1–L2 | L3 | Rule-based skill + `skillTrace` (OBS); `android` chọn sai 111 lần; 1 model | Cao | Không đo outcome |
| 8 | Bộ nhớ tổ chức | L0 | L1 | L3 | 0/341 plan có lesson; 376 blocker OPEN | Cao | Lưu ≠ dùng |
| 9 | Requirements & product | L0 | L1 | L2 | Validator REQ/AC (IMPL); requirement thực tế từ pack operator | Thấp | Owner requirement nằm ngoài |
| 10 | Quy trình engineering | L0 | **L2** | L3 | 447 gate run; 42/66 task cứu bằng repair; 23,7% token rework | Cao | Maker mù |
| 11 | Chất lượng & hoàn chỉnh | L0 | L1 | L2 | 20 QA FAIL/BLOCKED → ACCEPTED; không feature/release state | Cao | QA không có hiệu lực |
| 12 | Release & bảo trì | L0 | **L0** | L1 | Không có (`src/run-store.ts:14`) | Cao | Thiếu hoàn toàn |
| 13 | Kiểm chứng độc lập | L0 | L2 (gate) / L1 (LLM review) | L3 | Reviewer cùng model; 7/7 bỏ sót | Cao | Đa dạng verifier |
| 14 | An ninh & an toàn | L0 | L2 | L3 | Agent không tool, patch confinement, redaction (IMPL); approval, lock, sandbox gate yếu | Cao | Governance |
| 15 | Tốc độ, chi phí, năng lực | L0 | L1 | L2 | Token thật; tiền UNKNOWN; không có metric throughput tổ chức | Trung bình | Thiếu metric |
| 16 | Quan sát & trách nhiệm | L0 | L2 | L3 | Telemetry + execution log từ sự kiện thật; không dashboard, không first-pass metric | Cao | Tổng hợp |
| 17 | Học từ lỗi & cải tiến | L0 | L1 | L3 | Lesson khuôn mẫu; lesson 42 quan sát REJECTED; không phát hiện lặp | Cao | Toàn bộ vòng học |
| 18 | Thích ứng & chống chịu | L0 | L2 | L3 | Crash resume (TEST), failover timeout (OBS); re-dispatch thủ công; review exhaustion vĩnh viễn | Trung bình | Phục hồi ngõ cụt |

## 2. Phân loại bằng chứng (phụ lục bắt buộc #8)

| # | Năng lực | Nguồn đã xem | Phủ lịch sử | Bằng chứng implementation | Bằng chứng thực thi | Phân loại | Confidence | Câu hỏi còn mở |
|---|---|---|---|---|---|---|---|---|
| 1 | Chiến lược | README, docs, CLAUDE.md | Toàn bộ | Không | Không | NOT IMPLEMENTED | Trung bình | Mục tiêu có nằm ngoài repo? |
| 2 | Cấu trúc | `agents/`, git, runs | Toàn bộ | Có | Plan bị đi vòng | IMPLEMENTED BUT NOT OBSERVED (planner) | Cao | — |
| 3 | Quản trị | CLI, CLAUDE.md, approvals | HEAD | Có | Một phần | OBSERVED BUT EFFECTIVENESS UNKNOWN | Trung bình | Ai thực sự phê duyệt? |
| 4 | Workload | scheduler, runs | HEAD | Có | Có | OBSERVED BUT EFFECTIVENESS UNKNOWN | Trung bình | Concurrency lúc chạy |
| 5 | Agent | executions | 10-08 → 10-14 | Có | Có | OBSERVED (hiệu quả hạn chế) | Cao | Prompt thực tế không được lưu |
| 6 | Orchestration | src, test, telemetry | Toàn bộ | Có | Có | **OBSERVED AND EFFECTIVE** (resume/gate/loop) | Cao | Race integration chưa quan sát |
| 7 | Skill/model | skillTrace, config | 10-11 → 10-14 | Có | Có (tiêm) | OBSERVED BUT EFFECTIVENESS UNKNOWN | Cao | Skill có giúp gì? |
| 8 | Bộ nhớ | experience, plans | HEAD | Có | Tiêm = 0 | IMPLEMENTED BUT NOT OBSERVED | Cao | — |
| 9 | Requirements | validators, runs | HEAD | Có | Ít | OBSERVED BUT EFFECTIVENESS UNKNOWN | Thấp | Requirement do operator soạn |
| 10 | Engineering | gates, executions | 10-11 → 10-14 | Có | Có | **OBSERVED AND EFFECTIVE** (chặn 141 attempt lỗi trước integrate) | Cao | Lỗi lọt qua gate: UNKNOWN |
| 11 | Chất lượng | final-status, QA output | 10-11 → 10-14 | Có | Có, mâu thuẫn | OBSERVED (mâu thuẫn) | Cao | QA FAIL đúng hay sai? (cần code dự án) |
| 12 | Release | — | Toàn bộ | Không | Không | NOT IMPLEMENTED | Cao | — |
| 13 | Kiểm chứng độc lập | reviews, QA | 10-11 → 10-13 | Có | Có | OBSERVED, hiệu quả một phần | Trung bình | Tỷ lệ bỏ sót thật cần benchmark |
| 14 | An ninh | src | HEAD | Có | Một phần | IMPLEMENTED, quan sát một phần | Trung bình | MCP cấp user có gắn được vào agent? |
| 15 | Tốc độ/chi phí | token, timestamp | 10-08 → 10-14 | Có (token) | Có | OBSERVED; tiền INSUFFICIENT EVIDENCE | Trung bình | Giá subscription |
| 16 | Quan sát | telemetry | 10-08 → 10-14 | Có | Có | OBSERVED | Cao | Không dashboard |
| 17 | Học từ lỗi | experience, retro | 10-11 → 10-14 | Có | Có, không tác dụng | OBSERVED, KHÔNG EFFECTIVE | Cao | — |
| 18 | Chống chịu | telemetry, test | HEAD | Có | Timeout (OBS), còn lại TEST | OBSERVED một phần | Trung bình | Hết quota thật chưa xảy ra |

## 3. Audit coverage matrix

| Vùng | Mức đánh giá | Ghi chú |
|---|---|---|
| Lịch sử Git (135 + 1 commit) | **Đầy đủ** | log, show, blame, numstat |
| Thiết kế tổ chức (agents/company/skills/docs) | **Đầy đủ** | |
| Orchestration & governance trong code | **Đầy đủ** (đọc code; không chạy test) | Không chạy test theo ràng buộc read-only |
| Gate, review, QA verdict, skill trace, tiêm lesson | **Đầy đủ** trên hồ sơ có sẵn | |
| Tốc độ | Một phần | Không đối chứng, không có thời điểm intake |
| Chi phí | Một phần | Không có giá tiền |
| Chống chịu | Một phần | Chủ yếu dựa trên test, ít quan sát |
| Can thiệp người/operator | **Cần thêm bằng chứng** | Không được ghi |
| Prompt thực tế | **Cần thêm bằng chứng** | Không được lưu |
| Tính đúng của QA FAIL | **Cần thêm bằng chứng** | Cần code dự án (ngoài phạm vi) |
| Hiệu quả skill | **Cần thêm bằng chứng** | Không có outcome tracking |
| Scaling | **Cần thêm bằng chứng** | Cần thí nghiệm |
| Xu hướng có kiểm soát | **Cần thêm bằng chứng** | Cần EvoBench |

Báo cáo này **không tự nhận đầy đủ** chỉ vì đã trả lời mọi mục.
