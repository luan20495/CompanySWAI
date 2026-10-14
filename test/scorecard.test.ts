import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {appendFile,mkdir,readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {CompanyState} from "../src/state.js";
import {attributeInterventions,baselineClaims,buildScorecard,countCapacityPauses,foldAttempts,type Scorecard} from "../src/scorecard.js";
import {Intervention,InterventionLog} from "../src/intervention-log.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {ProjectPlan} from "../src/project.js";
import {ExecutionRecord} from "../src/execution-record.js";
import {AnthropicProvider} from "../src/providers/anthropic.js";
import {renderBaseline,renderProject,renderScorecard} from "../src/scorecard-render.js";
import {METRICS} from "../src/metric-catalog.js";
import {clearRegisteredSecrets,registerSecret} from "../src/secrets.js";
import {FIXTURE_NOW,RUNNING_PID,buildFixture} from "../benchmarks/evolution/p0/fixture.js";
import {EXPECTED,FIXTURE_DIR,METRICS_DOC,goldenScorecard,metricsDoc} from "../benchmarks/evolution/p0/build.js";
import {compliant,fakeAnthropicKey,plan,selectorFor,task,tmpDir,tmpState} from "./helpers.js";

const execFileAsync=promisify(execFile);
const alive=(pid:number)=>pid===RUNNING_PID;

/** path -> sha256 of every file under root. */
async function tree(root:string){
 const out=new Map<string,string>();
 const walk=async(dir:string)=>{for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else out.set(p.slice(root.length+1),createHash("sha256").update(await readFile(p)).digest("hex"));}};
 await walk(root);return out;
}
async function freshFixture(){const dir=await tmpDir("companyswai-p0-");await buildFixture(dir);return dir;}
const card=async(dir:string,now=FIXTURE_NOW)=>buildScorecard(new CompanyState(dir),{now,isAlive:alive});
const metricOf=(c:Scorecard,id:string)=>c.metrics.find(m=>m.id===id)!;
const runOf=(c:Scorecard,id:string)=>c.runs.find(r=>r.projectId===id)!;

test("the committed fixture is exactly what the generator produces (reproducible baseline)",async()=>{
 const dir=await freshFixture();
 const [built,committed]=await Promise.all([tree(dir),tree(FIXTURE_DIR)]);
 assert.deepEqual([...committed.entries()].sort(),[...built.entries()].sort(),"run `npx tsx benchmarks/evolution/p0/build.ts` and commit the result");
});

test("golden scorecard: the fixture produces the committed expected output",async()=>{
 assert.equal(await goldenScorecard(await freshFixture()),await readFile(EXPECTED,"utf8"));
});

test("strictly read-only: no file under the state directory is created, changed or moved, even with a torn log line",async()=>{
 const dir=await freshFixture(),before=await tree(dir);
 await card(dir);
 const cli=join(process.cwd(),"node_modules",".bin","tsx");
 for(const args of [[],["--json"],["--baseline"],["--project","demo-failed-timeout"]])await execFileAsync(cli,["src/scorecard-cli.ts","--state-dir",dir,...args],{cwd:process.cwd()});
 assert.deepEqual([...(await tree(dir)).entries()].sort(),[...before.entries()].sort());
 assert.ok(!(await readdir(join(dir,"executions","demo-failed-timeout"))).includes("records.corrupt.jsonl"),"unreadable lines are counted, never quarantined");
});

test("each attempt counts once although the log holds STARTED, CHECKPOINTED and terminal lines for it",async()=>{
 const dir=await freshFixture(),state=new CompanyState(dir);
 const {records}=await state.executions.read("demo-supplied-retry");
 assert.equal(records.length,15,"five attempts, three lines each");
 const attempts=foldAttempts(records);
 assert.equal(attempts.length,5);
 assert.deepEqual(attempts.map(a=>a.status),["FAILED","SUCCEEDED","SUCCEEDED","SUCCEEDED","SUCCEEDED"]);
 const c=await card(dir),run=runOf(c,"demo-supplied-retry");
 assert.equal(run.tokens.reported.input,20000+22000+7000+25000+7000,"tokens are taken once per attempt");
 assert.deepEqual(run.tasks.map(t=>[t.taskId,t.attempts,t.firstAttempt,t.lastAttempt,t.done,t.reviews.pass,t.reviews.changesRequired]),[["ui",3,"FAILED","SUCCEEDED",true,1,1]]);
});

test("token sources stay separate: provider-reported, fixture-estimated and unknown are never mixed",async()=>{
 const c=await card(await freshFixture());
 const timeout=runOf(c,"demo-failed-timeout"),dry=runOf(c,"demo-dryrun"),brief=runOf(c,"demo-brief-accepted");
 assert.equal(timeout.tokens.unknownAttempts,1,"a timeout without usage is unknown, not zero");
 assert.equal(timeout.tokens.reported.attempts,1);
 assert.deepEqual([dry.tokens.reported.attempts,dry.tokens.estimated.attempts,dry.tokens.estimated.input],[0,1,900]);
 assert.deepEqual([brief.tokens.reported.cacheRead,brief.tokens.reported.cacheCreation],[12000,1000]);
 assert.equal(metricOf(c,"reported_tokens").value,182900,"dry-run estimates are not counted as usage");
 assert.match(metricOf(c,"reported_tokens").coverage??"",/11\/13 finished attempts/);
 assert.equal(metricOf(c,"estimated_metered_cost").status,"UNKNOWN","subscription usage has no price: UNKNOWN, never 0");
 assert.equal(metricOf(c,"billed_cost").status,"UNKNOWN","nothing is ever billed money without a billing source");
});

test("durations come from recorded timestamps, not from when the scorecard runs",async()=>{
 const dir=await freshFixture(),a=await card(dir),b=await card(dir,FIXTURE_NOW+86_400_000);
 const shape=(c:Scorecard)=>c.runs.map(r=>[r.projectId,r.activeMs,...r.tasks.map(t=>t.wallMs)]);
 assert.deepEqual(shape(a),shape(b));
 assert.equal(runOf(a,"demo-supplied-retry").activeMs,32*60_000);
 assert.equal(runOf(b,"demo-running").engine.running[0].elapsedMs-runOf(a,"demo-running").engine.running[0].elapsedMs,86_400_000,"only live elapsed time follows the clock");
});

test("QA conflict: ACCEPTED with a QA FAIL is flagged; ACCEPTED with QA PASS is not; the verdict itself is not changed",async()=>{
 const c=await card(await freshFixture());
 const conflict=runOf(c,"demo-qa-conflict"),clean=runOf(c,"demo-brief-accepted");
 assert.equal(conflict.final,"ACCEPTED");assert.equal(conflict.qaConflict,true);assert.deepEqual(conflict.qa,[{taskId:"check",verdict:"FAIL"}]);
 assert.equal(clean.qaConflict,false);assert.deepEqual(clean.qa,[{taskId:"verify",verdict:"PASS"}]);
 assert.deepEqual([metricOf(c,"qa_conflict_rate").numerator,metricOf(c,"qa_conflict_rate").denominator],[1,1]);
 assert.match(renderScorecard(c),/QA CONFLICTS[^\n]*\(1\)[\s\S]*demo-qa-conflict/);
});

test("provenance: recorded where Phase 0 wrote it, derived from hashes otherwise, and labelled as such",async()=>{
 const c=await card(await freshFixture());
 assert.deepEqual(runOf(c,"demo-brief-accepted").planSource,{value:"brief",basis:"recorded"});
 assert.deepEqual(runOf(c,"demo-supplied-retry").planSource,{value:"supplied-plan",basis:"derived"});
 assert.deepEqual(runOf(c,"demo-brief-accepted").lessonsInjected,{value:1,basis:"recorded"});
 assert.deepEqual(runOf(c,"demo-qa-conflict").lessonsInjected,{value:0,basis:"derived"});
 assert.ok(runOf(c,"demo-brief-accepted").companyVersion);assert.equal(runOf(c,"demo-supplied-retry").companyVersion,undefined);
 const claims=baselineClaims(c);
 assert.equal(claims.find(x=>x.id==="C1")!.result,"6/7");assert.match(claims.find(x=>x.id==="C2")!.result,/^1\/7/);assert.equal(claims.find(x=>x.id==="C3")!.result,"1/1");
 assert.match(renderBaseline(c,claims),/C3[\s\S]*1\/1/);
});

test("live state: a running engine shows its task and role; the same log with a dead pid reads INTERRUPTED",async()=>{
 const dir=await freshFixture();
 const live=runOf(await card(dir),"demo-running");
 assert.equal(live.engine.state,"RUNNING");assert.deepEqual(live.engine.running.map(r=>[r.taskId,r.role]),[["build","backend-engineer"]]);
 const dead=runOf(await buildScorecard(new CompanyState(dir),{now:FIXTURE_NOW,isAlive:()=>false}),"demo-running");
 assert.equal(dead.engine.state,"INTERRUPTED");
});

test("failures say why and who; interventions are UNKNOWN before the log existed and counted after",async()=>{
 const c=await card(await freshFixture());
 assert.deepEqual(runOf(c,"demo-failed-timeout").failures.map(f=>[f.taskId,f.role,f.reason]),[["deploy","devops-sre","Gate 'unit-tests' failed: synthetic script error"]]);
 assert.equal(runOf(c,"demo-supplied-retry").interventions,undefined,"started before the log began: unknown, not 0");
 assert.equal(runOf(c,"demo-failed-timeout").interventions,1,"its dispatch; the manual re-dispatch came after the run ended");
 const m=metricOf(c,"interventions_per_accepted_run");assert.deepEqual([m.numerator,m.denominator,m.value],[4,2,2]);
 const empty=await buildScorecard(new CompanyState(await tmpDir()),{now:FIXTURE_NOW});
 assert.equal(metricOf(empty,"interventions_per_accepted_run").status,"UNKNOWN");
});

test("no secrets or credential-shaped strings leak into text or JSON output",async()=>{
 const dir=await freshFixture(),secret="fixture-live-secret-value-123";
 const line=JSON.parse((await readFile(join(dir,"executions","demo-qa-conflict","records.jsonl"),"utf8")).split("\n")[0]);
 await appendFile(join(dir,"executions","demo-qa-conflict","records.jsonl"),JSON.stringify({...line,id:"c3000000-0000-4000-8000-00000000000f",status:"FAILED",finishedAt:line.startedAt,error:"provider said "+secret+" and "+fakeAnthropicKey()})+"\n");
 registerSecret(secret);
 try{
  const c=await card(dir),run=runOf(c,"demo-qa-conflict");
  for(const text of [JSON.stringify(c),renderScorecard(c),renderProject(c,run)]){assert.ok(!text.includes(secret));assert.ok(!text.includes(fakeAnthropicKey()));}
  assert.ok(JSON.stringify(c).includes("[REDACTED]"));
 }finally{clearRegisteredSecrets();}
 const out=(await execFileAsync(join(process.cwd(),"node_modules",".bin","tsx"),["src/scorecard-cli.ts","--state-dir",dir,"--json"],{cwd:process.cwd()})).stdout;
 assert.ok(!out.includes(fakeAnthropicKey()));
});

test("unavailable metrics are reported as NOT_AVAILABLE with the phase that will make them measurable",async()=>{
 const c=await card(await freshFixture());
 for(const id of ["skill_outcome_effect","repeated_error_rate","model_escalation_success","release_readiness"]){const m=metricOf(c,id);assert.equal(m.status,"NOT_AVAILABLE");assert.equal(m.value,null);assert.match(m.reason??"",/Phase \d/);}
 assert.deepEqual(c.metrics.map(m=>m.id),METRICS.map(m=>m.id),"every catalog metric is reported");
});

test("docs/evolution/METRICS.md is exactly the catalog (definitions included)",async()=>{
 const doc=await readFile(METRICS_DOC,"utf8");
 assert.equal(doc,metricsDoc(),"regenerate with `npx tsx benchmarks/evolution/p0/build.ts`");
 for(const m of METRICS)assert.ok(doc.includes("`"+m.id+"`"),m.id+" is missing from METRICS.md");
});

test("a project without run state or plan is still reported, with the gap named",async()=>{
 const dir=await tmpDir(),state=new CompanyState(dir);
 await mkdir(join(dir,"executions","orphan"),{recursive:true});
 await writeFile(join(dir,"executions","orphan","records.jsonl"),JSON.stringify({id:"o1",projectId:"orphan",taskId:"t",agentRole:"backend-engineer",provider:"claude-code",model:"m",status:"SUCCEEDED",startedAt:"2026-01-01T00:00:00.000Z",finishedAt:"2026-01-01T00:01:00.000Z",inputTokens:5,outputTokens:5})+"\n");
 const c=await buildScorecard(state,{now:FIXTURE_NOW}),run=runOf(c,"orphan");
 assert.deepEqual(run.issues,["no run state","no plan"]);assert.deepEqual(run.planSource,{value:"unknown",basis:"unknown"});
 assert.equal(c.coverage.runsWithoutState,1);
});

// ------------------------------------------------------------------ review fixes (PR #11)

/** A minimal state: one project whose execution log is `lines` (an accepted run started at `start`). */
async function oneProject(id:string,start:string,lines:object[],extra:Record<string,unknown>={}){
 const dir=await tmpDir();
 await mkdir(join(dir,"executions",id),{recursive:true});await mkdir(join(dir,"runs"),{recursive:true});
 await writeFile(join(dir,"executions",id,"records.jsonl"),lines.map(l=>JSON.stringify(l)).join("\n")+"\n");
 await writeFile(join(dir,"runs",id+".json"),JSON.stringify({version:1,projectId:id,planHash:"p",briefHash:"p",completedPhases:[],phase:"DONE",startedAt:start,updatedAt:start,notes:[],final:{status:"ACCEPTED",reasons:[],risks:[],qa:{status:"NOT_RUN",required:false},tasks:{completed:1,failed:0,paused:0,waiting:0,approvalRequired:0},at:start},...extra}));
 return dir;
}
const rec=(id:string,projectId:string,status:string,startedAt:string,finishedAt?:string,extra:Record<string,unknown>={})=>({id,projectId,taskId:"t",agentRole:"backend-engineer",provider:"claude-code",model:"m",status,startedAt,...(finishedAt?{finishedAt}:{}),billing:"subscription",...extra});

test("busy time is the union of individual attempts: a long wait between two attempts is idle, not busy (Codex P1)",async()=>{
 const dir=await oneProject("gap","2026-02-01T00:00:00.000Z",[
  rec("a1","gap","STARTED","2026-02-01T00:00:00.000Z"),rec("a1","gap","FAILED","2026-02-01T00:00:00.000Z","2026-02-01T00:10:00.000Z",{inputTokens:1,outputTokens:1}),
  rec("a2","gap","STARTED","2026-02-01T05:00:00.000Z"),rec("a2","gap","SUCCEEDED","2026-02-01T05:00:00.000Z","2026-02-01T05:20:00.000Z",{inputTokens:1,outputTokens:1})
 ]);
 const c=await buildScorecard(new CompanyState(dir),{now:FIXTURE_NOW});
 assert.equal(metricOf(c,"accepted_runs_per_busy_hour").denominator,0.5,"10 + 20 minutes of attempts, not the 5h20m envelope");
 assert.equal(metricOf(c,"dispatch_gap_ms").value,4*3_600_000+50*60_000,"the 4h50m between the attempts is idle time");
 const parked=runOf(await card(await freshFixture()),"demo-parked");
 assert.equal(parked.activeMs,5*60_000,"capacity pauses two hours earlier are not activity: only the real 5-minute attempt counts");
});

test("capacity pauses are not attempts: repeated park/resume leaves attempts, first attempt and token coverage unchanged (Codex P1)",async()=>{
 const pause=(n:number,at:string)=>rec("p"+n,"park","PAUSED_CAPACITY",at,at,{provider:"unassigned",model:"unassigned",error:"no capacity"});
 const attempt=[rec("a1","park","STARTED","2026-02-01T03:00:00.000Z"),rec("a1","park","SUCCEEDED","2026-02-01T03:00:00.000Z","2026-02-01T03:05:00.000Z",{inputTokens:5,outputTokens:5,tokenSource:"reported"})];
 const clean=await buildScorecard(new CompanyState(await oneProject("park","2026-02-01T00:00:00.000Z",attempt)),{now:FIXTURE_NOW});
 const parkedLines=[pause(1,"2026-02-01T00:00:00.000Z"),pause(2,"2026-02-01T01:00:00.000Z"),pause(3,"2026-02-01T02:00:00.000Z"),...attempt];
 const parked=await buildScorecard(new CompanyState(await oneProject("park","2026-02-01T00:00:00.000Z",parkedLines)),{now:FIXTURE_NOW});
 const parsed=parkedLines.map(l=>ExecutionRecord.parse(l));
 assert.equal(foldAttempts(parsed).length,1);assert.equal(countCapacityPauses(parsed),3);
 const facts=(c:Scorecard)=>{const r=runOf(c,"park");return [r.attempts,r.tasks.map(t=>[t.attempts,t.firstAttempt]),r.tokens.unknownAttempts,metricOf(c,"first_attempt_gate_pass").value,metricOf(c,"attempt_failure_rate").value];};
 assert.deepEqual(facts(parked),facts(clean));
 assert.deepEqual([runOf(parked,"park").capacityPauses,parked.coverage.capacityPauses,runOf(clean,"park").capacityPauses],[3,3,0]);
 assert.equal(metricOf(parked,"accepted_runs_per_busy_hour").denominator,metricOf(clean,"accepted_runs_per_busy_hour").denominator,"pauses add no busy time");
 const fixture=runOf(await card(await freshFixture()),"demo-parked");
 assert.deepEqual([fixture.capacityPauses,fixture.tasks[0].attempts,fixture.tasks[0].firstAttempt],[2,1,"SUCCEEDED"]);
});

test("direct Anthropic responses keep prompt-cache tokens without changing what budgets price (Codex P2 + ChatGPT cost review)",async()=>{
 const client=(usage:Record<string,number|null>)=>({messages:{create:async()=>({content:[{type:"text",text:"ok"}],usage})}}) as never;
 const cached=await new AnthropicProvider(client({input_tokens:100,output_tokens:20,cache_creation_input_tokens:300,cache_read_input_tokens:600}),"m").generate({system:"s",prompt:"p",maxTokens:10});
 assert.deepEqual([cached.inputTokens,cached.cacheCreationInputTokens,cached.cacheReadInputTokens,cached.cacheTokensInInput,cached.outputTokens,cached.tokenSource],[100,300,600,false,20,"reported"],"inputTokens keeps its pre-Phase-0 meaning; cache parts kept and flagged as not included");
 const plain=await new AnthropicProvider(client({input_tokens:100,output_tokens:20,cache_creation_input_tokens:null,cache_read_input_tokens:null}),"m").generate({system:"s",prompt:"p",maxTokens:10});
 assert.deepEqual([plain.inputTokens,plain.cacheCreationInputTokens,plain.cacheReadInputTokens,plain.cacheTokensInInput],[100,undefined,undefined,undefined],"no caching: nothing invented");
});

test("cost honesty: runner cost is a nominal-rate estimate on the unchanged token basis; scorecard shows physical input, estimate and UNKNOWN billed",async()=>{
 const state=await tmpState(),price=[{id:"metered",inputCostPerMillion:3,outputCostPerMillion:15,maxConcurrency:2}];
 const respond=(r:Record<string,unknown>)=>selectorFor(()=>({text:compliant(),...r}) as never,price);
 // Anthropic-like (cache excluded from inputTokens), claude-code-like (included), and a provider that reports no usage.
 await new ProjectOrchestrator(respond({inputTokens:100,outputTokens:20,tokenSource:"reported",cacheCreationInputTokens:300,cacheReadInputTokens:600,cacheTokensInInput:false}),state).run(ProjectPlan.parse(plan("anth",[task("a")])));
 await new ProjectOrchestrator(respond({inputTokens:1000,outputTokens:20,tokenSource:"reported",cacheCreationInputTokens:300,cacheReadInputTokens:600,cacheTokensInInput:true}),state).run(ProjectPlan.parse(plan("cc",[task("a")])));
 await new ProjectOrchestrator(respond({inputTokens:0,outputTokens:0}),state).run(ProjectPlan.parse(plan("none",[task("a")])));
 const done=async(id:string)=>(await state.executions.list(id)).filter(r=>r.status==="SUCCEEDED")[0];
 const anth=await done("anth"),cc=await done("cc");
 const nominal=(input:number,output:number)=>input/1e6*3+output/1e6*15;
 assert.equal(anth.actualCost,nominal(100,20),"budgets price exactly what they priced before Phase 0 (uncached input only for Anthropic)");
 assert.equal(cc.actualCost,nominal(1000,20),"claude-code totals are unchanged too");
 assert.deepEqual([anth.costBasis,anth.cacheTokensInInput,cc.cacheTokensInInput],["nominal-rate-estimate",false,true]);
 const card_=await buildScorecard(state,{now:Date.now()});
 const att=(id:string)=>card_.runs.find(r=>r.projectId===id)!.tokens;
 assert.equal(att("anth").reported.input,1000,"physical input = 100 + 300 + 600");assert.equal(att("cc").reported.input,1000,"already included: not added twice");
 assert.equal(att("none").unknownAttempts,1);
 const est=metricOf(card_,"estimated_metered_cost"),billed=metricOf(card_,"billed_cost");
 assert.equal(est.value,Number((nominal(100,20)+nominal(1000,20)).toFixed(6)));assert.match(est.coverage??"",/2 recorded, 0 derived\); 1 priced attempt\(s\) with unreported usage excluded/);
 assert.deepEqual([billed.status,billed.value],["UNKNOWN",null]);
 assert.match(renderScorecard(card_),/Money: billed UNKNOWN \(no billing source\); estimated at configured nominal rates [\d.]+ \(estimate, not a bill\)/);
});

test("time filters compare instants, not strings: equivalent forms match and the upper bound is exclusive (Codex P2)",async()=>{
 const dir=await oneProject("edge","2026-01-01T00:00:00.000Z",[rec("a1","edge","STARTED","2026-01-01T00:00:00.000Z"),rec("a1","edge","SUCCEEDED","2026-01-01T00:00:00.000Z","2026-01-01T00:01:00.000Z")]);
 const ids=async(since?:string,until?:string)=>(await buildScorecard(new CompanyState(dir),{now:FIXTURE_NOW,since,until})).runs.map(r=>r.projectId);
 assert.deepEqual(await ids("2026-01-01T00:00:00Z"),["edge"],"…00Z equals …00.000Z");
 assert.deepEqual(await ids("2026-01-01T07:00:00+07:00"),["edge"],"an offset naming the same instant");
 assert.deepEqual(await ids(undefined,"2026-01-01T00:00:00Z"),[],"until is exclusive");
 assert.deepEqual(await ids(undefined,"2026-01-01T07:00:00.001+07:00"),["edge"]);
 assert.deepEqual(await ids("2025-12-31T23:59:59.999Z","2026-01-01T00:00:00.001Z"),["edge"]);
 const card_=await buildScorecard(new CompanyState(dir),{now:FIXTURE_NOW,since:"2026-01-01T07:00:00+07:00"});
 assert.equal(card_.window.since,"2026-01-01T00:00:00.000Z","the window is reported normalised");
 await assert.rejects(()=>buildScorecard(new CompanyState(dir),{since:"yesterday-ish"}),/not a valid timestamp/);
});

test("interventions are attributed by per-run time windows; anything outside is unattributed with a reason (ChatGPT follow-up)",()=>{
 const iv=(n:number,ts:string,projectId?:string,kind="dispatch")=>Intervention.parse({id:"iv"+n,ts,kind,...(projectId?{projectId}:{}),actor:"o",actorVerified:false,via:"t"});
 const D=(s:string)=>Date.parse(s),now=D("2026-03-10T00:00:00.000Z");
 const windows=[
  {projectId:"done",from:D("2026-01-01T10:00:00.000Z"),to:D("2026-01-02T10:00:00.000Z"),basis:"final" as const},
  {projectId:"live",from:D("2026-03-09T10:00:00.000Z"),to:now,basis:"live" as const},
  {projectId:"blind",basis:"unknown" as const}
 ];
 const entries=[
  iv(1,"2026-01-01T09:55:00.000Z","done"),                    // (1) dispatch within grace before start → attributed
  iv(2,"2026-01-01T15:00:00.000Z","done","approval"),          // (2) approval during the run → attributed
  iv(3,"2025-12-20T10:00:00.000Z","done"),                    // (3) dispatch long before → before-run
  iv(4,"2026-01-01T09:55:00.000Z","done","approval"),          //     non-dispatch kind gets no grace → before-run
  iv(5,"2026-03-01T10:00:00.000Z","done","manual"),            // (4) after the final verdict → after-run
  iv(6,"2026-03-01T10:00:00.000Z","done","resume"),            // (7) reopen of a finished run with no new run epoch → after-run
  iv(7,"2026-04-01T10:00:00.000Z","live"),                    // (5) future-dated → future
  iv(8,"2026-03-09T12:00:00.000Z","live","stop"),              //     live run: open until now → attributed
  iv(9,"2026-03-09T12:00:00.000Z","elsewhere"),               // (6) project filtered out / not in view
  iv(10,"not-a-time","done"),                                 // (8) invalid timestamp
  iv(11,"2026-03-09T12:00:00.000Z"),                           //     company-level, no project
  iv(12,"2026-03-09T12:00:00.000Z","blind")                    //     run whose time cannot be established
 ];
 const {byRun,unattributed,reasons}=attributeInterventions(windows,entries,now);
 assert.deepEqual([...byRun.entries()],[["done",2],["live",1],["blind",0]]);
 assert.deepEqual(reasons,{"before-run":2,"after-run":2,future:1,"project-not-in-view":1,"invalid-timestamp":1,"no-project":1,"run-time-unknown":1});
 assert.equal(unattributed,9);
});

test("a finished run does not absorb later interventions for its project: metric numerator and coverage (ChatGPT follow-up)",async()=>{
 const dir=await oneProject("old","2026-01-01T10:00:00.000Z",[rec("a1","old","STARTED","2026-01-01T10:00:00.000Z"),rec("a1","old","SUCCEEDED","2026-01-01T10:00:00.000Z","2026-01-01T11:00:00.000Z",{inputTokens:1,outputTokens:1})],{final:{status:"ACCEPTED",reasons:[],risks:[],qa:{status:"NOT_RUN",required:false},tasks:{completed:1,failed:0,paused:0,waiting:0,approvalRequired:0},at:"2026-01-02T00:00:00.000Z"}});
 const log=new InterventionLog(join(dir,"interventions.jsonl"));
 await log.append({kind:"dispatch",projectId:"old",actor:"o",via:"t",ts:"2026-01-01T09:58:00.000Z"});
 await log.append({kind:"manual",projectId:"old",actor:"o",via:"t",ts:"2026-03-01T10:00:00.000Z"});
 const c=await buildScorecard(new CompanyState(dir),{now:Date.parse("2026-03-10T00:00:00.000Z")});
 const run=runOf(c,"old"),m=metricOf(c,"interventions_per_accepted_run");
 assert.equal(run.interventions,1);assert.deepEqual(run.interventionWindow,{from:"2026-01-01T10:00:00.000Z",to:"2026-01-02T00:00:00.000Z",basis:"final"});
 assert.deepEqual([m.numerator,m.denominator,m.value],[1,1,1]);
 assert.match(m.coverage??"",/1 intervention\(s\) not attributable/);assert.deepEqual(c.interventions.unattributedReasons,{"after-run":1});
});

test("fixture: the stale intervention, the post-run re-dispatch and the company-level note stay unattributed",async()=>{
 const c=await card(await freshFixture());
 assert.equal(runOf(c,"demo-parked").interventions,1);
 assert.deepEqual([c.interventions.total,c.interventions.attributed,c.interventions.unattributed],[7,4,3]);
 assert.deepEqual(c.interventions.unattributedReasons,{"after-run":1,"before-run":1,"no-project":1});
});
