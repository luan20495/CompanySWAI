import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {compileBriefToProjectPlan} from "../src/plan-compiler.js";
import {dryRunSelector} from "../src/providers/dry-run.js";
import {detectConflicts,parseArchitectureReview,parseQa,parseRequirements,parseResearch} from "../src/structured.js";
import {isKnownValidator,runValidators} from "../src/validators.js";
import {ContractViolationError} from "../src/runner.js";
import {plan,selectorFor,task,tmpState,usage} from "./helpers.js";

const research=(over:{sources?:string;claims?:string;conflicts?:string}={})=>"## Deliverables\nr\n\n## Decisions\nNone.\n\n## Evidence\nsee sources\n\n## Blockers\nNone.\n\n## Handoff\nnext\n\n## Sources\n"+(over.sources??"- [S1] Pricing page | https://vendor.example/pricing | retrieved: 2026-10-01 | authority: HIGH | published: 2026-09-01\n- [S2] Analyst note | https://analyst.example/n | retrieved: 2026-10-01 | authority: MEDIUM")+"\n\n## Claims\n"+(over.claims??"- [C1] FACT [topic: price]: The plan costs 10 per month. | cites: S1\n- [C2] ASSUMPTION: Volume discounts exist.\n- [C3] INFERENCE: Annual cost is about 120. | from: C1\n- [C4] RECOMMENDATION: Budget 120 per year. | based-on: C1,C3")+"\n\n## Conflicts\n"+(over.conflicts??"None.");
const ext:{params:Record<string,unknown>;now:number}={params:{externalResearch:true,maxSourceAgeDays:365},now:Date.parse("2026-10-08")};
const problems=(text:string,ctx=ext)=>runValidators(["research-evidence"],text,ctx).problems;

test("research evidence: a fully cited, classified artifact passes and parses into persistable structure",()=>{
 assert.deepEqual(problems(research()),[]);
 const parsed=parseResearch(research());
 assert.equal(parsed.sources.length,2);assert.equal(parsed.claims.length,4);
 assert.deepEqual(parsed.claims.map(c=>c.kind),["FACT","ASSUMPTION","INFERENCE","RECOMMENDATION"]);
 assert.deepEqual(parsed.sources[0],{id:"S1",title:"Pricing page",url:"https://vendor.example/pricing",retrieved:"2026-10-01",authority:"HIGH",published:"2026-09-01"});
 assert.deepEqual(parsed.claims[3].basedOn,["C1","C3"]);
});

test("research evidence: uncited external facts, unknown sources and unclassified lines are rejected",()=>{
 assert.ok(problems(research({claims:"- [C1] FACT: The market is large.\n- [C2] ASSUMPTION: x"})).some(p=>/uncited FACT C1/.test(p)));
 assert.ok(problems(research({claims:"- [C1] FACT: Cheap. | cites: S9"})).some(p=>/unknown source/.test(p)));
 assert.ok(problems(research({claims:"- [C1] Cheap and fast."})).some(p=>/malformed research line/.test(p)));
 assert.ok(problems(research({claims:"- [C1] FACT: ok | cites: S1\n- [C2] INFERENCE: leap"})).some(p=>/INFERENCE C2 must name/.test(p)));
 assert.ok(problems(research({claims:"- [C1] FACT: ok | cites: S1\n- [C2] RECOMMENDATION: do it | based-on: C7"})).some(p=>/unknown claim C7/.test(p)));
 assert.ok(problems(research({claims:""})).some(p=>/no claims/.test(p)));
});

test("research evidence: sources need a URL or internal reference, authority and retrieval date",()=>{
 assert.ok(problems(research({sources:"- [S1] Blog | not a url | retrieved: 2026-10-01 | authority: HIGH"})).some(p=>/http\(s\) URL or a brief:\/repo:/.test(p)));
 assert.ok(problems(research({sources:"- [S1] Blog | https://b.example | authority: HIGH"})).some(p=>/retrieved/.test(p)));
 assert.ok(problems(research({sources:"- [S1] Blog | https://b.example | retrieved: 2026-10-01 | authority: SOMETIMES"})).some(p=>/authority/.test(p)));
 assert.ok(problems(research(),{...ext,params:{externalResearch:false}}).some(p=>/no research connector retrieved external sources/.test(p)));
 assert.deepEqual(problems(research({sources:"- [S1] The brief | brief:objective | retrieved: 2026-10-01 | authority: HIGH",claims:"- [C1] FACT: Stated scope. | cites: S1"}),{...ext,params:{externalResearch:false}}),[]);
});

test("research evidence: freshness is checked and stale-only facts are rejected",()=>{
 const stale=research({sources:"- [S1] Old report | https://old.example/r | retrieved: 2026-10-01 | authority: HIGH | published: 2019-01-01",claims:"- [C1] FACT: Old number. | cites: S1"});
 assert.ok(problems(stale).some(p=>/relies only on stale sources/.test(p)));
 const mixed=research({sources:"- [S1] Old | https://old.example/r | retrieved: 2026-10-01 | authority: HIGH | published: 2019-01-01\n- [S2] New | https://new.example/r | retrieved: 2026-10-01 | authority: HIGH | published: 2026-09-01",claims:"- [C1] FACT: Number. | cites: S1,S2"});
 const result=runValidators(["research-evidence"],mixed,ext);assert.deepEqual(result.problems,[]);assert.ok(result.notes.some(n=>/stale source S1/.test(n)));
});

test("research evidence: conflicting sources are detected and must be acknowledged",()=>{
 const claims="- [C1] FACT [topic: price]: It costs 10. | cites: S1\n- [C2] FACT [topic: price]: It costs 15. | cites: S2";
 const parsed=parseResearch(research({claims}));
 assert.deepEqual(detectConflicts(parsed.claims),[["C1","C2","price"]]);
 assert.ok(problems(research({claims})).some(p=>/unacknowledged conflict between C1 and C2/.test(p)));
 assert.deepEqual(problems(research({claims,conflicts:"- C2 vs C1 | topic: price | resolution: prefer S1, the vendor's own page"})),[]);
 assert.deepEqual(detectConflicts(parseResearch(research({claims:"- [C1] FACT [topic: price]: 10 | cites: S1\n- [C2] FACT [topic: price]: 10 | cites: S2"})).claims),[],"agreeing sources are not a conflict");
 assert.deepEqual(detectConflicts(parseResearch(research({claims:"- [C1] FACT [topic: a]: 10 | cites: S1\n- [C2] FACT [topic: b]: 15 | cites: S2"})).claims),[]);
});

const requirements=(body:string)=>"## Deliverables\nd\n\n## Decisions\nNone.\n\n## Evidence\ne\n\n## Blockers\nNone.\n\n## Handoff\nh\n\n## Requirements\n"+body;
test("requirements need IDs, a basis label and testable acceptance criteria",()=>{
 const good="- [REQ-001] FACT: Users can pay. (basis: product-plan)\n  - [AC-001.1] Given a cart when paying then an order exists.\n- [REQ-002] ASSUMPTION: Guests may check out.\n  - [AC-002.1] Given a guest when checking out then it works.";
 assert.deepEqual(runValidators(["requirements-ids"],requirements(good),{params:{}}).problems,[]);
 const parsed=parseRequirements(requirements(good));assert.deepEqual(parsed.requirements.map(r=>[r.id,r.basis,r.acceptance.length]),[["REQ-001","FACT",1],["REQ-002","ASSUMPTION",1]]);
 const check=(body:string)=>runValidators(["requirements-ids"],requirements(body),{params:{}}).problems;
 assert.ok(check("- [REQ-001] FACT: x (basis: brief)").some(p=>/no testable acceptance/.test(p)));
 assert.ok(check("- [REQ-001] FACT: x\n  - [AC-001.1] y").some(p=>/FACT but names no basis/.test(p)));
 assert.ok(check("- [REQ-001] OPINION: x\n  - [AC-001.1] y").some(p=>/malformed/.test(p)));
 assert.ok(check("- [REQ-001] ASSUMPTION: a\n  - [AC-1.1] b\n- [REQ-001] ASSUMPTION: c\n  - [AC-1.2] d").some(p=>/duplicate requirement id REQ-001/.test(p)));
 assert.ok(check("").some(p=>/no requirements/.test(p)));
});

const qa=(status:string,lines:string)=>"## Deliverables\nd\n\n## Decisions\nNone.\n\n## Evidence\ne\n\n## Blockers\nNone.\n\n## Handoff\nh\n\n## QA Status\n"+status+"\n\n## Traceability\n"+lines;
const qaCtx={params:{},requirementIds:["REQ-001","REQ-002","REQ-003"]};
test("QA must trace every requirement to a classified test and agree with its own overall status",()=>{
 const good="- [REQ-001] -> [T-001] PASS: pays | evidence: run 1\n- [REQ-002] -> [T-002] PASS: guest | evidence: run 2\n- [REQ-003] -> NOT_APPLICABLE: covered by ops";
 assert.deepEqual(runValidators(["qa-traceability"],qa("PASS — all good",good),qaCtx).problems,[]);
 const parsed=parseQa(qa("PASS — all good",good));assert.equal(parsed.overall,"PASS");assert.deepEqual(parsed.tests.map(t=>t.status),["PASS","PASS","NOT_APPLICABLE"]);
 const check=(status:string,lines:string)=>runValidators(["qa-traceability"],qa(status,lines),qaCtx).problems;
 assert.ok(check("PASS",good.split("\n").slice(0,2).join("\n")).some(p=>/requirement REQ-003 has no test/.test(p)));
 assert.ok(check("PASS",good.replace("PASS: guest","FAIL: guest")).some(p=>/QA Status says PASS but the individual results imply FAIL/.test(p)));
 assert.deepEqual(check("FAIL — guest broken",good.replace("PASS: guest","FAIL: guest")),[]);
 assert.deepEqual(check("BLOCKED — sandbox down",good.replace("[T-002] PASS: guest | evidence: run 2","[T-002] BLOCKED: sandbox down")),[]);
 assert.ok(check("MAYBE",good).some(p=>/QA Status must start/.test(p)));
 assert.ok(check("PASS",good+"\n- [REQ-099] -> [T-009] PASS: ghost | evidence: x").some(p=>/unknown requirement REQ-099/.test(p)));
 assert.ok(check("PASS",good.replace("| evidence: run 2","")).some(p=>/needs '\| evidence/.test(p)));
 assert.ok(check("PASS",good.replace("[T-002]","[T-001]")).some(p=>/duplicate test id T-001/.test(p)));
 assert.equal(parseQa(qa("NOT_APPLICABLE — nothing to test","- [REQ-001] -> NOT_APPLICABLE: n/a")).overall,"NOT_APPLICABLE");
});

const arch=(verdict:string,categories:string,risks="None.")=>verdict+"\n\n## Evidence\nread the design\n\n## Blockers\nNone.\n\n## Architecture Review\n"+categories+"\n\n## Decisions\n- Keep the modular monolith.\n\n## Unresolved Risks\n"+risks;
const archCtx={params:{architectureCategories:["modularity","security","failure-modes"]}};
test("QA depth comes from the mode: deep QA demands more than one executed test per requirement",()=>{
 const lines="- [REQ-001] -> [T-001] PASS: a | evidence: x\n- [REQ-002] -> [T-002] PASS: b | evidence: y\n- [REQ-003] -> [T-003] PASS: c | evidence: z";
 const deep={params:{minTestsPerRequirement:2},requirementIds:["REQ-001","REQ-002","REQ-003"]};
 assert.equal(runValidators(["qa-traceability"],qa("PASS",lines),deep).problems.filter(p=>/at least 2/.test(p)).length,3);
 const twice="- [REQ-001] -> [T-001] PASS: a | evidence: x\n- [REQ-001] -> [T-002] PASS: a2 | evidence: x\n- [REQ-002] -> [T-003] PASS: b | evidence: y\n- [REQ-002] -> [T-004] PASS: b2 | evidence: y\n- [REQ-003] -> NOT_APPLICABLE: ops";
 assert.deepEqual(runValidators(["qa-traceability"],qa("PASS",twice),deep).problems,[]);
 assert.deepEqual(runValidators(["qa-traceability"],qa("PASS",lines),{...deep,params:{}}).problems,[],"standard depth accepts one test per requirement");
});

test("architecture review covers every applicable category, records decisions and risks, and FAIL forces CHANGES_REQUIRED",()=>{
 const all="- modularity: PASS — clear module boundaries\n- security: RISK — token storage unspecified\n- failure-modes: PASS — retries defined";
 assert.deepEqual(runValidators(["architecture-review"],arch("PASS",all,"- token storage unspecified"),archCtx).problems,[]);
 const parsed=parseArchitectureReview(arch("PASS",all,"- token storage unspecified"));assert.equal(parsed.categories.length,3);assert.deepEqual(parsed.unresolvedRisks,["token storage unspecified"]);assert.deepEqual(parsed.decisions,["Keep the modular monolith."]);
 const check=(verdict:string,cats:string,risks?:string)=>runValidators(["architecture-review"],arch(verdict,cats,risks),archCtx).problems;
 assert.ok(check("PASS",all.split("\n").slice(0,2).join("\n"),"- x").some(p=>/missing architecture review category: failure-modes/.test(p)));
 assert.ok(check("PASS",all).some(p=>/must be listed under ## Unresolved Risks/.test(p)));
 assert.ok(check("PASS",all.replace("RISK","FAIL"),"- x").some(p=>/verdict must be CHANGES_REQUIRED/.test(p)));
 assert.deepEqual(check("CHANGES_REQUIRED",all.replace("RISK","FAIL"),"- x"),[]);
 assert.ok(check("PASS",all+"\n- portability: PASS — fine","- x").some(p=>/portability does not apply/.test(p)));
 assert.ok(check("PASS","- modularity: PASS — a\n- modularity: PASS — b\n- security: PASS — c\n- failure-modes: PASS — d").some(p=>/reviewed twice/.test(p)));
});

test("code delivery: a configured workspace requires real file blocks",()=>{
 assert.ok(runValidators(["code-delivery"],"## Deliverables\njust prose",{params:{workspaceConfigured:true}}).problems.length>0);
 assert.deepEqual(runValidators(["code-delivery"],"## Deliverables\n```file a.ts\nx\n```",{params:{workspaceConfigured:true}}).problems,[]);
 assert.deepEqual(runValidators(["code-delivery"],"prose",{params:{workspaceConfigured:false}}).problems,[]);
});

test("unknown validators fail loudly and every validator named in Markdown exists",async()=>{
 assert.throws(()=>runValidators(["no-such-validator"],"x",{params:{}}),/Unknown output validator/);
 const names=new Set<string>();
 for(const id of ["researcher","business-analyst","qa-engineer","tech-lead","backend-engineer"]){
  const text=await readFile(join("agents",id,"RULES.md"),"utf8"),match=text.match(/^validators:\s*(\[.*\])$/m);
  if(match)for(const name of JSON.parse(match[1]) as string[])names.add(name);
 }
 assert.deepEqual([...names].sort(),["qa-traceability","requirements-ids","research-evidence"]);
 for(const name of [...names,"architecture-review","code-delivery"])assert.ok(isKnownValidator(name),name);
});

test("a task whose output violates a validator is repaired once, then fails with the validator's reason",async()=>{
 const state=await tmpState();let calls=0;
 const plain=selectorFor(()=>{calls++;return usage(calls===1?"## Deliverables\nx\n## Decisions\nNone.\n## Evidence\ne\n## Blockers\nNone.\n## Handoff\nh\n## Requirements\n- [REQ-001] FACT: x":requirements("- [REQ-001] FACT: x (basis: brief)\n  - [AC-001.1] Given y when z then w."));});
 const contract={sections:["Deliverables","Decisions","Evidence","Blockers","Handoff","Requirements"],verdict:false,validators:["requirements-ids"],params:{}};
 const ok=await new ProjectOrchestrator(plain,state).run(plan("v1",[task("ba",{contract})]));
 assert.deepEqual(ok.completed,["ba"]);assert.equal(calls,2);
 assert.deepEqual((await state.traceability.load("v1")).requirements.map(r=>r.id),["REQ-001"]);
 const stubborn=await new ProjectOrchestrator(selectorFor(()=>usage("## Deliverables\nx\n## Decisions\nNone.\n## Evidence\ne\n## Blockers\nNone.\n## Handoff\nh\n## Requirements\n- [REQ-001] FACT: x")),await tmpState()).run(plan("v2",[task("ba",{contract})]));
 assert.deepEqual(stubborn.failed,["ba"]);
 assert.ok(new ContractViolationError(["no testable acceptance"]).message.includes("acceptance"));
});

test("end to end: connectors retrieve real documents, research cites only those, and requirements, architecture review and QA persist",async()=>{
 const state=await tmpState();
 const compiled=await compileBriefToProjectPlan({projectId:"e2e-struct",objective:"Build a secure payments backend for merchants with a postgres database",capabilities:["backend","deployment","security-critical"],complexity:4,mode:"MAX_QUALITY",research:{enabled:true,maxSourceAgeDays:3650,connectors:[{kind:"static",path:"benchmarks/research-corpus.json"}]}});
 const summary=await new ProjectOrchestrator(dryRunSelector(),state).run(compiled);
 assert.deepEqual(summary.failed,[]);assert.equal(summary.completed.length,compiled.tasks.length);
 const research=await state.research.load("e2e-struct","researcher");
 assert.ok(research&&research.externalResearch&&research.sources.length>=2&&research.claims.length>=4);
 const corpus=JSON.parse(await readFile("benchmarks/research-corpus.json","utf8")) as Array<{url:string}>;
 assert.ok(research.sources.every((s:{url:string})=>corpus.some(c=>c.url===s.url)),"every citation is a retrieved document");
 const retrieved=JSON.parse(await readFile(join(state.root,"research","e2e-struct","researcher.retrieved.json"),"utf8")) as {documents:Array<{url:string;retrieved:string}>};
 assert.ok(retrieved.documents.length>=2&&retrieved.documents.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.retrieved)),"the retrieval itself is persisted for audit");
 const trace=await state.traceability.load("e2e-struct");
 assert.deepEqual(trace.requirements.map(r=>r.id),["REQ-001","REQ-002","REQ-003"]);assert.ok(trace.requirements.every(r=>r.acceptance.length>=1));
 assert.equal(trace.qa?.overall,"PASS");assert.equal(trace.tests.length,6,"MAX_QUALITY means deep QA: two executed tests per requirement");
 assert.ok(trace.architecture.length===1&&trace.architecture[0].categories.length>=5&&trace.architecture[0].verdict==="PASS");
 assert.ok(trace.decisions.length>=1&&trace.decisions[0].id==="DEC-001");assert.ok(trace.artifacts.every((a,i)=>a.id==="ART-"+String(i+1).padStart(3,"0")));
 const matrix=await state.traceability.renderMatrix("e2e-struct");assert.match(matrix,/REQ-001 \| AC-001\.1 \| T-001, T-002 \| PASS, PASS/);
 assert.match(await state.memory.read("e2e-struct","QA.md"),/Overall QA: PASS/);
});

const citing=(url:string)=>"## Deliverables\nr\n\n## Decisions\nNone.\n\n## Evidence\ne\n\n## Blockers\nNone.\n\n## Handoff\nh\n\n## Sources\n- [S1] Made up | "+url+" | retrieved: 2026-10-01 | authority: HIGH\n\n## Claims\n- [C1] FACT: Something. | cites: S1\n\n## Conflicts\nNone.";
test("research cannot cite sources that were never retrieved, and enabled research without a connector cannot cite external URLs",async()=>{
 const base={objective:"Build a payments backend for merchants",capabilities:["backend"] as ["backend"],complexity:3 as const};
 const solo=(compiled:Awaited<ReturnType<typeof compileBriefToProjectPlan>>)=>{const t=compiled.tasks.find(x=>x.contract.validators.includes("research-evidence"))!;return {t,plan:{...compiled,tasks:[{...t,dependencies:[],review:undefined}]}};};
 const withConnector=solo(await compileBriefToProjectPlan({...base,projectId:"rs1",research:{enabled:true,maxSourceAgeDays:3650,connectors:[{kind:"static",path:"benchmarks/research-corpus.json"}]}}));
 const halluc=await new ProjectOrchestrator(selectorFor(()=>usage(citing("https://made-up.example/report"))),await tmpState()).run(withConnector.plan);
 assert.deepEqual(halluc.failed,[withConnector.t.id]);
 const state=await tmpState(),noConnector=solo(await compileBriefToProjectPlan({...base,projectId:"rs2",research:{enabled:true,maxSourceAgeDays:3650,connectors:[]}}));
 assert.equal(noConnector.t.contract.params.externalResearch,false);
 const failed=await new ProjectOrchestrator(selectorFor(()=>usage(citing("https://vendor.example/pricing"))),state).run(noConnector.plan);
 assert.deepEqual(failed.failed,[noConnector.t.id]);assert.match((await state.executions.list("rs2")).find(r=>r.status==="FAILED")!.error??"",/no research connector retrieved/);
});

test("connectors are pluggable: static corpus, http-json and custom kinds share one interface",async()=>{
 const {StaticConnector,HttpJsonConnector,ConnectorRegistry,defaultConnectorRegistry,gatherResearch,renderRetrieved}=await import("../src/research-connectors.js");
 const staticDocs=await new StaticConnector("benchmarks/research-corpus.json").search("payment card checkout",{maxResults:3});
 assert.ok(staticDocs[0].url.includes("pcisecuritystandards")&&staticDocs.length<=3);
 assert.deepEqual(await new StaticConnector("benchmarks/research-corpus.json").search("zebra unrelated",{maxResults:3}),[]);
 const original=globalThis.fetch;let seenAuth="",seenQuery="";
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{seenAuth=new Headers(init?.headers).get("authorization")??"";seenQuery=new URL(String(input)).searchParams.get("q")??"";return new Response(JSON.stringify({results:[{url:"https://remote.example/a",title:"Remote A",excerpt:"x",published:"2026-01-01"}]}),{status:200});}) as typeof fetch;
 try{
  const docs=await new HttpJsonConnector("https://search.example/api",1000,"tok").search("hello world",{maxResults:2});
  assert.equal(seenAuth,"Bearer tok");assert.equal(seenQuery,"hello world");assert.equal(docs[0].title,"Remote A");
 }finally{globalThis.fetch=original;}
 const custom=new ConnectorRegistry().register("mine",()=>({name:"mine",async search(){return [{url:"https://mine.example/x",title:"Mine",excerpt:"custom source"}];}}));
 const docs=await gatherResearch([custom.create({kind:"mine"} as never),new StaticConnector("benchmarks/research-corpus.json")],["payment card"],{now:new Date("2026-10-08")});
 assert.ok(docs.some(d=>d.connector==="mine"&&d.authority==="MEDIUM"&&d.retrieved==="2026-10-08")&&docs.some(d=>d.connector==="static"));
 assert.equal(docs.length,new Set(docs.map(d=>d.url)).size,"duplicates are dropped");
 assert.match(renderRetrieved(docs),/\[S1\][\s\S]*retrieved: 2026-10-08/);assert.deepEqual(defaultConnectorRegistry().kinds().sort(),["http-json","static"]);
 assert.throws(()=>defaultConnectorRegistry().create({kind:"nope"} as never),/not registered/);
});

test("requirement parsing accepts the forms real models produce (suffixed AC IDs, bold labels, basis stated inline) but still demands evidence for FACTs",()=>{
 const body="- [REQ-004] **FACT**: Shoppers can search products (product-plan P2)\n  - [AC-004.1a] **(new)** Given a query, when searching, then matching products are listed.\n- [REQ-005] FACT: Payment uses a hosted card form per research C9.\n  - [AC-005.1] Given checkout when paying then no card data touches our servers.\n- [REQ-006] FACT: The shop is fast.\n  - [AC-006.1] Given load then fast.";
 const parsed=parseRequirements(requirements(body));
 assert.deepEqual(parsed.requirements.map(r=>[r.id,r.basis,r.acceptance.map(a=>a.id)]),[["REQ-004","FACT",["AC-004.1a"]],["REQ-005","FACT",["AC-005.1"]],["REQ-006","FACT",["AC-006.1"]]]);
 assert.deepEqual(parsed.malformed,[]);
 const problems=runValidators(["requirements-ids"],requirements(body),{params:{}}).problems;
 assert.deepEqual(problems.filter(p=>/FACT but names no basis/.test(p)).map(p=>p.slice(0,7)),["REQ-006"],"only the FACT without any reference is rejected");
});

test("a response is repaired up to two times before the attempt fails, with all tokens accounted",async()=>{
 const state=await tmpState();let calls=0;
 const contract={sections:["Deliverables","Decisions","Evidence","Blockers","Handoff","Requirements"],verdict:false,validators:["requirements-ids"],params:{}};
 const answers=["## Deliverables\nx","## Deliverables\nx\n## Decisions\nNone.\n## Evidence\ne\n## Blockers\nNone.\n## Handoff\nh\n## Requirements\n- [REQ-001] FACT: x",requirements("- [REQ-001] FACT: x (basis: brief)\n  - [AC-001.1] Given y when z then w.")];
 const summary=await new ProjectOrchestrator(selectorFor(()=>usage(answers[Math.min(calls++,2)])),state).run(plan("rr2",[task("ba",{contract})]));
 assert.deepEqual(summary.completed,["ba"]);assert.equal(calls,3);
 assert.equal((await state.executions.list("rr2")).find(r=>r.status==="SUCCEEDED")!.inputTokens,30);
});
