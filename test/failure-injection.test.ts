import assert from "node:assert/strict";
import test from "node:test";
import {chmod,mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {delimiter,join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {createCapacitySelector} from "../src/provider-selector.js";
import {loadRuntime} from "../src/runtime.js";
import {assertNoDuplicateWork,changes,compliant,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpDir,tmpState,usage} from "./helpers.js";

const sections=["Deliverables","Decisions","Evidence","Blockers","Handoff"];
const contract={sections,verdict:false,validators:[],params:{}};
const chain=()=>[task("a",{contract}),task("b",{contract,dependencies:["a"]}),task("c",{contract,dependencies:["b"]})];

test("INJECT provider rate limit: the request fails over to the other profile, nothing repeats",async()=>{
 const state=await tmpState();const calls:string[]=[];
 const selector=selectorFor((_r,profileId)=>{calls.push(profileId);if(profileId==="limited"&&calls.filter(c=>c==="limited").length===1)throw new Error("429 rate limit exceeded");return usage(compliant());},[{id:"limited",inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:1},{id:"spare",inputCostPerMillion:2,outputCostPerMillion:2,maxConcurrency:1}]);
 const summary=await new ProjectOrchestrator(selector,state,{maxParallelTasks:1}).run(plan("fi1",chain()));
 assert.deepEqual(summary.completed.sort(),["a","b","c"]);assert.ok(summary.failovers>=1);assertNoDuplicateWork(await state.executions.list("fi1"));
});

test("INJECT provider timeout: a timed-out provider is cooled down and the work moves on",async()=>{
 const state=await tmpState();let first=true;
 const selector=selectorFor((_r,profileId)=>{if(profileId==="slow"&&first){first=false;throw new Error("claude-code timed out after 600s");}return usage(compliant());},[{id:"slow",inputCostPerMillion:1,outputCostPerMillion:1,maxConcurrency:1},{id:"steady",inputCostPerMillion:2,outputCostPerMillion:2,maxConcurrency:1}]);
 const summary=await new ProjectOrchestrator(selector,state).run(plan("fi2",[task("a",{contract})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(selector.snapshot?.().find(p=>p.id==="slow")?.state,"UNAVAILABLE");
});

test("INJECT process crash: a model process killed mid-call fails the task; the resume completes it without redoing finished work",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"companyswai-crashcli-")),marker=join(dir,"crashed");
 await writeFile(join(dir,"claude"),`#!/usr/bin/env node
const fs=require("fs");
if(process.argv[2]==="--version"){console.log("9.9.9");process.exit(0);}
if(process.argv[2]==="auth"){console.log(JSON.stringify({loggedIn:true}));process.exit(0);}
let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
 if(input.includes("crash-me")&&!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},"x");process.kill(process.pid,"SIGKILL");}
 console.log(JSON.stringify({is_error:false,result:"## Deliverables\\nok "+input.split("\\n")[0]+"\\n\\n## Decisions\\nNone.\\n\\n## Evidence\\nran\\n\\n## Blockers\\nNone.\\n\\n## Handoff\\nnext",usage:{input_tokens:1,output_tokens:1},modelUsage:{"claude-fake":{}}}));});`);
 await chmod(join(dir,"claude"),0o755);
 const state=await tmpState(),old=process.env.PATH;process.env.PATH=dir+delimiter+old;
 try{
  const cfg=join(await tmpDir(),"p.json");
  await writeFile(cfg,JSON.stringify({providers:[{id:"cc",provider:"claude-code",model:"sonnet",capabilities:["reasoning"],contextWindow:200000,maxConcurrency:1}]}));
  const p=plan("fi3",[task("a",{contract,prompt:"first"}),task("b",{contract,dependencies:["a"],prompt:"crash-me"}),task("c",{contract,dependencies:["b"],prompt:"third"})]);
  const first=await new ProjectOrchestrator((await loadRuntime(cfg)).selector,state).run(p);
  assert.deepEqual(first.completed,["a"]);assert.deepEqual(first.failed,["b"]);assert.deepEqual(first.waiting,["c"]);
  const failed=(await state.executions.list("fi3")).find(r=>r.status==="FAILED")!;assert.match(failed.error??"",/claude-code failed/);
  const second=await new ProjectOrchestrator((await loadRuntime(cfg)).selector,state).run(p);
  assert.deepEqual(second.skipped,["a"]);assert.deepEqual(second.completed.sort(),["a","b","c"]);assertNoDuplicateWork(await state.executions.list("fi3"));
 }finally{process.env.PATH=old;}
});

test("INJECT malformed model response: free text, then structure, is repaired once and persisted only when valid",async()=>{
 const state=await tmpState();let n=0;
 const selector=selectorFor(()=>{n++;return usage(n===1?"lol here you go, I did the thing":compliant("properly structured"));});
 const summary=await new ProjectOrchestrator(selector,state).run(plan("fi4",[task("a",{contract})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(n,2);
 const artifacts=(await state.executions.list("fi4")).filter(r=>r.status==="SUCCEEDED");assert.match(artifacts[0].output,/properly structured/);assert.doesNotMatch(artifacts[0].output,/lol here you go/);
});

test("INJECT reviewer disagreement: a split verdict is reconciled by revision and counted",async()=>{
 const state=await tmpState();let round=0;
 const slot=(system:string)=>system==="B"?1:0;
 const two=reviewer({level:"CRITICAL",maxRounds:3,slots:[{system:"A",contract:{sections:["Evidence","Blockers"],verdict:true,validators:[],params:{}}},{system:"B",contract:{sections:["Evidence","Blockers"],verdict:true,validators:[],params:{}}}]});
 const selector=selectorFor(request=>{if(isReviewRequest(request))return usage(round===0&&slot(request.system)===1?changes("no tests"):pass());if(/Revise the work/.test(request.prompt))round=1;return usage(compliant());});
 const summary=await new ProjectOrchestrator(selector,state).run(plan("fi5",[task("a",{contract,review:two})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(summary.disagreements,1);assertNoDuplicateWork(await state.executions.list("fi5"),1);
});

test("INJECT task failure: other tasks finish, and the resume reruns only the failed one",async()=>{
 const state=await tmpState();let broken=true;const ran:string[]=[];
 const selector=selectorFor(request=>{const who=request.prompt.split(" ")[0];ran.push(who);if(who==="bad"&&broken)throw new Error("disk full while writing artifact");return usage(compliant());});
 const p=plan("fi6",[task("good",{contract,prompt:"good work"}),task("bad",{contract,prompt:"bad work"}),task("after",{contract,dependencies:["bad"],prompt:"after work"})]);
 const first=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(first.failed,["bad"]);assert.deepEqual(first.completed,["good"]);broken=false;ran.length=0;
 const second=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(second.completed.sort(),["after","bad","good"]);assert.deepEqual(ran.sort(),["after","bad"],"only unfinished work ran");assertNoDuplicateWork(await state.executions.list("fi6"));
});

test("INJECT unavailable provider: parked as PAUSED_CAPACITY, then resumed when capacity returns",async()=>{
 const state=await tmpState(),p=plan("fi7",chain());
 const down=createCapacitySelector([{id:"gone",provider:"x",model:"m",state:"UNAVAILABLE",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1}],()=>{throw new Error("unreachable");});
 const first=await new ProjectOrchestrator(down,state).run(p);assert.deepEqual(first.paused,["a"]);assert.deepEqual(first.waiting,["b","c"]);
 const second=await new ProjectOrchestrator(selectorFor(()=>usage(compliant())),state).run(p);assert.deepEqual(second.completed.sort(),["a","b","c"]);assertNoDuplicateWork(await state.executions.list("fi7"));
});

test("INJECT approval pause: nothing runs until approved, then the run resumes exactly once",async()=>{
 const state=await tmpState(),p=plan("fi8",[task("a",{contract})],{budget:{approvalThreshold:0.0001}});let calls=0;
 const priced=()=>selectorFor(()=>{calls++;return usage(compliant());},[{id:"main",inputCostPerMillion:1000,outputCostPerMillion:1000,maxConcurrency:2}]);
 const first=await new ProjectOrchestrator(priced(),state).run(p);assert.deepEqual(first.approvalRequired,["a"]);assert.equal(calls,0);
 await state.approvals.approve("fi8","a",undefined,"owner");
 const second=await new ProjectOrchestrator(priced(),state).run(p);assert.deepEqual(second.completed,["a"]);assert.equal(calls,1);assertNoDuplicateWork(await state.executions.list("fi8"));
});

test("INJECT restart during revision: the interrupted revision continues from the review, not from scratch",async()=>{
 const state=await tmpState();let makers=0,reviews=0,crash=true;
 const selector=selectorFor(request=>{if(isReviewRequest(request)){reviews++;return usage(reviews===1?changes("fix it"):pass());}if(/Revise the work/.test(request.prompt)&&crash){crash=false;throw new Error("process died mid-revision");}makers++;return usage(compliant("draft "+makers));});
 const p=plan("fi9",[task("a",{contract,review:reviewer({maxRounds:3})})]);
 const first=await new ProjectOrchestrator(selector,state).run(p);assert.deepEqual(first.failed,["a"]);assert.equal(makers,1);
 const second=await new ProjectOrchestrator(selector,state).run(p);assert.deepEqual(second.completed,["a"]);assert.equal(makers,2,"one original draft, one revision");assert.equal(reviews,2);assertNoDuplicateWork(await state.executions.list("fi9"),1);
});

test("INJECT restart after the model answered but before anything was persisted: the paid response is reused",async()=>{
 const state=await tmpState();let calls=0,armed=true;
 const real=state.memory.recordOutput.bind(state.memory);
 state.memory.recordOutput=async(...args:Parameters<typeof real>)=>{if(armed){armed=false;throw new Error("process killed while writing project memory");}return real(...args);};
 const selector=selectorFor(()=>{calls++;return usage(compliant("paid for once"));});
 const p=plan("fi10",[task("a",{contract}),task("b",{contract,dependencies:["a"]})]);
 const first=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(first.failed,["a"]);assert.equal(calls,1);assert.equal((await state.executions.list("fi10")).filter(r=>r.status==="CHECKPOINTED").length,1);
 const second=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(second.completed.sort(),["a","b"]);assert.equal(calls,2,"a once (reused after the crash) + b once");
 const records=await state.executions.list("fi10");assertNoDuplicateWork(records);
 assert.equal(records.filter(r=>r.taskId==="a"&&r.status==="CHECKPOINTED").length,1);
});
