import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {appendFile,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {promisify} from "node:util";
import {runAutonomous} from "../src/autonomous.js";
import {dryRunSelector} from "../src/providers/dry-run.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {ProjectPlan} from "../src/project.js";
import {CompanyState} from "../src/state.js";
import {companyVersion,organizationHash} from "../src/company-version.js";
import {InterventionLog,interventionActor} from "../src/intervention-log.js";
import {buildScorecard} from "../src/scorecard.js";
import {runOperator} from "../src/operator-commands.js";
import {compliant,plan,selectorFor,task,tmpDir,tmpState} from "./helpers.js";

const execFileAsync=promisify(execFile);
const tsx=()=>join(process.cwd(),"node_modules",".bin","tsx");
const VERSION={gitSha:"a".repeat(40),dirty:false,organizationHash:"0123456789abcdef",organizationFiles:3,packageVersion:"0.1.0",at:"2026-01-01T00:00:00.000Z"};

test("trace capture end to end: a dry run records company version, provenance and estimated tokens, and the scorecard reads them",async()=>{
 const state=await tmpState();
 const brief={projectId:"trace1",objective:"Build a small backend service",capabilities:["backend"] as "backend"[],complexity:2 as const};
 const result=await runAutonomous({brief},{state,selector:dryRunSelector(),dryRun:true,knownRoles:[],knownSkills:[],companyVersion:async()=>VERSION});
 assert.equal(result.phase,"DONE");
 const run=await state.runs.load("trace1");
 assert.deepEqual(run?.companyVersion,VERSION);
 assert.equal(run?.provenance?.source,"brief");assert.equal(typeof run?.provenance?.lessonsInjected,"number");
 const records=await state.executions.list("trace1");
 assert.ok(records.filter(r=>r.status==="SUCCEEDED").every(r=>r.tokenSource==="estimated"),"dry-run tokens are marked as estimates");
 const card=await buildScorecard(state);
 const fact=card.runs.find(r=>r.projectId==="trace1")!;
 assert.deepEqual(fact.planSource,{value:"brief",basis:"recorded"});
 assert.equal(fact.tokens.reported.attempts,0);assert.ok(fact.tokens.estimated.attempts>0);
 assert.equal(card.coverage.versionRecorded,1);
});

test("a supplied plan is recorded as such, and a version that cannot be read never blocks the run",async()=>{
 const state=await tmpState();
 const p=ProjectPlan.parse(plan("given",[task("a",{agentRole:"backend-engineer"})]));
 const result=await runAutonomous({plan:p},{state,selector:selectorFor(()=>({text:compliant(),inputTokens:3,outputTokens:4,tokenSource:"reported",cacheReadInputTokens:2})),knownRoles:[],knownSkills:[],companyVersion:async()=>{throw new Error("git missing");}});
 assert.equal(result.phase,"DONE");
 const run=await state.runs.load("given");
 assert.deepEqual(run?.provenance,{source:"supplied-plan",lessonsInjected:0});assert.equal(run?.companyVersion,undefined);
 const done=(await state.executions.list("given")).filter(r=>r.status==="SUCCEEDED");
 assert.deepEqual(done.map(r=>[r.tokenSource,r.cacheReadInputTokens,r.inputTokens]),[["reported",2,3]],"provider usage provenance survives checkpoint and finalize");
});

test("token provenance across repair rounds: a call without usage makes the attempt 'partial'",async()=>{
 const state=await tmpState();let calls=0;
 const p=ProjectPlan.parse(plan("repair",[task("a",{contract:{sections:["Deliverables","Decisions","Evidence","Blockers","Handoff"]}})]));
 await new ProjectOrchestrator(selectorFor(()=>++calls===1?{text:"missing sections",inputTokens:0,outputTokens:0}:{text:compliant(),inputTokens:5,outputTokens:5,tokenSource:"reported"}),state).run(p);
 const done=(await state.executions.list("repair")).filter(r=>r.status==="SUCCEEDED");
 assert.equal(calls,2);assert.deepEqual(done.map(r=>r.tokenSource),["partial"]);
});

test("company version: the organisation hash is stable and changes with the Markdown; outside git it is unknown, not guessed",async()=>{
 const root=await tmpDir();
 await mkdir(join(root,"agents","dev"),{recursive:true});await mkdir(join(root,"company"),{recursive:true});
 await writeFile(join(root,"agents","dev","IDENTITY.md"),"# dev\n");await writeFile(join(root,"company","POLICY.md"),"policy\n");
 const a=await organizationHash(root),b=await organizationHash(root);
 assert.equal(a.hash,b.hash);assert.equal(a.files,2);
 await writeFile(join(root,"company","POLICY.md"),"policy v2\n");
 assert.notEqual((await organizationHash(root)).hash,a.hash);
 const v=await companyVersion(root);
 assert.equal(v.gitSha,"unknown");assert.equal(v.dirty,"unknown");assert.equal(v.packageVersion,"unknown");
 assert.equal((await organizationHash(await tmpDir())).hash,"unknown");
});

test("intervention log: append-only, actor declared and unverified, unreadable lines counted without rewriting",async()=>{
 const dir=await tmpDir(),log=new InterventionLog(join(dir,"interventions.jsonl"));
 assert.deepEqual(await log.read(),{entries:[],unreadable:0,exists:false});
 await log.append({kind:"manual",projectId:"p1",actor:"owner",via:"test",detail:"hand fix"});
 await appendFile(join(dir,"interventions.jsonl"),"{torn\n");
 const read=await log.read();
 assert.equal(read.entries.length,1);assert.equal(read.unreadable,1);
 assert.equal(read.entries[0].actorVerified,false);assert.equal(read.entries[0].actor,"owner");
 await log.append({kind:"manual",actor:"owner",via:"test"});
 assert.equal((await log.read()).entries.length,2,"appends after a torn line stay readable");
 assert.equal(interventionActor(undefined,{}),"unspecified");assert.equal(interventionActor(undefined,{COMPANYSWAI_ACTOR:"lead"}),"lead");assert.equal(interventionActor("me",{COMPANYSWAI_ACTOR:"lead"}),"me");
});

test("commands record interventions: approve and intervene write the log; intervene refuses kinds the engine records itself",async()=>{
 const dir=await tmpDir();
 await execFileAsync(tsx(),["src/approve-cli.ts","proj","task-1","0.5","alice","--state-dir",dir],{cwd:process.cwd()});
 await execFileAsync(tsx(),["src/intervene-cli.ts","model-change","--project","proj","--detail","switched to a larger model","--actor","bob","--state-dir",dir],{cwd:process.cwd()});
 await assert.rejects(()=>execFileAsync(tsx(),["src/intervene-cli.ts","dispatch","--project","proj","--state-dir",dir],{cwd:process.cwd()}),/Usage/);
 const {entries}=await new InterventionLog(join(dir,"interventions.jsonl")).read();
 assert.deepEqual(entries.map(e=>[e.kind,e.projectId,e.actor,e.via]),[["approval","proj","alice","npm run approve"],["model-change","proj","bob","npm run intervene"]]);
 const listed=(await execFileAsync(tsx(),["src/intervene-cli.ts","list","--state-dir",dir],{cwd:process.cwd()})).stdout;
 assert.match(listed,/approval[\s\S]*alice \(unverified\)/);
});

test("operator stop records an intervention only when a stop was actually requested",async()=>{
 const state=await tmpState();
 const p=ProjectPlan.parse(plan("idle",[task("a")]));
 await runAutonomous({plan:p},{state,selector:selectorFor(()=>({text:compliant(),inputTokens:1,outputTokens:1})),knownRoles:[],knownSkills:[]});
 const out=await runOperator(["stop","idle","--actor","carol"],{state});
 assert.equal(out.code,0);assert.match(out.stdout,/No engine is running/);
 assert.equal((await state.interventions.read()).entries.length,0,"nothing happened, nothing is recorded");
});

test("state created by an older CompanySWAI (no provenance, version or token source) still loads",async()=>{
 const state=new CompanyState(await tmpDir());
 const p=ProjectPlan.parse(plan("legacy",[task("a")]));
 await state.runs.savePlan(p);
 await mkdir(join(state.root,"runs"),{recursive:true});
 await writeFile(join(state.root,"runs","legacy.json"),JSON.stringify({version:1,projectId:"legacy",planHash:"x",briefHash:"x",completedPhases:[],phase:"PLAN",startedAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",notes:[]}));
 const run=await state.runs.load("legacy");
 assert.equal(run?.provenance,undefined);assert.equal(run?.companyVersion,undefined);
});
