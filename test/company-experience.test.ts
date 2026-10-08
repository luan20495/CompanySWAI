import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CompanyExperienceStore,specificityProblem} from "../src/company-experience.js";
import {PATTERNS,Retrospective,type CandidateValue} from "../src/retrospective.js";
import {fakeAnthropicKey} from "./helpers.js";

const retro=(projectId:string,candidates:CandidateValue[],extra:Record<string,unknown>={})=>Retrospective.parse({projectId,createdAt:new Date().toISOString(),totalRuns:1,failures:0,paused:1,inputTokens:1,outputTokens:1,actualCost:0,lessons:candidates.map(c=>c.pattern),candidates,...extra});
const capacity:CandidateValue={pattern:PATTERNS.capacity,scope:"company",evidence:["1 capacity pause(s)"]};
const store=async()=>new CompanyExperienceStore(join(await mkdtemp(join(tmpdir(),"companyswai-experience-")),"experience.json"));

test("a lesson is only a candidate after one project and validated after two distinct projects",async()=>{
 const s=await store();
 await s.observe(retro("p1",[capacity]));assert.deepEqual(await s.validatedLessons(),[]);assert.equal((await s.list())[0].status,"CANDIDATE");
 await s.observe(retro("p1",[capacity]));assert.deepEqual(await s.validatedLessons(),[],"the same project twice is still one project");
 await s.observe(retro("p2",[capacity]));
 assert.deepEqual(await s.validatedLessons(),[{pattern:PATTERNS.capacity,scope:"company"}]);
 const item=(await s.list())[0];assert.equal(item.reviewedBy,"validator");assert.deepEqual(item.projects,["p1","p2"]);assert.ok(item.evidence.length>0);
});

test("project-specific facts are rejected and never promoted, no matter how often they repeat",async()=>{
 const s=await store();
 const specific:CandidateValue[]=[
  {pattern:"The acme-shop checkout must use Stripe webhooks",scope:"company",evidence:["x"]},
  {pattern:"Edit src/payments/stripe.ts before launch",scope:"company",evidence:["x"]},
  {pattern:"See https://internal.example.com/runbook for steps",scope:"company",evidence:["x"]},
  {pattern:"Budget for the migration is $12000 per quarter",scope:"company",evidence:["x"]},
  {pattern:"Ask ops@example.com for the key",scope:"company",evidence:["x"]},
  {pattern:"Use key "+fakeAnthropicKey()+" for staging",scope:"company",evidence:["x"]}
 ];
 for(const project of ["acme-shop","p2","p3"])await s.observe(retro(project,specific));
 assert.deepEqual(await s.validatedLessons(),[]);
 const items=await s.list();assert.equal(items.length,specific.length);assert.ok(items.every(i=>i.status==="REJECTED"&&i.reason));
 assert.equal(specificityProblem({pattern:"Prefer small reviewable tasks",scope:"company",evidence:["x"]},["acme-shop"]),undefined);
});

test("a lesson naming one of its own projects is rejected once that project is observed",async()=>{
 const s=await store(),named:CandidateValue={pattern:"Keep the zeta-billing cache warm",scope:"company",evidence:["x"]};
 await s.observe(retro("zeta-billing",[named]));assert.equal((await s.list())[0].status,"REJECTED");
});

test("role scoped experience only reaches that role and unknown roles are rejected",async()=>{
 const s=await store(),scoped:CandidateValue={pattern:PATTERNS.revisions("backend-engineer"),scope:"role:backend-engineer",evidence:["2 verdicts"]};
 const bogus:CandidateValue={pattern:"Be more careful",scope:"role:not-an-agent",evidence:["x"]};
 const known={knownRoles:["backend-engineer","reviewer"]};
 await s.observe(retro("p1",[scoped,bogus]),known);await s.observe(retro("p2",[scoped,bogus]),known);
 assert.deepEqual((await s.lessonsFor("backend-engineer")).map(x=>x.scope),["role:backend-engineer"]);
 assert.deepEqual(await s.lessonsFor("reviewer"),[]);assert.deepEqual(await s.lessonsFor(),[]);
 assert.equal((await s.list()).find(i=>i.scope==="role:not-an-agent")?.status,"REJECTED");
});

test("dry runs never teach the company and legacy v1 files migrate",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"companyswai-experience-")),path=join(dir,"e.json"),s=new CompanyExperienceStore(path);
 await s.observe(retro("d1",[capacity],{dryRun:true}));await s.observe(retro("d2",[capacity],{dryRun:true}));
 assert.deepEqual(await s.list(),[]);
 await writeFile(path,JSON.stringify({version:1,items:[{lesson:PATTERNS.capacity,projects:["a","b"],observations:2,status:"VALIDATED",updatedAt:new Date().toISOString()}]}));
 assert.deepEqual(await s.validatedLessons(),[{pattern:PATTERNS.capacity,scope:"company"}]);
 await s.observe(retro("c",[capacity]));assert.equal(JSON.parse(await readFile(path,"utf8")).version,2);
});
