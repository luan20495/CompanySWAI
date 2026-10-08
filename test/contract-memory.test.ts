import assert from "node:assert/strict";
import test from "node:test";
import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {ContractViolationError} from "../src/runner.js";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {MEMORY_FILES} from "../src/project-memory.js";
import {compileBriefToProjectPlan} from "../src/plan-compiler.js";
import {condense,contractViolations,parseAgentOutput,section} from "../src/output-parser.js";
import {MarkdownAgentRegistry} from "../src/md-agent-loader.js";
import {dryRunSelector} from "../src/providers/dry-run.js";
import {compliant,fakeAnthropicKey,isReviewRequest,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

const sections=["Deliverables","Decisions","Evidence","Blockers","Handoff"];

test("structured output parser extracts every contract section and verdict",()=>{
 const parsed=parseAgentOutput(compliant("api",{decisions:"Use PostgreSQL.",blockers:"Need DNS access.",handoff:"Backend implements schema."}));
 assert.equal(parsed.decision,"Use PostgreSQL.");assert.equal(parsed.blockers,"Need DNS access.");assert.equal(parsed.handoff,"Backend implements schema.");
 assert.match(parsed.deliverables??"",/api/);assert.match(parsed.evidence??"",/checked/);
 assert.equal(section("## Evidence\n\n## Next\nx","Evidence"),undefined,"empty section counts as missing");
});

test("contract violations name every missing section and a missing verdict",()=>{
 assert.deepEqual(contractViolations(compliant(),{sections,verdict:false}),[]);
 const problems=contractViolations("## Deliverables\nx\n## Handoff\ny",{sections,verdict:false});
 assert.equal(problems.length,3);assert.ok(problems.some(p=>/Decisions/.test(p)));assert.ok(problems.some(p=>/Blockers/.test(p)));
 assert.ok(contractViolations("looks good\n## Evidence\nx",{sections:["Evidence"],verdict:true}).some(p=>/PASS or CHANGES_REQUIRED/.test(p)));
 assert.match(condense(compliant("D")+"\n\n## Scratch\nNOISE",500),/Deliverables[\s\S]*Handoff/);assert.doesNotMatch(condense(compliant("D")+"\n\n## Scratch\nNOISE",500),/NOISE/);
});

test("the contract is defined once in Markdown and every compiled task enforces it",async()=>{
 const contract=await readFile("company/OUTPUT-CONTRACT.md","utf8");
 assert.match(contract,/sections: \["Deliverables","Decisions","Evidence","Blockers","Handoff"\]/);
 const compiled=await compileBriefToProjectPlan({projectId:"c1",objective:"Build a secure backend service for payments",capabilities:["backend","security-critical"],complexity:4});
 for(const t of compiled.tasks){
  assert.deepEqual(t.contract.sections.slice(0,5),sections);assert.ok(t.system.includes("Output contract"));
  if(t.review){assert.equal(t.review.contract.verdict,true);assert.deepEqual(t.review.contract.sections.slice(0,2),["Evidence","Blockers"]);}
 }
});

test("a response missing sections is sent back once for repair and then accepted",async()=>{
 const state=await tmpState(),prompts:string[]=[];let calls=0;
 const selector=selectorFor(request=>{prompts.push(request.prompt);calls++;return usage(calls===1?"## Deliverables\nonly this":compliant("complete"));});
 const summary=await new ProjectOrchestrator(selector,state).run(plan("rep",[task("a",{contract:{sections,verdict:false}})]));
 assert.deepEqual(summary.completed,["a"]);assert.equal(calls,2);assert.match(prompts[1],/CONTRACT VIOLATION/);assert.match(prompts[1],/Decisions/);
 const record=(await state.executions.list("rep")).find(r=>r.status==="SUCCEEDED")!;
 assert.equal(record.inputTokens,20,"repair tokens are accounted");assert.match(record.output,/complete/);
});

test("a response that stays non-compliant fails the attempt and is recorded",async()=>{
 const state=await tmpState();
 const selector=selectorFor(()=>usage("free-form text without structure"));
 const summary=await new ProjectOrchestrator(selector,state).run(plan("bad",[task("a",{contract:{sections,verdict:false}})]));
 assert.deepEqual(summary.failed,["a"]);
 const failed=(await state.executions.list("bad")).find(r=>r.status==="FAILED")!;
 assert.match(failed.error??"",/Output contract violated/);assert.ok(failed.inputTokens>0);
 assert.ok(new ContractViolationError(["x"]).message.includes("x"));
});

test("reviewer PASS without evidence is rejected by the contract",async()=>{
 const state=await tmpState();
 const selector=selectorFor(request=>isReviewRequest(request)?usage("PASS\nlgtm"):usage(compliant()));
 const summary=await new ProjectOrchestrator(selector,state).run(plan("nev",[task("a",{review:reviewer({contract:{sections:["Evidence","Blockers"],verdict:true}})})]));
 assert.deepEqual(summary.failed,["a"]);assert.match((await state.executions.list("nev")).find(r=>r.status==="FAILED")!.error??"",/Evidence/);
});

test("all ten project memory files exist from the first moment and agent outputs persist automatically",async()=>{
 const state=await tmpState(),compiled=await compileBriefToProjectPlan({projectId:"mem",objective:"Build a secure backend service ready for deployment",capabilities:["backend","deployment","security-critical"],complexity:4});
 const summary=await new ProjectOrchestrator(dryRunSelector({requestChangesFor:["backend-engineer"]}),state).run(compiled);
 assert.equal(summary.completed.length,compiled.tasks.length);assert.deepEqual(summary.failed,[]);
 const dir=join(state.root,"projects","mem");
 assert.deepEqual((await readdir(dir)).sort(),[...MEMORY_FILES].sort());
 const read=(name:(typeof MEMORY_FILES)[number])=>state.memory.read("mem",name);
 assert.match(await read("REQUIREMENTS.md"),/business-analyst/);assert.match(await read("REQUIREMENTS.md"),/product-lead/);assert.match(await read("REQUIREMENTS.md"),/REQ-001/);
 assert.match(await read("ARCHITECTURE.md"),/tech-lead/);assert.match(await read("QA.md"),/qa-engineer/);assert.match(await read("QA.md"),/Requirement → test traceability/);
 assert.match(await read("REVIEWS.md"),/reviewing backend-engineer/);assert.match(await read("REVIEWS.md"),/CHANGES_REQUIRED/);
 assert.match(await read("DECISIONS.md"),/DEC-001/);
 assert.match(await read("HANDOFFS.md"),/backend-engineer \(ART-\d+\) — summary/,"unrouted artifacts are summarised");
 assert.match(await read("STATUS.md"),/SUCCEEDED/);
 const plan=await read("PLAN.md");assert.equal(plan.split("\n").filter(l=>l.startsWith("- [x]")).length,compiled.tasks.length);
 // memory stays a readable summary: one block per task per file, however many revisions happened
 const reqs=await read("REQUIREMENTS.md");assert.equal((reqs.match(/<!-- begin:output:business-analyst -->/g)??[]).length,1);
 assert.ok(reqs.length<30000);
 // structured records mirror the Markdown
 assert.ok((await readdir(join(state.root,"artifacts","mem"))).length>=compiled.tasks.length);
 assert.ok((await readdir(join(state.root,"decisions","mem"))).length>0);assert.ok((await readdir(join(state.root,"handoffs","mem"))).length>0);assert.ok((await readdir(join(state.root,"reviews","mem"))).length>0);
});

test("blockers reported by agents are persisted to BLOCKERS.md and the blocker store",async()=>{
 const state=await tmpState();
 await new ProjectOrchestrator(selectorFor(()=>usage(compliant("x",{blockers:"Need production credentials from the owner."}))),state).run(plan("blk",[task("a")]));
 assert.match(await state.memory.read("blk","BLOCKERS.md"),/production credentials/);
 assert.ok((await readdir(join(state.root,"blockers","blk"))).length===1);
});

test("memory writes are idempotent so recovery never duplicates entries",async()=>{
 const state=await tmpState();await state.memory.init(plan("idem",[task("a")]));
 await state.memory.recordDecision("idem","a","DEC-001","Use Postgres.");await state.memory.recordDecision("idem","a","DEC-001","Use Postgres.");
 assert.equal((await state.memory.read("idem","DECISIONS.md")).match(/Use Postgres/g)?.length,1);
 await state.memory.recordStatus("idem","a","X","token "+fakeAnthropicKey());
 assert.doesNotMatch(await state.memory.read("idem","STATUS.md"),/abcdefghij/);
});

test("no agent persona or role id is hard-coded in TypeScript",async()=>{
 const ids=(await new MarkdownAgentRegistry().loadAll()).map(a=>a.id),files=[...await readdir("src"),...(await readdir("src/providers")).map(f=>"providers/"+f)];
 for(const file of files.filter(f=>f.endsWith(".ts"))){
  const text=await readFile(join("src",file),"utf8");
  for(const id of ids)assert.ok(!new RegExp("(?:role|Role|\\bid)\\s*[!=]==?\\s*[\"'`]"+id+"[\"'`]").test(text)&&!new RegExp("includes\\([\"'`]"+id+"[\"'`]\\)").test(text),"src/"+file+" branches on agent id "+id);
 }
});
