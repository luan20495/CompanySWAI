import assert from "node:assert/strict";
import test from "node:test";
import {chmod,mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import type {ModelRequest} from "../src/provider.js";
import {ClaudeCodeProvider} from "../src/providers/claude-code.js";
import {compliant,isReviewRequest,pass,plan,reviewer,selectorFor,task,tmpState,usage} from "./helpers.js";

const sections=["Deliverables","Decisions","Evidence","Blockers","Handoff"];
const contract={sections,verdict:false,validators:[],params:{}};

function recording(handler:(request:ModelRequest)=>string){
 const requests:ModelRequest[]=[];
 return {requests,selector:selectorFor(request=>{requests.push(request);return usage(handler(request));})};
}

test("a reviewer never receives the maker's system prompt, reasoning or handoff chatter — only requirements, artifact, upstream context and evidence",async()=>{
 const maker=compliant("the delivered widget",{decisions:"Chose option B.",handoff:"HANDOFF-CHATTER"});
 const withReasoning="I first considered option A at length. SECRET-REASONING-TRACE\n\n"+maker+"\n\n## Scratch\nPRIVATE-SCRATCH-NOTES";
 const {requests,selector}=recording(request=>isReviewRequest(request)?pass("reviewed"):withReasoning);
 const state=await tmpState();
 await new ProjectOrchestrator(selector,state).run(plan("iso1",[task("a",{contract,system:"MAKER-SYSTEM-PROMPT",prompt:"Build the widget"}),task("b",{dependencies:["a"],contract,system:"MAKER-B-SYSTEM",prompt:"Use the widget",review:reviewer({system:"REVIEWER-SYSTEM"})})]));
 const review=requests.find(isReviewRequest)!;
 assert.equal(review.system,"REVIEWER-SYSTEM");assert.doesNotMatch(review.system,/MAKER/);
 assert.match(review.prompt,/TASK REQUIREMENTS[\s\S]*Use the widget/);
 assert.match(review.prompt,/ARTIFACT UNDER REVIEW[\s\S]*the delivered widget/);
 assert.match(review.prompt,/Chose option B/,"decisions are relevant to review");
 assert.match(review.prompt,/UPSTREAM a/,"the context the author was given is shared");
 assert.match(review.prompt,/TEST EVIDENCE[\s\S]*checked/);
 for(const leaked of ["SECRET-REASONING-TRACE","PRIVATE-SCRATCH-NOTES","HANDOFF-CHATTER","MAKER-SYSTEM-PROMPT","MAKER-B-SYSTEM"])assert.ok(!review.prompt.includes(leaked)&&!review.system.includes(leaked),leaked);
});

test("unrelated agents' context is excluded and only declared upstream artifacts are passed downstream",async()=>{
 const {requests,selector}=recording(request=>compliant("OUT["+request.prompt.split("\n")[0]+"]",{handoff:"HAND["+request.prompt.split("\n")[0]+"]"}));
 const state=await tmpState();
 await new ProjectOrchestrator(selector,state).run(plan("iso2",[task("a",{contract,prompt:"alpha work"}),task("b",{contract,prompt:"beta work"}),task("c",{dependencies:["a"],contract,prompt:"gamma work"})]));
 const gamma=requests.find(r=>r.prompt.startsWith("gamma work"))!;
 assert.match(gamma.prompt,/UPSTREAM a/);assert.ok(gamma.prompt.includes("OUT[alpha work]"));
 assert.ok(!gamma.prompt.includes("beta"),"b is not a declared dependency of c");
 assert.ok(!gamma.prompt.includes("checked: OUT"),"upstream evidence sections are not forwarded");
 const records=await state.executions.list("iso2");
 const refs=(taskId:string)=>records.find(r=>r.taskId===taskId&&r.status==="SUCCEEDED")!.contextRefs;
 assert.deepEqual(refs("c"),["artifact:a[Deliverables,Decisions,Blockers,Handoff]"]);assert.deepEqual(refs("a"),[]);assert.deepEqual(refs("b"),[]);
});

test("review executions record exactly what they were given (artifact, upstream, evidence) and nothing else",async()=>{
 const {selector}=recording(request=>isReviewRequest(request)?pass():compliant("w"));
 const state=await tmpState();
 await new ProjectOrchestrator(selector,state).run(plan("iso3",[task("a",{contract}),task("b",{contract}),task("c",{dependencies:["a"],contract,review:reviewer()})]));
 const review=(await state.executions.list("iso3")).find(r=>r.taskId.startsWith("c--review-")&&r.status==="SUCCEEDED")!;
 assert.deepEqual(review.contextRefs,["artifact:c[Deliverables,Decisions,Blockers]","upstream:a[Deliverables,Decisions]","evidence:c[Evidence]"]);
});

test("every model call is a fresh request: only system, prompt and token limit reach the provider",async()=>{
 const {requests,selector}=recording(request=>isReviewRequest(request)?pass():compliant("x"));
 await new ProjectOrchestrator(selector,await tmpState()).run(plan("iso4",[task("a",{contract,review:reviewer({maxRounds:2})}),task("b",{dependencies:["a"],contract})]));
 assert.ok(requests.length>=3);
 for(const request of requests)assert.deepEqual(Object.keys(request).sort(),["maxTokens","meta","prompt","system"]);
 // the reviewer of a is not a continuation of a's conversation: its prompt starts a new, self-contained request
 const review=requests.find(isReviewRequest)!;assert.ok(review.prompt.startsWith("Review the output below"));
});

test("upstream context is bounded per dependency",async()=>{
 const {requests,selector}=recording(request=>compliant(request.prompt.startsWith("producer")?"P".repeat(5000):"ok"));
 await new ProjectOrchestrator(selector,await tmpState(),{maxUpstreamChars:300}).run(plan("iso5",[task("p",{contract,prompt:"producer work"}),task("q",{dependencies:["p"],contract,prompt:"consumer work"})]));
 const consumer=requests.find(r=>r.prompt.startsWith("consumer"))!;
 assert.ok(consumer.prompt.length<1500);assert.match(consumer.prompt,/truncated/);
});

test("claude-code runs every execution in its own process and scratch directory",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"companyswai-pid-")),script=join(dir,"claude");
 await writeFile(script,`#!/usr/bin/env node
let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
 const text=input.includes("Review the output below")?"PASS\\n\\n## Evidence\\npid "+process.pid+"\\n\\n## Blockers\\nNone.":"## Deliverables\\npid "+process.pid+" cwd "+process.cwd()+"\\n\\n## Decisions\\nNone.\\n\\n## Evidence\\npid "+process.pid+"\\n\\n## Blockers\\nNone.\\n\\n## Handoff\\nnext";
 console.log(JSON.stringify({is_error:false,result:text,usage:{input_tokens:1,output_tokens:1},modelUsage:{"claude-fake":{}}}));});`);
 await chmod(script,0o755);
 const provider=new ClaudeCodeProvider("sonnet",{executable:script});
 const run=()=>provider.generate({system:"s",prompt:"p",maxTokens:10});
 const [one,two,three]=[await run(),await run(),await run()];
 const pids=[one,two,three].map(r=>r.text.match(/pid (\d+)/)![1]),cwds=[one,two].map(r=>r.text.match(/cwd (\S+)/)![1]);
 assert.equal(new Set(pids).size,3,"a new process per execution");assert.notEqual(cwds[0],cwds[1],"a new scratch directory per execution");
});
