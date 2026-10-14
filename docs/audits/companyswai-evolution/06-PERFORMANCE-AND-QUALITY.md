# 06 — Performance, Cost, Accuracy & Completeness

Nguồn: `.companyswai/runs/*.json` (341 run), `executions/*/records.jsonl` (798 attempt; mỗi record giữ trạng thái cuối theo `id`), `telemetry/*/events.jsonl`, `reviews/` (270). Thời gian theo UTC. **Không có đối chứng độ khó task** — mọi xu hướng theo ngày là quan sát, không phải thí nghiệm.

## 1. Khối lượng & kết quả

| Chỉ số | Giá trị |
|---|---|
| Run | 341 — `example-commerce` (2026-10-08) + 340 `hblxweb-*` (2026-10-11 → 10-14) |
| Run theo ngày | 10-08: 1 · 10-11: 45 · 10-12: 157 · 10-13: 136 · 10-14: 2 |
| Final status | **ACCEPTED 308**, ACCEPTED_WITH_RISKS 1 (`example-commerce`), **FAILED 32** |
| Phase cuối | DONE 309, EXECUTE 32 |
| `final.qa` | NOT_RUN 340, PASS 1 |
| Số task / run | 1 task: 329 · 2: 6 · 3: 1 · 4: 3 · 6: 1 · 9: 1 |
| Run theo vai (task) | qa-engineer 114, frontend 103, backend 90, devops-sre 34, tech-lead 14, BA 6, product-lead 5, ux-ui 3, researcher 1, reviewer 1 |
| Attempt (lượt gọi model) | 798 = 528 maker/khác + 270 review; trạng thái cuối: SUCCEEDED 656, FAILED 141, STARTED 1 |
| Maker task (project, task) | 383: thành công cuối 357, thất bại hẳn 26 |
| Telemetry | run.started 358, run.finished 357 (done 318 / failed 39), task.finished 390 (DONE 351 / FAILED 39), gate.repair 106, task.blocked 39, provider.waiting 14, provider.failover 3, provider.retry 2 |
| Takeover | 3 (`hblxweb`, `hblxweb-v2`, `hblxweb-v3`) |

## 2. Tốc độ & thông lượng

| Chỉ số | Giá trị |
|---|---|
| Thời gian attempt | trung vị 52s, p90 314s, tổng 26,0h |
| Thời gian run (wall) | trung vị 2,8 phút, p90 14,1 phút, max 280,6 phút |
| Khoảng thời gian / thời gian bận (union) | 61,0h / 27,9h |
| Khoảng chờ giữa các run | 218 khoảng, trung vị 3,2 phút, p90 20,6 phút, tổng 33,1h → nút cổ chai là **dispatch của operator**, không phải số agent |
| Song song tối đa | 4 run chồng nhau (profile hiện tại `maxConcurrency: 1`; giá trị lúc chạy UNKNOWN) |
| Accepted throughput | 309 run được chấp nhận / 27,9h bận ≈ 11 run/h (micro-task) |
| Lead time requirement → delivery | **UNKNOWN** (không có thời điểm intake) |
| Queue / review / QA wait | Không được tổng hợp; `src/metrics.ts` có queue wait, latency theo run nhưng không có lịch sử chéo run |

## 3. Độ chính xác

### 3.1 First-pass theo maker task (attempt 1 qua gate + finalize)

| Ngày | Task | First-pass | Thành công cuối | Attempt/task |
|---|---|---|---|---|
| 10-08 | 9 | 100% | 100% | 1,00 |
| 10-11 | 72 | 99% | 100% | 1,17 |
| 10-12 | 164 | 83% | 96% | 1,34 |
| 10-13 | 136 | 71% | 87% | 1,55 |
| 10-14 | 2 | 50% | 50% | 2,00 |
| **Tổng** | **383** | **81,7% (313)** | **93,2% (357)** | |

Tỷ lệ attempt maker (không tính review/QA) thất bại: 10-11 3/59 (5%) · 10-12 53/153 (35%) · 10-13 82/187 (44%) · 10-14 3/4.

### 3.2 Theo vai

| Vai | Task | First-pass | Cuối |
|---|---|---|---|
| frontend-engineer | 103 | 69% | 92% |
| backend-engineer | 90 | 71% | 84% |
| devops-sre | 34 | 65% | 88% |
| qa-engineer | 117 | 100% | 100% |
| tech-lead | 17 | 100% | 100% |
| BA / PL / UX / researcher / reviewer | 9 / 8 / 3 / 1 / 1 | 100% | 100% |

Vai không viết code đạt 100% vì **không có gate khách quan** — không chứng minh chất lượng.

### 3.3 Gate & repair

- Gate (447 lần): unit-tests 203 PASS / 102 FAIL · backend 25 / 31 · typecheck 77 / 3 · migration-ledger 4 PASS · guards 1 · mirror-guard 1.
- Repair khi attempt đầu fail gate (66 task): thành công sau 2 attempt 24, sau 3 attempt 11, sau 4 attempt 5, sau 5 attempt 2 (**42 cứu được**); thất bại sau 3 attempt **24**. Lỗi khác gate: 3 task (1 thành công).
- Chỉ 1 task có đổi model giữa các attempt trong cùng run (`core03a1`: alias `sonnet` → tên phân giải `claude-sonnet-5-5`, không phải escalation thật).

### 3.4 Review

- 270 verdict: **PASS 235 / CHANGES_REQUIRED 35 (13%)**.
- Vòng review / task: 1 vòng 205, 2 vòng 22, 3 vòng 7 (234 task được review) → 87,6% qua ở vòng 1.
- Mọi review attempt SUCCEEDED (không có review exhaustion quan sát được).

### 3.5 QA

- 117 QA task. Verdict đọc từ output (regex "QA Status/Verdict"): **PASS 91, BLOCKED 13, FAIL 7**, không rõ 6 (trong đó `hblxweb-v2` có dấu hiệu FAIL nhưng không chắc — không tính).
- QA FAIL/BLOCKED: `ai2b1-qa`, `core02-qa`, `core13a1-qa` (FAIL), `core13a4-qa1`, `cored2a-qa` (FAIL), `ia1-qa`, `ia2a-qa`, `iss001`, `iss011-qa` (FAIL), `iss017-qa`, `p101-qa`, `p105a-qa` (FAIL), `p106c-qa`, `p106c-qa2`, `p108c-qa`, `rest3e1-qa`, `rest3e2-qa` (FAIL), `ux2u2b-qa` (FAIL), `v2` (?FAIL), `w112-qa` (FAIL), `w116-qa`.
- **Tất cả run QA này kết thúc `ACCEPTED`** (`final.qa = {status: NOT_RUN, required: false}`, plan `maxQAReworkRounds: 0`) → **20 trường hợp completion sai**.

## 4. Reviewer bỏ sót (phụ lục bắt buộc #3)

| QA run FAIL | Run maker tương ứng | Review cuối của maker | Lý do QA FAIL (đã lọc chi tiết nội bộ) |
|---|---|---|---|
| `hblxweb-w112-qa` | `hblxweb-w112` | PASS (10-11 17:27Z) | Diff thay đổi một dòng mà spec yêu cầu giữ nguyên; 1 AC BLOCKED vì thiếu bằng chứng chạy lặp |
| `hblxweb-p105a-qa` | `hblxweb-p105a` | PASS (10-12 11:43Z) | File entry-point commit với mode 0644 thay vì 0755 theo AC |
| `hblxweb-ux2u2b-qa` | `hblxweb-ux2u2b` | PASS (10-13 05:46Z) | Mutant bắt buộc phải "đỏ" theo AC lại sống sót |
| `hblxweb-core13a1-qa` | `hblxweb-core13a1` | PASS (10-12 08:47Z) | (chưa phân tích chi tiết) |
| `hblxweb-cored2a-qa` | `hblxweb-cored2a` | PASS (10-12 07:15Z) | (chưa phân tích chi tiết) |
| `hblxweb-iss011-qa` | `hblxweb-iss011` | PASS (10-12 01:27Z) | (chưa phân tích chi tiết) |
| `hblxweb-rest3e2-qa` | `hblxweb-rest3e2` | PASS (10-12 21:42Z) | (chưa phân tích chi tiết) |

7/7 = reviewer PASS + gate PASS trước khi QA FAIL. Giới hạn: không xác minh QA đúng hay sai (cần code dự án — ngoài phạm vi). Một số bằng chứng QA dùng đến từ "operator mutation check" — tức là đến từ ngoài CompanySWAI.

## 5. Token & chi phí

| Chỉ số | Giá trị |
|---|---|
| Tổng token | **59.366.641** (input 44.737.270 / output 14.629.371) |
| Maker vs review | 42.621.187 vs 16.745.454 (review **28%**) |
| Token trên attempt FAILED (rework lãng phí) | **14.071.612 = 23,7%** |
| Billing | subscription 775 attempt, metered 23 |
| Token / run được chấp nhận | ≈192k (59,4M / 309) |
| Token / maker task thành công | ≈166k (59,4M / 357) |
| Token / maker task thành công theo ngày | 10-11: 103k · 10-12: 157k · 10-13: 225k (tăng 2,2×) |
| Prompt mỗi task (ký tự) | trung vị 88.497, p90 163.193, max 374.491 |
| Chi phí tiền | **UNKNOWN** — subscription; mọi kiểm tra budget bị bỏ qua cho subscription (`src/orchestrator.ts:223`); ước lượng dùng con số token cố định (`src/estimate.ts`) |
| Chi phí của escalation Opus | UNKNOWN (attempt timeout không ghi token) |

## 6. Độ hoàn chỉnh giao hàng

| Tiêu chí DONE | Trạng thái tổ chức |
|---|---|
| Business requirement / functional | AC traceability (QA) — IMPL; requirement chủ yếu đến từ pack operator |
| UX/UI consistency, accessibility | Skill (prompt) — không gate |
| Performance, reliability, concurrency | Skill (prompt); chỉ khi brief cấu hình gate |
| Security | Lens HIGH_RISK + gate nếu cấu hình |
| Data integrity / migration | Skill migration-review; gate `migration-ledger` quan sát 4 lần PASS |
| Error handling / recovery | Không có tiêu chí tổ chức |
| Integration | Gate trên merged tree — OBS |
| Testing | Gate xác định — OBS |
| Documentation | Output contract 5 section — IMPL |
| Deployment readiness / observability / rollback / maintenance | **Không có** |
| User acceptance | **Không có** chữ ký người |
| Reopened work / post-delivery defect | Không có trạng thái; re-dispatch thủ công tạo run mới (16 lần) |

CompanySWAI phân biệt được CODE COMPLETE và TASK ACCEPTED; **không** phân biệt FEATURE COMPLETE và PRODUCT RELEASE READY.

## 7. Scaling (phụ lục bắt buộc #4)

| Khía cạnh | Bằng chứng | Kết luận |
|---|---|---|
| Số agent vs throughput | Song song tối đa 4; không có cấu hình đối chứng | INSUFFICIENT EVIDENCE |
| Overhead điều phối | 218 khoảng chờ dispatch, tổng 33,1h / 61h | Nút cổ chai ở operator |
| Bottleneck review | Review = 28% token; 87,6% qua vòng 1 | Không phải nút thắt chính; nhưng bỏ sót |
| Tranh chấp tài nguyên | Profile `maxConcurrency: 1`; 14 `provider.waiting` | Thấp trong dữ liệu |
| Integration conflict | 2 | Thấp (song song thấp) |
| Duplicate work | Không quan sát; không có lock liên process | Rủi ro tiềm ẩn |
| Context transfer | Prompt trung vị 88k ký tự | **Cao** |
| Idle time của agent | UNKNOWN | — |
| Chi phí biên mỗi agent | UNKNOWN | — |

Thí nghiệm đề xuất: xem `10-UPGRADE-ROADMAP.md` §6.

## 8. Tối ưu cục bộ vs toàn công ty (phụ lục bắt buộc #6)

| Hiện tượng | Metric cục bộ đẹp | Tác động toàn cục |
|---|---|---|
| Reviewer PASS nhanh | 87,6% qua vòng 1 | Lỗi spec lọt xuống QA (7/7) |
| Vai không viết code | 100% first-pass | Vô nghĩa — không có gate |
| Skill tiêm nhiều (verification, android) | "Skill coverage" cao | Thêm context, không có tác dụng |
| Pack lớn do operator | Giảm độ mù của maker | Token/task tăng; tri thức nằm ngoài công ty |
| Chia micro-run | 90% run ACCEPTED | Che giấu trạng thái feature; QA FAIL vẫn ACCEPTED |
| Gate repair | Cứu 42 task | 23,7% token là rework |

Metric toàn công ty đề xuất: **accepted-and-QA-verified feature / tuần**, **token / feature được chấp nhận**, **defect escape rate** (lỗi phát hiện sau review PASS), **can thiệp / feature**, **tỷ lệ tái phát lỗi lặp**. Metric cục bộ (first-pass theo vai) chỉ dùng để chẩn đoán, không làm mục tiêu.
