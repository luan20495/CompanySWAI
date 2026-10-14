# 09 — Target Organization (AS-IS vs TO-BE, RACI, Target Workflow)

> Đây là **đề xuất thiết kế**, không phải kết quả kiểm chứng. Mọi đề xuất bắt nguồn từ các gap có bằng chứng ở `08-ORGANIZATIONAL-GAPS.md`. Không triển khai trong audit.

Nguyên tắc: **không thêm agent**; hợp nhất vai, và đưa phần "quản lý" operator đang làm thủ công vào trong CompanySWAI dưới dạng **code xác định**.

## 1. AS-IS (đã kiểm chứng)

```
Human Owner
   └─ Operator Claude Code bên ngoài (phân rã, pack, gate, re-dispatch, đổi model)
        └─ CompanySWAI engine (1 task/run) → maker (không tool) → gate → reviewer (cùng model) → QA (không chặn)
```

## 2. TO-BE

```
Human Owner (mục tiêu, approval rủi ro cao, chấp nhận cuối)
 └─ Delivery Controller (CODE, không phải LLM): intake, phân rã wave→task, dispatch, escalation, metrics
      ├─ Planner agent (gộp product-lead + BA + tech-lead cho brownfield/task nhỏ): spec + AC + task graph cỡ nhỏ
      ├─ Maker pool (BE/FE/mobile/devops) — có sandbox: đọc repo + chạy gate trước khi nộp
      ├─ Verifier pool: reviewer (model khác hoặc lens adversarial) + QA (verdict có quyền veto)
      ├─ Release steward (chức năng, gộp vào devops-sre): release-ready checklist, rollback
      └─ Learning service (CODE): failure registry, phát hiện lặp, đề xuất rule, đo hiệu quả
```

| Chức năng | Trách nhiệm | Thẩm quyền | Vai agent | Input | Output | Gate | Escalation | Tự chủ |
|---|---|---|---|---|---|---|---|---|
| Delivery Controller | Intake → phân rã → dispatch → theo dõi → escalate | Giao task, chọn model theo policy, retry | Code | Goal/feature, policy | Task graph, dispatch ledger, metrics | Plan validation | Owner khi vượt ngân sách/rủi ro | **Tự động** |
| Planner | Spec, AC, task graph | Đề xuất scope | Gộp PL+BA+TL (tách khi dự án mới phức tạp) | Goal, repo snapshot | Spec + AC + graph | Validator REQ/AC + architecture lens | Owner duyệt scope | Tự động + **người duyệt scope** |
| Maker pool | Thực hiện task | Sửa code trong worktree | BE/FE/mobile/devops | Task + repo (read-only) + gate | Patch + evidence đã chạy | Gate fail-closed trong sandbox | Controller (escalate model) | Tự động |
| Verifier pool | Review + QA | **Veto** (chặn ACCEPTED) | reviewer, qa-engineer (shared service) | Patch, spec, gate output | Verdict + finding có owner | Spec-conformance checklist | Controller → rework; Owner khi hết vòng | Tự động |
| Release steward | Release-ready, rollback | Đề xuất release | devops-sre | Feature accepted | Checklist, rollback plan | Release gate | Owner | **Người duyệt** |
| Learning service | Failure registry, lặp, rule | Đề xuất rule | Code | Execution log, verdict | Rule candidate + bằng chứng | Benchmark A/B | Owner duyệt rule cấp công ty | Tự động đề xuất, **người duyệt** |

Tách / Gộp / Shared / Tự động / Người duyệt:
- **Gộp:** PL + BA + TL thành Planner cho task nhỏ; 11 IDENTITY boilerplate thành 1 template.
- **Shared service:** Verifier pool dùng chung cho mọi project.
- **Tự động:** Controller, Learning service (code xác định).
- **Người duyệt:** scope, release, rule cấp công ty, hành động tốn tiền/phá hủy/production.
- **Đa dự án:** Controller lập lịch nhiều project trên cùng pool; không tạo hierarchy quản lý mới cho từng project.

## 3. RACI

R = thực hiện · A = chịu trách nhiệm cuối · C = tham vấn · I = được thông báo

| Quyết định | Owner | Controller | Planner | Maker | Verifier | Learning |
|---|---|---|---|---|---|---|
| Chấp nhận requirement/scope | **A** | I | R | I | C | — |
| Duyệt design/architecture | I | I | R | C | **A** | — |
| Phân rã & giao task | I | **A/R** | C | I | — | C |
| Chọn model/skill/tool | I | **A/R** (theo policy) | — | C | — | C |
| Từ chối việc / yêu cầu rework | I | R | — | I | **A** | I |
| Escalate model/task | I | **A/R** | — | I | C | C |
| Task accepted | I | R | — | — | **A** | I |
| Feature complete | C | R | C | — | **A** | I |
| Release ready | **A** | R | C | — | R | I |
| Đổi quy trình/policy | **A** | C | — | — | C | **R** |
| Hành động rủi ro cao/tốn tiền | **A** | R | — | — | — | — |
| Giải quyết bất đồng maker–verifier | I (khi hết vòng: **A**) | **A/R** | C | C | C | I |

## 4. Target Operating Workflow

| Giai đoạn | Trigger | Vai | Input | Hoạt động | Skill/tool | Output contract | Gate chấp nhận | Phục hồi lỗi | Escalation | Telemetry | Ghi tri thức |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. Intake | Owner tạo goal | Controller | Goal, ràng buộc | Chuẩn hóa, gán risk | — | Goal record | Đủ trường | Trả lại owner | Owner | intake_at | — |
| 2. Planning | Goal hợp lệ | Planner | Goal, repo snapshot, lessons | Spec + AC + graph | knowledge-matrix, requirements | Spec, AC, graph | Validator + **owner duyệt scope** | Repair ≤2 | Owner | plan tokens | Decision record |
| 3. Engineering | Task ready | Maker | Task, repo RO, gate | Code + chạy gate trong sandbox | skill theo stack | Patch + evidence executed | Gate PASS | Repair ≤2 → escalate model | Controller | attempts, first-pass | Failure signature |
| 4. Review | Gate PASS | Verifier (reviewer) | Patch, spec, gate output, checklist lỗi trước | Review spec-conformance | code-review, security | Verdict + findings | PASS ở mọi slot | Rework ≤N vòng | Owner khi hết vòng | review rounds | Miss → registry |
| 5. Integration | Review PASS | Controller | Commit | Cherry-pick dưới lock + gate merged tree | — | Integrated SHA | Gate merged PASS | Revert tự động | Controller | conflicts | — |
| 6. QA | Feature đủ task | Verifier (QA) | AC, evidence | Traceability, mutation/e2e khi có tool | e2e, fuzz | QA verdict | **PASS bắt buộc** | QA rework → owner task | Owner khi hết vòng | QA fail rate | Defect → registry |
| 7. Release | Feature accepted | Release steward | Feature, checklist | Release-ready, rollback plan | devops | Release record | **Owner duyệt** | Rollback | Owner | release lead time | — |
| 8. Ops/Maintenance | Sự cố/bảo trì | Controller | Incident | Tạo goal sửa | — | Incident record | — | — | Owner | MTTR | Postmortem (lần 3) |
| 9. Learning | Mỗi run kết thúc (kể cả fail) | Learning service | Log, verdict | Chữ ký lỗi, đếm lặp, đề xuất rule | — | Rule candidate | Benchmark A/B + **owner duyệt** | Rollback rule | Owner | repeat rate | Rule registry |

- **Song song:** nhiều task Engineering độc lập; Review các task khác nhau; Learning chạy nền.
- **Incremental:** gate theo phạm vi file thay đổi; review theo diff.
- **Bắt buộc full validation:** trước Integration (gate merged tree), trước Release, và khi risk HIGH.
- **Owner bắt buộc:** scope, release, rule cấp công ty, chi phí vượt ngưỡng, hành động phá hủy/production.
- **Không tối ưu tốc độ bằng cách bỏ quality control thiết yếu.**

## 5. Quy trình nâng cấp tổ chức an toàn (phụ lục bắt buộc #7)

Proposal → Evidence → Risk Assessment → Approval → Isolated Experiment → Evaluation → Controlled Rollout → Monitoring → Institutionalization **hoặc** Rollback.

| Giai đoạn | Hỗ trợ hiện có trong CompanySWAI | Khoảng trống |
|---|---|---|
| Proposal | Con người; lesson CANDIDATE | Không có đề xuất thay đổi policy/quy trình (`company/LEARNING.md` cấm) |
| Evidence | Log + telemetry thật | Không có báo cáo tổng hợp, không có chữ ký lỗi |
| Risk / Approval | `PENDING_APPROVAL`, approve CLI | Không xác thực |
| Isolated experiment | Nhánh/worktree (ví dụ `a7e53f4`), benchmark dry-run (`src/benchmark.ts`) | Không có benchmark live chuẩn hóa |
| Evaluation | `docs/BENCHMARK-RESULTS.md` (thủ công) | Không so sánh tự động với baseline |
| Rollout / Rollback | Git | Run không ghi version policy/agent đã dùng (chỉ `planHash`) |
| Monitoring / Institutionalization | — | Thiếu |

**Kết luận:** lifecycle được hỗ trợ **một phần**, chỉ do người vận hành. Điều kiện tối thiểu để an toàn: ghi `companyVersion` (hash `company/`, `agents/`, `skills/`) vào mỗi run; feature flag cho policy; A/B trên EvoBench; giữ nguyên state đang chạy (không đổi plan đã đóng băng giữa chừng); mọi thay đổi có approval truy vết được.
