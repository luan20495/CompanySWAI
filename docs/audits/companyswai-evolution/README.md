# CompanySWAI — Kiểm toán tổ chức & tiến hóa (Organizational Evolution Audit)

| Thuộc tính | Giá trị |
|---|---|
| Ngày audit | 2026-10-14 |
| Đối tượng | CompanySWAI **only** (`https://github.com/luan20495/CompanySWAI`) |
| **Audit baseline SHA** | `3ecdab1361b86e3604f6822301d29ad3b78a625d` (HEAD của `main`, 2026-10-11 17:50 +0700) |
| Commit đầu tiên | `56e1971` (2026-10-07, "bootstrap: add README.md") |
| Lịch sử được xem | 135 commit trên `main` + nhánh chưa merge `feature/git-branch-lifecycle` (`a7e53f4`, 2026-10-14) |
| Hồ sơ vận hành | Thư mục runtime `.companyswai/` (bị gitignore — **không có trên GitHub**), snapshot tại 2026-10-14 |
| Chế độ audit | STRICT READ-ONLY (không sửa code/config/agent/skill; không chạy test hay script của repo) |
| Ngôn ngữ | Tiếng Việt |
| Người thực hiện | Claude Code (Opus 5.5) theo yêu cầu của owner, có 3 sub-agent đọc code/lịch sử song song |

## Kết luận một dòng

**IMPROVING ở tầng execution engine; FLAT ở tầng tổ chức; INSUFFICIENT EVIDENCE về tự cải tiến.** CompanySWAI hiện là một *framework thực thi đa agent có kỷ luật* (gate xác định, crash-safe, review/QA loop), chưa phải một *công ty phần mềm tự quản và tự học*: 340/341 run thật nhận plan dựng sẵn từ operator bên ngoài, 0/341 plan được tiêm bài học, QA FAIL/BLOCKED vẫn kết thúc `ACCEPTED`.

## Mục lục

| File | Nội dung |
|---|---|
| [00-EXECUTIVE-SUMMARY.md](00-EXECUTIVE-SUMMARY.md) | Phán quyết, điểm mạnh/yếu, quyết định cuối, trả lời 20 câu hỏi |
| [01-HISTORICAL-EVOLUTION.md](01-HISTORICAL-EVOLUTION.md) | V0 → HEAD, timeline có SHA, churn, docs drift, benchmark claims |
| [02-ORGANIZATION-AS-IS.md](02-ORGANIZATION-AS-IS.md) | Sơ đồ AS-IS (thiết kế vs thực tế), vai trò, thẩm quyền, coverage chức năng |
| [03-OPERATING-MODEL.md](03-OPERATING-MODEL.md) | Workflow, orchestration, review, QA, integration, DoR/DoD, governance, resilience |
| [04-SKILLS-AND-INTELLIGENCE.md](04-SKILLS-AND-INTELLIGENCE.md) | Skill/tool: cài đặt → khả dụng → được dùng → reuse → hiệu quả; model routing & escalation |
| [05-MEMORY-AND-LEARNING.md](05-MEMORY-AND-LEARNING.md) | Bộ nhớ tổ chức, vòng học, failure families, chính sách 1-2-3 |
| [06-PERFORMANCE-AND-QUALITY.md](06-PERFORMANCE-AND-QUALITY.md) | Tốc độ, token, chi phí, độ chính xác, độ hoàn chỉnh, scaling, local vs global optimization |
| [07-MATURITY-SCORECARD.md](07-MATURITY-SCORECARD.md) | 18 năng lực L0–L5, confidence, audit coverage matrix |
| [08-ORGANIZATIONAL-GAPS.md](08-ORGANIZATIONAL-GAPS.md) | Top 10 vấn đề, gap analysis, mâu thuẫn docs/code/vận hành |
| [09-TARGET-ORGANIZATION.md](09-TARGET-ORGANIZATION.md) | AS-IS vs TO-BE, RACI, target workflow, safe upgrade lifecycle |
| [10-UPGRADE-ROADMAP.md](10-UPGRADE-ROADMAP.md) | P0/P1/P2, 30/60/90, EvoBench, thí nghiệm scaling, metric framework |
| [11-EVIDENCE-INDEX.md](11-EVIDENCE-INDEX.md) | Commit SHA, file:line, record runtime, script tái lập số liệu |

## Nhãn bằng chứng (dùng xuyên suốt)

| Nhãn | Nghĩa |
|---|---|
| **DOCUMENTED** | Chỉ được mô tả (docs/Markdown/prompt) |
| **IMPLEMENTED** | Có trong code/config vận hành (dẫn `file:line`) |
| **OBSERVED** | Có dấu vết thực thi trong `.companyswai/` |
| **REUSED** | Được dùng lặp lại qua nhiều task/agent độc lập |
| **EFFECTIVE** | Có cải thiện đã được kiểm chứng |
| **UNKNOWN** | Không đủ bằng chứng (không đồng nghĩa "không tồn tại") |

Ngoài ra, ở file 07 dùng phân loại bắt buộc: NOT IMPLEMENTED / IMPLEMENTED BUT NOT OBSERVED / OBSERVED BUT EFFECTIVENESS UNKNOWN / OBSERVED AND EFFECTIVE / INSUFFICIENT EVIDENCE.

## Hướng dẫn đọc (cho người kiểm chứng độc lập, ví dụ ChatGPT)

1. Đọc `00` để nắm phán quyết, rồi `08` để thấy các vấn đề chính kèm bằng chứng.
2. **Kiểm chứng được trực tiếp trên GitHub:** mọi trích dẫn code `src/...:line`, docs, config được gitignore *không* có (ví dụ `config/providers.json`), và mọi commit SHA — đều tại baseline `3ecdab1`.
3. **Không kiểm chứng được trực tiếp trên GitHub:** các số liệu vận hành (341 run, 798 attempt, …) lấy từ `.companyswai/` — thư mục này bị `.gitignore` nên không được publish. File `11-EVIDENCE-INDEX.md` có schema record và script Python để owner tái lập số liệu trên máy local.
4. Các đoạn trích dẫn hồ sơ vận hành đã được **lọc**: repo là PUBLIC, nên không đưa snippet mã nguồn, tên file/package nội bộ, lệnh gate, hay đường dẫn máy của dự án được thực thi (HBLXWeb). Chỉ giữ ID run (ví dụ `hblxweb-fec7`) và số liệu tổng hợp.

## Phạm vi & giới hạn chính

- Không audit repository nào khác; không đọc mã nguồn của dự án mà CompanySWAI thực thi (HBLXWeb). Chỉ dùng *hồ sơ vận hành của CompanySWAI* khi thực thi các task đó.
- Prompt thực tế gửi cho agent **không được lưu** trong execution record → nhiều câu hỏi về "agent đã thấy gì" là UNKNOWN.
- Chi phí tiền: UNKNOWN (chạy subscription `claude-code`).
- Can thiệp của con người/operator: **không được ghi lại** bởi CompanySWAI.
- Độ khó task không được kiểm soát → mọi "xu hướng" theo ngày là **quan sát, không phải thí nghiệm**.
- Không xác minh được QA FAIL là lỗi thật hay false positive (cần đọc code dự án đích — ngoài phạm vi).
