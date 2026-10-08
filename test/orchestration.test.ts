import assert from "node:assert/strict";
import test from "node:test";
import {CapacityUnavailableError} from "../src/errors.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {TaskRunner} from "../src/runner.js";
import {createCapacitySelector,type ProviderSelector} from "../src/provider-selector.js";
import {changes,compliant,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

test("orchestrator runs dependency waves and hands upstream sections, not whole transcripts, downstream",async()=>{
 const state=await tmpState(),prompts:string[]=[];
 const selector=selectorFor(request=>{prompts.push(request.prompt);return usage(compliant("out:"+request.prompt.slice(0,12),{handoff:"HANDOFF-MARK"})+"\n\n## Scratch\nPRIVATE-NOISE");});
 const sections=["Deliverables","Decisions","Evidence","Blockers","Handoff"],contract={sections,verdict:false,validators:[],params:{}};
 const summary=await new ProjectOrchestrator(selector,state).run(plan("p1",[task("product",{contract}),task("critic",{dependencies:["product"],contract}),task("architecture",{dependencies:["critic"],contract})]));
 assert.equal(summary.waves,3);assert.deepEqual(summary.completed.sort(),["architecture","critic","product"]);
 assert.match(prompts[1],/UPSTREAM product/);assert.match(prompts[1],/HANDOFF-MARK/);assert.doesNotMatch(prompts[1],/PRIVATE-NOISE/);
 assert.match(prompts[2],/UPSTREAM critic/);
});

test("dependency graph problems are rejected before any model call",async()=>{
 let calls=0;const selector=selectorFor(()=>{calls++;return usage(compliant());});
 const orchestrator=new ProjectOrchestrator(selector,await tmpState());
 await assert.rejects(()=>orchestrator.run(plan("p",[task("a",{dependencies:["b"]}),task("b",{dependencies:["a"]})])),/cycle/i);
 await assert.rejects(()=>orchestrator.run(plan("p",[task("a",{dependencies:["ghost"]})])),/Missing dependency/);
 await assert.rejects(()=>orchestrator.run(plan("p",[task("a"),task("a")])),/Duplicate task id/);
 assert.equal(calls,0);
});

test("reviewer independence: a role cannot review its own task and reviewers never see the maker system prompt",async()=>{
 const orchestrator=new ProjectOrchestrator(selectorFor(()=>usage(compliant())),await tmpState());
 await assert.rejects(()=>orchestrator.run(plan("p",[task("a",{agentRole:"qa-reviewer",review:reviewer()})])),/independence/i);
 const seen:string[]=[],state=await tmpState();
 const selector=selectorFor(request=>{if(isReviewRequest(request)){seen.push(request.system);return usage(pass());}return usage(compliant());});
 const summary=await new ProjectOrchestrator(selector,state).run(plan("p2",[task("a",{review:reviewer()})]));
 assert.deepEqual(summary.completed,["a"]);assert.ok(seen.length>0&&seen.every(system=>system==="reviewer system"));
});

test("review gate revises maker output until the reviewer passes",async()=>{
 let makerCalls=0,reviewerCalls=0;const state=await tmpState(),prompts:string[]=[];
 const selector=selectorFor(request=>{
  if(isReviewRequest(request)){reviewerCalls++;return usage(reviewerCalls===1?changes("Add acceptance criteria."):pass("criteria testable"));}
  prompts.push(request.prompt);makerCalls++;return usage(compliant(makerCalls===1?"draft":"revised with acceptance criteria"));
 });
 const summary=await new ProjectOrchestrator(selector,state).run(plan("rv",[task("brief",{review:reviewer()})]));
 assert.equal(summary.reviewRuns,2);assert.equal(summary.revisions,1);assert.equal(makerCalls,2);assert.equal(reviewerCalls,2);
 assert.match(prompts[1],/PREVIOUS OUTPUT/);assert.match(prompts[1],/Add acceptance criteria/);
 const reviews=await state.memory.read("rv","REVIEWS.md");assert.match(reviews,/CHANGES_REQUIRED/);assert.match(reviews,/PASS/);
});

test("review that never passes ends the task as failed with a recorded blocker instead of crashing the run",async()=>{
 const state=await tmpState();
 const selector=selectorFor(request=>isReviewRequest(request)?usage(changes("still wrong")):usage(compliant("attempt")));
 const summary=await new ProjectOrchestrator(selector,state).run(plan("ex",[task("stuck",{review:reviewer({maxRounds:2})}),task("other"),task("after",{dependencies:["stuck"]})]));
 assert.deepEqual(summary.failed,["stuck"]);assert.deepEqual(summary.completed,["other"]);assert.deepEqual(summary.waiting,["after"]);
 assert.match(await state.memory.read("ex","BLOCKERS.md"),/Review still requires changes/);
 assert.match(await state.memory.read("ex","PLAN.md"),/\[x\] \*\*other\*\*/);
});

test("completed tasks are skipped on a clean restart and no work is duplicated",async()=>{
 const state=await tmpState();let calls=0;
 const selector=selectorFor(request=>{calls++;return usage(isReviewRequest(request)?pass():compliant());});
 const p=plan("skip",[task("a",{review:reviewer()}),task("b",{dependencies:["a"]})]);
 const first=await new ProjectOrchestrator(selector,state).run(p),callsAfterFirst=calls;
 const second=await new ProjectOrchestrator(selectorFor(()=>{throw new Error("must not call a model");}),state).run(p);
 assert.deepEqual(first.completed.sort(),["a","b"]);assert.deepEqual(second.skipped.sort(),["a","b"]);assert.equal(calls,callsAfterFirst);
 assert.match(await state.memory.read("skip","STATUS.md"),/SKIPPED_ALREADY_COMPLETE/);
});

test("resume: maker succeeded but review missing continues with the review only",async()=>{
 const state=await tmpState();let makerCalls=0,reviewAttempts=0;
 const selector=selectorFor(request=>{
  if(isReviewRequest(request)){reviewAttempts++;if(reviewAttempts===1)throw new Error("reviewer process crashed");return usage(pass());}
  makerCalls++;return usage(compliant("v"+makerCalls));
 });
 const p=plan("rm",[task("a",{review:reviewer()})]);
 const first=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(first.failed,["a"]);assert.equal(makerCalls,1);
 const second=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(second.completed,["a"]);assert.equal(makerCalls,1,"maker must not rerun");assert.equal(reviewAttempts,2);
});

test("resume: CHANGES_REQUIRED continues with a revision, not a fresh maker draft",async()=>{
 const state=await tmpState();let makerCalls=0,reviewCalls=0,interrupt=true;const prompts:string[]=[];
 const selector=selectorFor(request=>{
  if(isReviewRequest(request)){reviewCalls++;return usage(reviewCalls===1?changes("fix it"):pass());}
  prompts.push(request.prompt);
  if(/Revise the work/.test(request.prompt)&&interrupt){interrupt=false;throw new Error("forced interruption");}
  makerCalls++;return usage(compliant("draft-"+makerCalls));
 });
 const p=plan("cr",[task("a",{review:reviewer()})]);
 const first=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(first.failed,["a"]);assert.equal(makerCalls,1);
 const second=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(second.completed,["a"]);assert.equal(reviewCalls,2);assert.equal(makerCalls,2);
 assert.equal(prompts.filter(x=>!/Revise the work/.test(x)).length,1,"the first draft is never regenerated");
});

test("resume: PAUSED_CAPACITY tasks run once capacity returns",async()=>{
 const state=await tmpState(),p=plan("pc",[task("a"),task("b",{dependencies:["a"]})]);
 const exhausted=createCapacitySelector([{id:"gone",provider:"x",model:"m",state:"OUT_OF_CREDIT",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1}],()=>{throw new Error("unreachable");});
 const first=await new ProjectOrchestrator(exhausted,state).run(p);
 assert.deepEqual(first.paused,["a"]);assert.deepEqual(first.waiting,["b"]);
 assert.equal((await state.checkpoints.load("pc","a"))?.status,"PAUSED_CAPACITY");
 assert.equal((await state.executions.list("pc")).at(-1)?.status,"PAUSED_CAPACITY");
 const second=await new ProjectOrchestrator(selectorFor(()=>usage(compliant())),state).run(p);
 assert.deepEqual(second.completed.sort(),["a","b"]);assert.deepEqual(second.paused,[]);
});

test("a provider that reports no capacity mid-run pauses the task instead of failing it",async()=>{
 const state=await tmpState();
 const selector:ProviderSelector=()=>{throw new CapacityUnavailableError("everything is rate limited");};
 const summary=await new ProjectOrchestrator(selector,state).run(plan("np",[task("a")]));
 assert.deepEqual(summary.paused,["a"]);assert.deepEqual(summary.failed,[]);
});

test("resume: APPROVAL_REQUIRED waits for the persisted approval and then continues",async()=>{
 const state=await tmpState();let calls=0;
 const priced=[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:2}];
 const p=plan("ap",[task("a")],{budget:{approvalThreshold:0.01}});
 const first=await new ProjectOrchestrator(selectorFor(()=>{calls++;return usage(compliant());},priced),state).run(p);
 assert.deepEqual(first.approvalRequired,["a"]);assert.equal(calls,0);
 const request=await state.approvals.loadRequest("ap","a");assert.equal(request?.status,"PENDING");assert.ok((request?.estimatedCost??0)>0.01);
 await state.approvals.approve("ap","a",undefined,"owner");
 const second=await new ProjectOrchestrator(selectorFor(()=>{calls++;return usage(compliant());},priced),state).run(p);
 assert.deepEqual(second.completed,["a"]);assert.equal(calls,1);
});

test("approvalWait blocks inside the run and resumes the moment approval is granted",async()=>{
 const state=await tmpState();let calls=0,sleeps=0;
 const priced=[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:2}];
 const p=plan("aw",[task("a")],{budget:{approvalThreshold:0.01}});
 const orchestrator=new ProjectOrchestrator(selectorFor(()=>{calls++;return usage(compliant());},priced),state,{approvalWait:{pollMs:1,timeoutMs:5000},sleep:async()=>{sleeps++;if(sleeps===3)await state.approvals.approve("aw","a",undefined,"owner");}});
 const summary=await orchestrator.run(p);
 assert.deepEqual(summary.completed,["a"]);assert.ok(sleeps>=3);assert.equal(calls,1);
 const timeout=await new ProjectOrchestrator(selectorFor(()=>usage(compliant()),priced),await tmpState(),{approvalWait:{pollMs:1,timeoutMs:20},sleep:()=>new Promise(r=>setTimeout(r,5))}).run(plan("aw2",[task("a")],{budget:{approvalThreshold:0.01}}));
 assert.deepEqual(timeout.approvalRequired,["a"]);
});

test("crash after the provider returned finalizes the paid response on resume without a second model call",async()=>{
 const state=await tmpState();let calls=0;
 const selector=selectorFor(()=>{calls++;return usage(compliant("fresh",{decisions:"Use SQLite."}));});
 const runTask={projectId:"cr2",taskId:"a",agentRole:"dev-a",department:"engineering",kind:"maker" as const,produces:[],inputRefs:[],system:"s",prompt:"p",maxTokens:10};
 const crashed=await new TaskRunner(state).generate(runTask,selector({demand:{capabilities:[],estimatedInputTokens:1,estimatedOutputTokens:1}}).provider);
 assert.equal(crashed.status,"CHECKPOINTED");assert.equal(calls,1);
 const summary=await new ProjectOrchestrator(selector,state).run(plan("cr2",[task("a")]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(calls,1,"paid response reused");
 const records=await state.executions.list("cr2");
 assert.equal(records.filter(r=>r.status==="SUCCEEDED").length,1);assert.equal(records.filter(r=>r.status==="SUCCEEDED")[0].id,crashed.id);
 assert.match(await state.memory.read("cr2","DECISIONS.md"),/Use SQLite/);
});

test("a task that throws is isolated: independent tasks still finish and dependents wait",async()=>{
 const state=await tmpState();
 const selector=selectorFor(request=>{if(/bad/.test(request.prompt))throw new Error("kaboom: disk exploded");return usage(compliant());});
 const summary=await new ProjectOrchestrator(selector,state).run(plan("iso",[task("bad"),task("good"),task("child",{dependencies:["bad"]})]));
 assert.deepEqual(summary.failed,["bad"]);assert.deepEqual(summary.completed,["good"]);assert.deepEqual(summary.waiting,["child"]);
 assert.match(await state.memory.read("iso","STATUS.md"),/BLOCKED.*disk exploded/);
});

test("provider failover: a quota error moves the task to the backup profile",async()=>{
 const state=await tmpState();const calls:string[]=[];
 const selector=selectorFor((_request,profileId)=>{calls.push(profileId);if(profileId==="primary")throw new Error("429 quota exceeded");return usage(compliant());},[{id:"primary",inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:1},{id:"backup",inputCostPerMillion:2,outputCostPerMillion:2,maxConcurrency:1}]);
 const summary=await new ProjectOrchestrator(selector,state).run(plan("fo",[task("a")],{budget:{maxProjectCost:1}}));
 assert.deepEqual(calls,["primary","backup"]);assert.deepEqual(summary.completed,["a"]);assert.equal(summary.failovers,1);
 const rates=selector.snapshot?.().find(p=>p.id==="primary");assert.equal(rates?.state,"RATE_LIMITED");
});

test("maxConcurrency is enforced per profile and parallel profiles run in parallel",async()=>{
 const measure=async(profiles:Array<{id:string;maxConcurrency:number}>)=>{
  let active=0,max=0;
  const selector=selectorFor(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,25));active--;return usage(compliant());},profiles.map(p=>({...p,inputCostPerMillion:1,outputCostPerMillion:1})));
  await new ProjectOrchestrator(selector,await tmpState()).run(plan("cc",[task("a"),task("b"),task("c"),task("d")]));
  return max;
 };
 assert.equal(await measure([{id:"only",maxConcurrency:1}]),1);
 assert.equal(await measure([{id:"one",maxConcurrency:1},{id:"two",maxConcurrency:1}]),2);
 assert.equal(await measure([{id:"wide",maxConcurrency:3}]),3);
});

test("budget: parallel tasks cannot jointly overspend; exceeded budget fails the task with a blocker",async()=>{
 const state=await tmpState();
 const priced=[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:8}];
 // each task estimates 200 tokens => 0.2 cost; limit 0.3 admits exactly one
 const summary=await new ProjectOrchestrator(selectorFor(async()=>{await new Promise(r=>setTimeout(r,60));return usage(compliant());},priced),state).run(plan("bg",[task("a"),task("b")],{budget:{maxProjectCost:0.3}}));
 assert.equal(summary.completed.length+summary.failed.length,2);assert.equal(summary.completed.length,1);assert.equal(summary.failed.length,1);
 assert.match(await state.memory.read("bg","BLOCKERS.md"),/Project budget exceeded/);
 assert.ok(summary.budget.project.actual<=0.3+1e-9);
});

test("budget: department, agent and task limits and unknown provider cost fail closed",async()=>{
 const priced=[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:8}];
 const byTeam=await new ProjectOrchestrator(selectorFor(()=>usage(compliant()),priced),await tmpState()).run(plan("bt",[task("a"),task("b",{dependencies:["a"]})],{budget:{maxTeamCost:{engineering:0.21}}}));
 assert.deepEqual(byTeam.completed,["a"]);assert.deepEqual(byTeam.failed,["b"]);
 const byAgent=await new ProjectOrchestrator(selectorFor(()=>usage(compliant()),priced),await tmpState()).run(plan("ba",[task("a",{agentRole:"x"})],{budget:{maxAgentCost:{x:0.1}}}));
 assert.deepEqual(byAgent.failed,["a"]);
 const unknown=await new ProjectOrchestrator(selectorFor(()=>usage(compliant()),[{id:"free-form",maxConcurrency:1}]),await tmpState()).run(plan("bu",[task("a")],{budget:{maxProjectCost:5}}));
 assert.deepEqual(unknown.failed,["a"]);
});

test("summary reports estimate versus actual per level",async()=>{
 const priced=[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:8}];
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(compliant()),priced),await tmpState()).run(plan("er",[task("a",{review:reviewer()})],{budget:{maxProjectCost:5}}));
 assert.equal(summary.budget.project.runs,2);assert.ok(summary.budget.project.estimated>0&&summary.budget.project.actual>0);
 assert.ok(summary.budget.departments.engineering&&summary.budget.departments.quality);assert.ok(summary.budget.tasks.a);assert.ok(summary.budget.agents["qa-reviewer"]);
});
