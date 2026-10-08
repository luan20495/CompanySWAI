import assert from "node:assert/strict";
import test from "node:test";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import type {ModelRequest} from "../src/provider.js";
import {changes,compliant,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

const sections=["Deliverables","Decisions","Evidence","Blockers","Handoff"];
const contract={sections,verdict:false,validators:[],params:{}};
const two=(over:Record<string,unknown>={})=>reviewer({level:"CRITICAL",maxRounds:3,slots:[{lens:undefined,system:"REVIEWER-ONE",contract:{sections:["Evidence","Blockers"],verdict:true,validators:[],params:{}}},{lens:"security",system:"REVIEWER-TWO",contract:{sections:["Evidence","Blockers"],verdict:true,validators:[],params:{}}}],...over});
const slotOf=(request:ModelRequest)=>request.system==="REVIEWER-TWO"?1:0;

test("NORMAL review: one independent reviewer",async()=>{
 const state=await tmpState();let reviews=0;
 const summary=await new ProjectOrchestrator(selectorFor(request=>{if(isReviewRequest(request)){reviews++;return usage(pass());}return usage(compliant());}),state).run(plan("n1",[task("a",{contract,review:reviewer()})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(reviews,1);
});

test("CRITICAL review: two independent reviewers in separate contexts must both PASS",async()=>{
 const state=await tmpState(),seen:ModelRequest[]=[];
 const summary=await new ProjectOrchestrator(selectorFor(request=>{if(isReviewRequest(request)){seen.push(request);return usage(pass("ok from "+request.system));}return usage(compliant());}),state).run(plan("c1",[task("a",{contract,review:two()})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(seen.length,2);
 assert.deepEqual(seen.map(r=>r.system).sort(),["REVIEWER-ONE","REVIEWER-TWO"]);
 assert.match(seen[0].prompt+seen[1].prompt,/independent reviewer 1 of 2[\s\S]*independent reviewer 2 of 2|independent reviewer 2 of 2[\s\S]*independent reviewer 1 of 2/);
 for(const r of seen)assert.ok(!r.prompt.includes("ok from"),"a reviewer never sees the other reviewer's findings");
 const records=(await state.executions.list("c1")).filter(r=>r.taskId.startsWith("a--review-")&&r.status==="SUCCEEDED");
 assert.deepEqual(records.map(r=>r.slot).sort(),[0,1]);
});

test("CRITICAL review: one CHANGES_REQUIRED sends the work back with all findings; a split is recorded and reconciled",async()=>{
 const state=await tmpState();let round=0;const prompts:string[]=[],reviewPrompts:string[]=[];
 const selector=selectorFor(request=>{
  if(isReviewRequest(request)){
   reviewPrompts.push(request.prompt);
   const slot=slotOf(request);
   if(round===0)return usage(slot===0?pass("fine"):changes("SLOT-TWO-FINDING"));
   return usage(pass("now fine"));
  }
  prompts.push(request.prompt);if(/Revise the work/.test(request.prompt))round=1;return usage(compliant("v"+prompts.length));
 });
 const summary=await new ProjectOrchestrator(selector,state).run(plan("c2",[task("a",{contract,review:two()})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(summary.revisions,1);assert.equal(summary.disagreements,1);assert.equal(summary.reviewRuns,4);
 const revision=prompts.find(p=>/Revise the work/.test(p))!;
 assert.match(revision,/SLOT-TWO-FINDING/);assert.match(revision,/reviewers disagreed/i);
 assert.match(await state.memory.read("c2","STATUS.md"),/REVIEWER_DISAGREEMENT/);
 // after the revision each reviewer only sees its own earlier findings
 const second=reviewPrompts.slice(2);
 assert.ok(second.some(p=>/YOUR PREVIOUS FINDINGS[\s\S]*SLOT-TWO-FINDING/.test(p)));
 assert.ok(second.filter(p=>/YOUR PREVIOUS FINDINGS/.test(p)).every(p=>/fine|SLOT-TWO/.test(p)));
 assert.equal(second.filter(p=>p.includes("SLOT-TWO-FINDING")).length,1,"only the reviewer who wrote the finding is reminded of it");
});

test("HIGH_RISK: the second reviewer applies the security lens and passing deterministic checks are required",async()=>{
 const state=await tmpState();
 const highRisk=()=>two({level:"HIGH_RISK",gates:["checks","qa","security"]});
 const selector=selectorFor(request=>isReviewRequest(request)?usage(pass()):usage(compliant("no code at all")));
 const plain=plan("h1",[task("a",{contract,requiredGates:["unit-tests"],review:highRisk()})],{workspace:{path:process.cwd(),checks:[],autoCommit:false}});
 const summary=await new ProjectOrchestrator(selector,state).run(plain);
 assert.deepEqual(summary.failed,["a"],"reviewers passing is not enough without check evidence");
 assert.match(await state.memory.read("h1","BLOCKERS.md"),/deterministic gates/);
 const noWorkspace=await new ProjectOrchestrator(selector,await tmpState()).run(plan("h2",[task("a",{contract,review:highRisk()})]));
 assert.deepEqual(noWorkspace.completed,["a"],"the checks gate is not applicable without a workspace");
});

test("resume inside a review round runs only the missing reviewer",async()=>{
 const state=await tmpState();let makerCalls=0,reviewCalls:number[]=[],crash=true;
 const selector=selectorFor(request=>{
  if(isReviewRequest(request)){const slot=slotOf(request);if(slot===1&&crash){crash=false;throw new Error("reviewer two crashed hard");}reviewCalls.push(slot);return usage(pass());}
  makerCalls++;return usage(compliant());
 });
 const p=plan("rr",[task("a",{contract,review:two()})]);
 const first=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(first.failed,["a"]);assert.deepEqual(reviewCalls,[0]);
 const second=await new ProjectOrchestrator(selector,state).run(p);
 assert.deepEqual(second.completed,["a"]);assert.equal(makerCalls,1,"maker is not rerun");assert.deepEqual(reviewCalls,[0,1],"reviewer one is not asked again");
});

test("reviewers that keep disagreeing end in a recorded failure after the allowed rounds",async()=>{
 const state=await tmpState();
 const selector=selectorFor(request=>isReviewRequest(request)?usage(slotOf(request)===0?pass():changes("still no")):usage(compliant()));
 const summary=await new ProjectOrchestrator(selector,state).run(plan("rx",[task("a",{contract,review:two({maxRounds:2})})]));
 assert.deepEqual(summary.failed,["a"]);assert.ok(summary.disagreements>=1);
 assert.match(await state.memory.read("rx","BLOCKERS.md"),/Review still requires changes after 2 round/);
});
