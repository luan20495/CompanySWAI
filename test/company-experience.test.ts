import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,readdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CompanyExperienceStore,confidenceOf,rejectionReason} from "../src/company-experience.js";
import {loadLearningPolicy} from "../src/company.js";
import {PATTERNS,Retrospective,type CandidateValue} from "../src/retrospective.js";
import {fakeAnthropicKey} from "./helpers.js";

const retro=(projectId:string,candidates:Array<Partial<CandidateValue>&{pattern:string}>,extra:Record<string,unknown>={})=>Retrospective.parse({projectId,createdAt:new Date().toISOString(),totalRuns:1,failures:0,paused:1,inputTokens:1,outputTokens:1,actualCost:0,lessons:candidates.map(c=>c.pattern),candidates:candidates.map(c=>({scope:"GLOBAL",kind:"process",evidence:["observed in the run"],...c})),...extra});
const revisions=PATTERNS.revisions("backend-engineer");
const proc:{pattern:string;scope:string}={pattern:"Keep review findings short and actionable so revisions converge in one round.",scope:"GLOBAL"};
const store=async()=>new CompanyExperienceStore(join(await mkdtemp(join(tmpdir(),"companyswai-experience-")),"experience.json"));

test("a lesson is a candidate after one project and validated after two distinct projects with enough confidence",async()=>{
 const s=await store();
 await s.observe(retro("p1",[proc]));assert.deepEqual(await s.validatedLessons(),[]);assert.equal((await s.list())[0].status,"CANDIDATE");
 await s.observe(retro("p1",[proc]));assert.deepEqual(await s.validatedLessons(),[],"the same project twice is still one project");
 await s.observe(retro("p2",[{...proc,evidence:["second independent project saw it too"]}]));
 assert.deepEqual(await s.validatedLessons(),[{pattern:proc.pattern,scope:"GLOBAL"}]);
 const item=(await s.list())[0];assert.equal(item.reviewedBy,"validator");assert.deepEqual(item.projects,["p1","p2"]);assert.ok(item.confidence>=0.6&&item.evidence.length===2);
});

test("confidence rises with independent projects, evidence and repeats, and the threshold is policy (Markdown)",async()=>{
 assert.equal(confidenceOf({projects:["a"],evidence:["x"],observations:1}),Number((0.15+0.35/3+0.2).toFixed(3)));
 assert.ok(confidenceOf({projects:["a","b","c"],evidence:["x","y","z"],observations:6})===1);
 const policy=await loadLearningPolicy();assert.equal(policy.minProjects,2);assert.equal(policy.minConfidence,0.6);
 const s=await store(),strict={...policy,minConfidence:0.95};
 await s.observe(retro("p1",[proc]),{policy:strict});await s.observe(retro("p2",[proc]),{policy:strict});
 assert.equal((await s.list())[0].status,"CANDIDATE","two projects are not enough when the confidence bar is higher");
});

test("temporary provider behaviour never becomes company experience, however often it repeats",async()=>{
 const s=await store();
 const operational=[{pattern:PATTERNS.capacity,kind:"operational" as const},{pattern:PATTERNS.failures,kind:"operational" as const},{pattern:PATTERNS.estimates,kind:"operational" as const},
  {pattern:"Providers hit a rate limit around noon, so schedule big tasks earlier.",kind:"process" as const},{pattern:"The vendor quota resets nightly.",kind:"process" as const}];
 for(const project of ["p1","p2","p3","p4"])await s.observe(retro(project,operational));
 assert.deepEqual(await s.validatedLessons(),[]);const items=await s.list();
 assert.ok(items.every(i=>i.status==="REJECTED"&&/temporary|operational/.test(i.reason??"")),JSON.stringify(items.map(i=>i.reason)));
});

test("project-specific facts, customer detail and secrets are rejected and never promoted",async()=>{
 const s=await store();
 const specific=["The acme-shop checkout must use Stripe webhooks","Edit src/payments/stripe.ts before launch","See https://internal.example.com/runbook for steps","Budget for the migration is $12000 per quarter","Ask ops@example.com for the key","Use key "+fakeAnthropicKey()+" for staging"].map(pattern=>({pattern}));
 for(const project of ["acme-shop","p2","p3"])await s.observe(retro(project,specific));
 assert.deepEqual(await s.validatedLessons(),[]);assert.ok((await s.list()).every(i=>i.status==="REJECTED"&&i.reason));
 const policy=await loadLearningPolicy();
 assert.equal(rejectionReason({pattern:"Prefer small reviewable tasks",scope:"GLOBAL",kind:"process",evidence:["x"]},["acme-shop"],{policy}),undefined);
});

test("scopes: GLOBAL, ROLE, SKILL and DOMAIN lessons only reach the work they apply to; unknown scopes are rejected",async()=>{
 const s=await store(),known={knownRoles:["backend-engineer","reviewer"],knownSkills:["security","flutter"]};
 const cands=[proc,{pattern:revisions,scope:"ROLE:backend-engineer"},{pattern:"Spell out threat assumptions before implementation starts.",scope:"SKILL:security"},{pattern:"Offline sync conflicts need an explicit merge rule in the requirements.",scope:"DOMAIN:mobile-offline"},
  {pattern:"Be more careful",scope:"ROLE:not-an-agent"},{pattern:"Prefer composition over inheritance in widgets.",scope:"SKILL:no-such-skill"}];
 await s.observe(retro("p1",cands),known);await s.observe(retro("p2",cands),known);
 const patterns=async(ctx:Parameters<typeof s.lessonsFor>[0])=>(await s.lessonsFor(ctx)).map(x=>x.scope).sort();
 assert.deepEqual(await patterns({role:"backend-engineer",skills:["security"],domains:["Mobile-Offline"]}),["DOMAIN:mobile-offline","GLOBAL","ROLE:backend-engineer","SKILL:security"]);
 assert.deepEqual(await patterns({role:"reviewer"}),["GLOBAL"]);assert.deepEqual(await patterns({role:"backend-engineer",skills:["flutter"]}),["GLOBAL","ROLE:backend-engineer"]);
 const rejected=(await s.list()).filter(i=>i.status==="REJECTED").map(i=>i.scope).sort();assert.deepEqual(rejected,["ROLE:not-an-agent","SKILL:no-such-skill"]);
});

test("governance and security lessons wait for explicit approval; weakening controls is rejected outright",async()=>{
 const s=await store();
 const security={pattern:"Require a threat model review before any authentication change ships.",scope:"GLOBAL"};
 const weaken=[{pattern:"Skip review for small changes to save time."},{pattern:"Bypass the quality gate when the deadline is close."},{pattern:"Reduce review to one pass for security fixes."}];
 for(const project of ["p1","p2"])await s.observe(retro(project,[security,...weaken]));
 let items=await s.list();
 assert.equal(items[0].status,"PENDING_APPROVAL");assert.deepEqual(await s.validatedLessons(),[],"unapproved governance lessons are not injected");
 assert.ok(items.slice(1).every(i=>i.status==="REJECTED"&&/weakening/.test(i.reason??"")));
 await assert.rejects(()=>s.decide(1,"approve"),/not PENDING_APPROVAL/);
 await s.decide(0,"approve","alice");items=await s.list();
 assert.equal(items[0].status,"VALIDATED");assert.equal(items[0].reviewedBy,"human:alice");assert.equal((await s.validatedLessons()).length,1);
 await s.observe(retro("p3",[security]));assert.equal((await s.list())[0].reviewedBy,"human:alice","later observations never overturn a person's decision");
 const t=await store();for(const project of ["p1","p2"])await t.observe(retro(project,[security]));
 await t.decide(0,"reject");assert.equal((await t.list())[0].status,"REJECTED");assert.deepEqual(await t.validatedLessons(),[]);
});

test("learning never modifies Markdown rules, gates, budgets or policy",async()=>{
 const hash=async()=>{const h=createHash("sha256");for(const dir of ["company","agents","skills"])for(const f of (await readdir(dir,{recursive:true})).filter(x=>x.endsWith(".md")).sort())h.update(f).update(await readFile(join(dir,f)));return h.digest("hex");};
 const before=await hash(),s=await store();
 for(const project of ["p1","p2","p3"])await s.observe(retro(project,[proc,{pattern:"Require a threat model review before any authentication change ships."}]));
 assert.equal(await hash(),before);
});

test("dry runs never teach the company; legacy v1/v2 files migrate to the current format",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"companyswai-experience-")),path=join(dir,"e.json"),s=new CompanyExperienceStore(path);
 await s.observe(retro("d1",[proc],{dryRun:true}));await s.observe(retro("d2",[proc],{dryRun:true}));assert.deepEqual(await s.list(),[]);
 await writeFile(path,JSON.stringify({version:1,items:[{lesson:proc.pattern,projects:["a","b"],observations:2,status:"VALIDATED",updatedAt:new Date().toISOString()}]}));
 assert.deepEqual(await s.validatedLessons(),[{pattern:proc.pattern,scope:"GLOBAL"}]);
 await writeFile(path,JSON.stringify({version:2,items:[{pattern:revisions,scope:"role:backend-engineer",projects:["a","b"],observations:2,evidence:["x"],status:"VALIDATED",updatedAt:new Date().toISOString()}]}));
 assert.deepEqual(await s.lessonsFor({role:"backend-engineer"}),[{pattern:revisions,scope:"ROLE:backend-engineer"}]);
 await s.observe(retro("c",[proc]));assert.equal(JSON.parse(await readFile(path,"utf8")).version,3);
});
