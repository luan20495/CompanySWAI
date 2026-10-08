import assert from "node:assert/strict";
import test from "node:test";
import {compileBriefToProjectPlan} from "../src/plan-compiler.js";
import {PATTERNS,buildRetrospective,renderRetrospective} from "../src/retrospective.js";
import {closeProject} from "../src/closeout.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {budgetReport} from "../src/budget.js";
import {createCapacitySelector} from "../src/provider-selector.js";
import {ExecutionRecord} from "../src/execution-record.js";
import {MarkdownAgentRegistry} from "../src/md-agent-loader.js";
import {changes,compliant,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

const brief={projectId:"secure-shop",objective:"Build a secure production commerce application",capabilities:["backend","web-ui","security-critical"] as ("backend"|"web-ui"|"security-critical")[],complexity:4 as const};

test("MD brief compiler produces executable reviewed project plan",async()=>{
 const compiled=await compileBriefToProjectPlan(brief);
 assert.ok(compiled.tasks.length>=6);assert.ok(compiled.tasks.every(t=>t.system&&t.prompt));assert.ok(compiled.tasks.some(t=>t.review));
 const backend=compiled.tasks.find(t=>t.agentRole==="backend-engineer")!;
 assert.ok(backend.system.includes("Backend Engineer"));assert.ok(backend.system.includes("Engineering fundamentals"));
 for(const t of compiled.tasks)if(t.review)assert.notEqual(t.review.role,t.agentRole,"reviewer independence in compiled plans");
});

test("only relevant skills and agents are loaded into each task",async()=>{
 const compiled=await compileBriefToProjectPlan({projectId:"mob",objective:"Build a mobile client for field staff",capabilities:["mobile"],complexity:2});
 const roles=compiled.tasks.map(t=>t.agentRole);
 assert.ok(roles.includes("mobile-engineer"));assert.ok(!roles.includes("backend-engineer")&&!roles.includes("frontend-engineer")&&!roles.includes("researcher"));
 const mobile=compiled.tasks.find(t=>t.agentRole==="mobile-engineer")!;
 assert.ok(mobile.system.includes("Mobile engineering"));assert.ok(!mobile.system.includes("Backend engineering"));assert.ok(!mobile.system.includes("Platform reliability"));
 const qa=compiled.tasks.find(t=>t.agentRole==="qa-engineer")!;assert.ok(!qa.system.includes("Mobile engineering"));
});

test("exactly eleven agents are declared and loaded from Markdown, each with identity and rules",async()=>{
 const agents=await new MarkdownAgentRegistry().loadAll();
 assert.equal(agents.length,11);assert.equal(new Set(agents.map(a=>a.id)).size,11);
 assert.ok(agents.every(a=>a.identity.length>0&&a.rules.length>0&&a.skillText.length===a.skills.length));
});

test("retrospective emits generic candidates for failures, capacity, cost drift and repeated revisions",()=>{
 const base={projectId:"p",agentRole:"dev",provider:"x",model:"m",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),inputRefs:[],output:"",inputTokens:100,outputTokens:100};
 const record=(over:Record<string,unknown>)=>ExecutionRecord.parse({...base,...over});
 const records=[
  record({id:"1",taskId:"a",status:"SUCCEEDED",estimatedCost:1,actualCost:2,agentRole:"dev"}),
  record({id:"2",taskId:"b",status:"PAUSED_CAPACITY",error:"quota"}),
  record({id:"3",taskId:"c",status:"FAILED",error:"Output contract violated after repair attempt: x"}),
  record({id:"4",taskId:"a--review-1",status:"SUCCEEDED",output:"CHANGES_REQUIRED\n\n## Evidence\nx",agentRole:"reviewer"}),
  record({id:"5",taskId:"a--review-2",status:"SUCCEEDED",output:"CHANGES_REQUIRED\n\n## Evidence\nx",agentRole:"reviewer"})
 ];
 const retro=buildRetrospective("p",records);
 assert.equal(retro.paused,1);assert.equal(retro.failures,1);assert.equal(retro.revisions,2);assert.equal(retro.reviewRounds,2);
 const patterns=retro.candidates.map(c=>c.pattern);
 for(const expected of [PATTERNS.capacity,PATTERNS.estimates,PATTERNS.failures,PATTERNS.contract,PATTERNS.revisions("dev")])assert.ok(patterns.includes(expected),expected);
 assert.equal(retro.candidates.find(c=>c.pattern===PATTERNS.revisions("dev"))?.scope,"role:dev");
 assert.ok(retro.lessons.some(x=>x.includes("Capacity"))&&retro.lessons.some(x=>x.includes("25%")));
 assert.deepEqual(buildRetrospective("q",[]).candidates,[]);assert.deepEqual(buildRetrospective("q",[]).lessons,[PATTERNS.clean]);
});

test("learning loop end to end: two projects promote a lesson into later plans, project facts stay local",async()=>{
 const state=await tmpState(),exhausted=()=>createCapacitySelector([{id:"gone",provider:"x",model:"m",state:"OUT_OF_CREDIT",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1}],()=>{throw new Error("unreachable");});
 for(const projectId of ["alpha-shop","beta-bank"]){
  const summary=await new ProjectOrchestrator(exhausted(),state).run(plan(projectId,[task("a")]));
  const {retrospective}=await closeProject(state,summary,{knownRoles:[]});
  assert.ok(retrospective.candidates.some(c=>c.pattern===PATTERNS.capacity));
  const md=await state.memory.read(projectId,"RETROSPECTIVE.md");assert.match(md,/## Cost: estimate vs actual/);assert.match(md,/Capacity pauses occurred/);assert.match(md,/Proposed company experience/);
 }
 const experience=await state.experience.validatedLessons();assert.deepEqual(experience.map(x=>x.pattern),[PATTERNS.capacity]);
 const gamma=await compileBriefToProjectPlan({...brief,projectId:"gamma"},{projectLessons:["Gamma specific: the ledger export is slow",PATTERNS.clean],experience});
 for(const t of gamma.tasks){assert.ok(t.system.includes(PATTERNS.capacity));assert.ok(t.system.includes("ledger export"));assert.ok(!t.system.includes(PATTERNS.clean));}
 const delta=await compileBriefToProjectPlan({...brief,projectId:"delta"},{experience});
 assert.ok(delta.tasks.every(t=>!t.system.includes("ledger export")),"another project never inherits project-local lessons");
});

test("role scoped lessons are injected only into that role's task",async()=>{
 const compiled=await compileBriefToProjectPlan(brief,{experience:[{pattern:"BACKEND-ONLY-LESSON",scope:"role:backend-engineer"}]});
 for(const t of compiled.tasks)assert.equal(t.system.includes("BACKEND-ONLY-LESSON"),t.agentRole==="backend-engineer");
});

test("revision-heavy review loops become a role scoped candidate through closeProject",async()=>{
 const state=await tmpState();
 const selector=selectorFor(request=>isReviewRequest(request)?usage(changes("not good enough")):usage(compliant("again")));
 const summary=await new ProjectOrchestrator(selector,state).run(plan("rev",[task("a",{agentRole:"builder",review:reviewer({maxRounds:3})})]));
 assert.deepEqual(summary.failed,["a"]);
 const {retrospective}=await closeProject(state,summary);
 assert.ok(retrospective.candidates.some(c=>c.scope==="role:builder"));assert.equal(retrospective.revisions,3);
 assert.match(await state.memory.read("rev","RETROSPECTIVE.md"),/failed: a/);
});

test("rendered retrospective includes the estimate versus actual tables",async()=>{
 const state=await tmpState();
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(pass()+"\n\n"+compliant()),[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:2}]),state).run(plan("md",[task("a")],{budget:{maxProjectCost:5,maxTeamCost:{engineering:2}}}));
 const records=await state.executions.list("md"),retro=buildRetrospective("md",records),md=renderRetrospective(retro,summary,budgetReport({maxProjectCost:5,maxTeamCost:{engineering:2}},records));
 assert.match(md,/\| project \| \$5\.0000 \|/);assert.match(md,/### By department/);assert.match(md,/\| engineering \| \$2\.0000 \|/);
});
