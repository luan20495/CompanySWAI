import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {appendFile,mkdir,readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {CompanyState} from "../src/state.js";
import {baselineClaims,buildScorecard,foldAttempts,type Scorecard} from "../src/scorecard.js";
import {renderBaseline,renderProject,renderScorecard} from "../src/scorecard-render.js";
import {METRICS} from "../src/metric-catalog.js";
import {clearRegisteredSecrets,registerSecret} from "../src/secrets.js";
import {FIXTURE_NOW,RUNNING_PID,buildFixture} from "../benchmarks/evolution/p0/fixture.js";
import {EXPECTED,FIXTURE_DIR,goldenScorecard} from "../benchmarks/evolution/p0/build.js";
import {fakeAnthropicKey,tmpDir} from "./helpers.js";

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
 assert.equal(metricOf(c,"reported_tokens").value,170900,"dry-run estimates are not counted as usage");
 assert.match(metricOf(c,"reported_tokens").coverage??"",/10\/12 finished attempts/);
 assert.equal(metricOf(c,"known_cost").status,"UNKNOWN","subscription usage has no price: UNKNOWN, never 0");
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
 assert.equal(claims.find(x=>x.id==="C1")!.result,"5/6");assert.match(claims.find(x=>x.id==="C2")!.result,/^1\/6/);assert.equal(claims.find(x=>x.id==="C3")!.result,"1/1");
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
 assert.equal(runOf(c,"demo-failed-timeout").interventions,2);
 const m=metricOf(c,"interventions_per_accepted_run");assert.deepEqual([m.numerator,m.denominator,m.value],[4,1,4]);
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

test("docs/evolution/METRICS.md documents every catalog metric",async()=>{
 const doc=await readFile("docs/evolution/METRICS.md","utf8");
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
