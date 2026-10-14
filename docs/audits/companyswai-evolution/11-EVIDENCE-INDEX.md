# 11 — Evidence Index

Baseline `3ecdab1361b86e3604f6822301d29ad3b78a625d`. Code/docs/SHA kiểm chứng được trên GitHub. Hồ sơ `.companyswai/` **bị gitignore** (`.gitignore`) → chỉ tái lập được trên máy owner bằng script ở §6.

## 1. Commit SHA

| Nhóm | SHA |
|---|---|
| Commit đầu / V0 | `56e1971` (README), `062cb6b` (departments.json), `d00594d` (company.ts), `c5d6137` (contracts.ts), `e433daa` (ELASTIC-ORGANIZATION.md), `5de6671` (kết thúc bootstrap) |
| Mobile + composition | `81ad0e4`, `05e0870` |
| Scheduler (bỏ) | `833d3e5` → xóa ở `b41eec3` |
| Runtime đầu tiên | `03bbd2d`, `6691bb4`, `6791311`, `8c74f16`, `668a431`, `f2e5a1a`, `208d25c` |
| Roster 11 agent | `0ebf151`, `1b4c3a6`, `8417089`, `60d87c5`, `7b64dbf` |
| Burst fix era 1 | `48edf07`, `00175b6`, `78ba401`, `0244fed`, `dddc554` (escaped newline); `e23b576`, `f952794`, `204f866`, `b09bec6`, `d4503b4`, `f73294b`, `d31c5df`, `a6f2114`, `153a9fa` (schema/type) |
| Era 2 tái kiến trúc | `b41eec3`, `9053f68`, `77252d9`, `c3f125d`, `201a4ab`, `a5a6089`, `b0712dd`, `c73e096` |
| Provider claude-code | `6747d48` |
| Skills/policy/worktree/learning/autonomous | `cb1b52d`, `c5d4f69`, `c55face`, `1279623`, `c4f691f`, `ac8716c`, `3a8a14d`, `2e546a4`, `047a02d` |
| Fix từ live run | `a271aa3`, `bfe6395`, `135e39e` (artifact bị cắt ×3), `5516b90`, `ab3ad79`, `fa3cdae`, `92b1ff9`, `c365bf1`, `924282a`, `f1bfedc` |
| Benchmark docs | `0a86a41`, `1d247d7`, `e1fa010`, `3a7ed56` |
| Operator | `557a9b9` |
| Skill layer | `ff22c19` |
| Takeover | `5312319`, `1a6cd24`, `3ecdab1` |
| Nhánh chưa merge | `a7e53f4` (`feature/git-branch-lifecycle`, PR #7) |

## 2. Code (file:line tại baseline)

| Chủ đề | Vị trí |
|---|---|
| Brief vs plan, hash, lesson loading | `src/autonomous.ts:49,61-68,141,161-170` |
| Tiêm lesson | `src/plan-compiler.ts:12-20,44,48,49`; token cố định `:46` |
| Planner 1 task/vai, risk theo project | `src/work-planner.ts:23,41,44-58,64-111` |
| Completion, review loop, QA loop, retry | `src/orchestrator.ts:76,79-86,94-118,108-114,138,223,249-262,280,285-293,308-321,346-374,409-445,452,463,494-509` |
| Integrate trước review; blocker | `src/runner.ts:38,42-58,59-91,126-135,150-153,166-170,180-185,203-209` |
| Agent không tool | `src/providers/claude-code.ts:16,22,34-46,59-62,72-78,93,112-132` |
| Context agent | `src/context.ts:45-54,62-86` |
| Final status | `src/final-status.ts:11-38` (bug `:35-36`) |
| Status enums | `src/run-store.ts:10,14`; `src/execution-record.ts:7`; `src/checkpoint-store.ts:7`; `src/operator.ts:28,131,196` |
| Learning filter/promotion | `src/company-experience.ts:24-27,36-54,94-98,105-109,116-124` |
| Retrospective templates | `src/retrospective.ts:36-45,55-84` |
| Skill selection/registry | `src/skill-selector.ts:66-103`; `src/skill-registry.ts:12-19,34-74,85-91,98-112` |
| Routing | `src/capacity.ts:32-91`; `src/provider-selector.ts:33-41,51-56,69-91` |
| Approval | `src/approve-cli.ts:8`; `src/approval-store.ts:27-29` |
| Workspace/git safety | `src/repo-workspace.ts:16,18,26-30,49-61,75-105,111-166`; `src/worktrees.ts:59-104` |
| Secrets | `src/secrets.ts:4-43` |
| Engine guard | `src/operator-commands.ts:35-53,95-150`; `src/telemetry.ts:42-66` |
| Dead code | `src/company.ts:22` (`reviewDepth`); `src/project-memory.ts:87` (`clearBlocker`) |
| Log O(n²) | `src/execution-store.ts:18,27-40` |
| Status server | `src/status-server.ts:34` |

## 3. Docs / config / test

| Loại | Vị trí |
|---|---|
| Operator contract | `CLAUDE.md:14-22,24-45,53` |
| Policy | `company/POLICY.md:2-6,12-28`; `company/LEARNING.md:19`; `company/WORKFLOW.md:3-12`; `company/GATES.md:24`; `company/MEMORY.md:2` |
| Agents | `agents/AGENTS.md`; `agents/*/IDENTITY.md`, `agents/*/RULES.md` (`agents/qa-engineer/RULES.md:40-41`) |
| Skills | `skills/*.md`, `skills/dynamic/*.md`, `skills/references/**` |
| Skill audit | `docs/SKILLS-AUDIT.md:13,14,102,207,210` |
| Benchmark kết quả | `docs/BENCHMARK-RESULTS.md` |
| Takeover | `docs/TAKEOVER.md:20-22,32-35,40-57,75` |
| Config | `config/providers.json` (gitignored — local: 1 profile `claude-code-team`, `sonnet`, tier 4, `maxConcurrency: 1`); `config/providers.example.json` |
| CI | `.github/workflows/ci.yml:19-22` |
| Test | 36 file, ~317 test; `test/failure-injection.test.ts` (10), `test/qa-rework.test.ts` (7), `test/validators.test.ts` (17), `test/scheduler.test.ts` (12), `test/gates-worktrees.test.ts` (13), `test/routing.test.ts` (11), `test/provider-system.test.ts` (9), `test/company-experience.test.ts` (8, `:80`), `test/planning-learning.test.ts` (10), `test/operator.test.ts` (22), `test/takeover.test.ts` (30), `test/takeover-exec.test.ts` (12), `test/operator-contract.test.ts:10-26` |

## 4. Hồ sơ vận hành `.companyswai/` (local, gitignored)

| Thư mục | Số lượng | Dùng cho |
|---|---|---|
| `runs/*.json`, `runs/*.plan.json` | 341 + 341 | Final status, phase, hash, plan, gate cấu hình, prompt size |
| `executions/*/records.jsonl` | 344 project, 798 attempt (theo `id`) | Model, token, gate, error, evidence, skillTrace, contextRefs, output |
| `telemetry/*/events.jsonl` | 344 | Sự kiện run/task/provider/gate |
| `reviews/*/*.json` | 270 | Verdict reviewer |
| `blockers/` | 376 | Trạng thái blocker |
| `decisions/`, `handoffs/` | 384 / 59 file | Decision/handoff |
| `retrospectives/` | 341 | Lesson khuôn mẫu |
| `company-experience.json` | 10 mục | Lesson store |
| `projects/` | 3.440 file | Project memory MD |
| `takeover/{hblxweb,hblxweb-v2,hblxweb-v3}` | 25 file | Takeover |
| `worktrees/` | 219 thư mục rỗng | Worktree đã dọn (còn thư mục rỗng) |

Schema record execution (khóa): `id, projectId, taskId, agentRole, department, provider, model, status, startedAt, finishedAt, inputRefs, output, artifactRefs, decisionRefs, reviewRefs, blockerRefs, inputTokens, outputTokens, billing, profileId, baseSha, contextRefs, skillTrace, gates, changedFiles, evidence, error`.

## 5. Run / execution tiêu biểu

| ID | Bằng chứng cho |
|---|---|
| `hblxweb-ab1a` | Maker tự khai "Nothing was run (NOT RUN): I have no shell"; plan có `autoCommit: true`, `isolation: worktree` |
| `hblxweb-fec7` → `fec7b` → `fec7c` → `fec7d` | Gate fail ×3 (Sonnet) → Opus timeout 600s ×3 → fail → accepted; failover/cooldown/retry trong telemetry |
| `hblxweb-w112-qa`, `hblxweb-p105a-qa`, `hblxweb-ux2u2b-qa` | QA FAIL → run ACCEPTED; reviewer PASS trước đó |
| `hblxweb-mx2` | Lesson VALIDATED khớp scope nhưng không được tiêm (plan đưa thẳng) |
| `example-commerce` | Run duy nhất đi qua planner từ brief (9 task, ACCEPTED_WITH_RISKS) |
| `hblxweb-org`, `hblxweb-wave1` | Nguồn của các lesson VALIDATED (CHANGES_REQUIRED) |
| `hblxweb-p108b`, `hblxweb-fec1` | Integration conflict |
| `hblxweb-iss006` → `r2` → `r3`; `hblxweb-d1` → `d1b` → `d1c` | Re-dispatch thủ công |

Lưu ý bảo mật: báo cáo không trích snippet mã nguồn, tên file/package nội bộ, lệnh gate hay đường dẫn máy của dự án được thực thi (repo là PUBLIC). Không có secret nào được đưa vào báo cáo.

## 6. Script tái lập số liệu (chạy local, read-only)

Chạy với `python3 -I <script> <đường-dẫn-tới>/.companyswai`. Script chỉ đọc file; đặt script **ngoài** thư mục `.companyswai`.

### 6.1 Tổng hợp run

```python
import json,glob,os,collections,sys
base=sys.argv[1]; rows=[]
for f in sorted(glob.glob(base+'/runs/*.json')):
    if f.endswith('.plan.json'): continue
    d=json.load(open(f)); p={}
    pf=f[:-5]+'.plan.json'
    if os.path.exists(pf): p=json.load(open(pf))
    fin=d.get('final') or {}; tasks=p.get('tasks',[])
    rows.append(dict(pid=d['projectId'],phase=d.get('phase'),start=d.get('startedAt'),upd=d.get('updatedAt'),
      status=fin.get('status'),qa=(fin.get('qa') or {}).get('status'),ntasks=len(tasks),
      roles=[t.get('agentRole') for t in tasks],mode=p.get('mode'),
      direct_plan=d.get('briefHash')==d.get('planHash'),
      lessons=('LESSONS FROM PRIOR WORK' in json.dumps(p))))
C=collections.Counter
print('runs',len(rows)); print('final',C(r['status'] for r in rows)); print('qa',C(r['qa'] for r in rows))
print('ntasks',C(r['ntasks'] for r in rows)); print('roles',C(x for r in rows for x in r['roles']))
print('direct plan (briefHash==planHash)',sum(r['direct_plan'] for r in rows))
print('plans with injected lessons',sum(r['lessons'] for r in rows))
print('by day',sorted(C((r['start'] or '')[:10] for r in rows).items()))
```

### 6.2 Tổng hợp attempt, first-pass, gate, token, skill

```python
import json,glob,collections,sys
base=sys.argv[1]; A={}
for f in glob.glob(base+'/executions/*/records.jsonl'):
    for l in open(f):
        try: d=json.loads(l)
        except: continue
        A[d['id']]=d                      # trạng thái cuối của mỗi attempt
A=list(A.values()); C=collections.Counter
tok=lambda a:(a.get('inputTokens') or 0)+(a.get('outputTokens') or 0)
rev=[a for a in A if '--review' in a['taskId']]; mk=[a for a in A if '--review' not in a['taskId']]
print('attempts',len(A),'maker',len(mk),'review',len(rev),C(a['status'] for a in A))
print('tokens',sum(map(tok,A)),'review',sum(map(tok,rev)),'failed-attempt tokens',sum(tok(a) for a in A if a['status']=='FAILED'))
pt=collections.defaultdict(list)
for a in mk: pt[(a['projectId'],a['taskId'])].append(a)
fp=sum(1 for v in pt.values() if sorted(v,key=lambda a:a['startedAt'])[0]['status']=='SUCCEEDED')
fin=sum(1 for v in pt.values() if sorted(v,key=lambda a:a['startedAt'])[-1]['status']=='SUCCEEDED')
print('maker tasks',len(pt),'first-pass',fp,'final ok',fin)
print('gates',C((g['name'],g['status']) for a in A for g in (a.get('gates') or [])))
print('models',C(a['model'] for a in A))
sk=C(u['name'] for a in A for u in ((a.get('skillTrace') or {}).get('used',[]))); print('skills',sk.most_common())
print('android matches',C(tuple(u.get('matched',[])) for a in A for u in ((a.get('skillTrace') or {}).get('used',[])) if u['name']=='android'))
import re
pat=re.compile(r'(?i)(nothing was (compiled|run)|not (been )?(run|executed|compiled)|could not run|cannot run|did not run|no tool|unable to (run|execute)|not executed)')
mo=[a for a in mk if a['agentRole'] in ('backend-engineer','frontend-engineer','devops-sre') and a['output']]
print('maker outputs',len(mo),'admitting no execution',sum(1 for a in mo if pat.search(a['output'])))
```

### 6.3 Review verdict và QA verdict

```python
import json,glob,collections,re,sys
base=sys.argv[1]
v=collections.Counter(json.load(open(f))['verdict'] for f in glob.glob(base+'/reviews/*/*.json')); print('review',v)
A={}
for f in glob.glob(base+'/executions/*/records.jsonl'):
    for l in open(f):
        try: d=json.loads(l); A[d['id']]=d
        except: pass
qa=[r for r in A.values() if r['agentRole']=='qa-engineer' and '--review' not in r['taskId'] and r['status']=='SUCCEEDED']
rx=re.compile(r'(?im)^(?:\W*)(?:overall\s+)?(?:qa\s+)?(?:verdict|result|status)\W*[:\-]?\W*\**\s*(PASS(?:_WITH[_ A-Z]*)?|FAIL(?:ED)?|BLOCKED|PARTIAL)')
c=collections.Counter(); bad=[]
for r in qa:
    m=rx.search(r['output']); s=m.group(1).upper() if m else 'NONE'; c[s]+=1
    if s.startswith(('FAIL','BLOCK')): bad.append(r['projectId'])
print('qa verdicts',c)
for p in sorted(set(bad)):
    d=json.load(open(f'{base}/runs/{p}.json')); print(p,d['final']['status'],d['final']['qa'])
```
