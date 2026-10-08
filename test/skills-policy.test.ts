import assert from "node:assert/strict";
import test from "node:test";
import {appliesWhen} from "../src/applies.js";
import {compileBriefToProjectPlan} from "../src/plan-compiler.js";
import {parseMarkdownFrontmatter} from "../src/md-agent-loader.js";
import {SkillCatalog,selectSkills,type DynamicSkill} from "../src/skill-selector.js";
import {planCompanyWork} from "../src/work-planner.js";
import {loadCompanyMarkdown} from "../src/company.js";
import {reviewDecision} from "../src/policy.js";

const skill=(over:Partial<DynamicSkill>):DynamicSkill=>({name:"s",appliesTo:["a"],capabilities:[],keywords:[],tags:[],body:"BODY-"+(over.name??"s"),...over});
const signals=(over:Partial<{capabilities:string[];complexity:number;tags:string[];text:string}>={})=>({capabilities:[],complexity:1,tags:[],text:"",...over});

test("exactly the declared specialist skills exist, each with an activation signal and a matching file name",async()=>{
 const catalog=await new SkillCatalog().load();
 assert.deepEqual(catalog.map(s=>s.name).sort(),["accessibility","android","backend-reliability","database","devops","distributed-systems","flutter","frontend-performance","ios","mobile-native","observability","performance","security","testing","ux-research"]);
 assert.ok(catalog.every(s=>s.body.length>200&&s.appliesTo.length>0));
});

test("skill selection is deterministic and keyed on capabilities, tags and whole-word keywords",()=>{
 const catalog=[skill({name:"security",capabilities:["security-critical"],keywords:["auth","password"]}),skill({name:"flutter",tags:["flutter"]}),skill({name:"database",keywords:["sql"]})];
 const run=(s:ReturnType<typeof signals>,agent="a")=>selectSkills(catalog,agent,s).map(x=>x.name);
 assert.deepEqual(run(signals({capabilities:["security-critical"],text:"login with password and auth"})),["security"]);
 assert.deepEqual(run(signals({text:"the author wrote an authority page"})),[],"auth must not match author/authority");
 assert.deepEqual(run(signals({tags:["Flutter"]})),["flutter"]);
 assert.deepEqual(run(signals({text:"uses SQL heavily",tags:["flutter"]})),["database","flutter"]);
 assert.deepEqual(run(signals({text:"sql"}),"other-agent"),[],"skills only apply to the agents they declare");
 const first=JSON.stringify(selectSkills(catalog,"a",signals({capabilities:["security-critical"],text:"password sql",tags:["flutter"]})));
 for(let i=0;i<5;i++)assert.equal(JSON.stringify(selectSkills([...catalog].reverse(),"a",signals({capabilities:["security-critical"],text:"password sql",tags:["flutter"]}))),first,"catalog order never changes the result");
});

test("more signals rank first, the cap is enforced and complexity gates a skill",()=>{
 const many=Array.from({length:6},(_,i)=>skill({name:"k"+i,keywords:["word"]}));
 assert.equal(selectSkills(many,"a",signals({text:"word"})).length,4);
 assert.equal(selectSkills(many,"a",signals({text:"word"}),2).length,2);
 const ranked=selectSkills([skill({name:"one",keywords:["x"]}),skill({name:"two",keywords:["x","y"]})],"a",signals({text:"x y"}));
 assert.deepEqual(ranked.map(s=>s.name),["two","one"]);
 const gated=skill({name:"dist",keywords:["queue"],minComplexity:5});
 assert.deepEqual(selectSkills([gated],"a",signals({text:"queue",complexity:4})),[]);
 assert.deepEqual(selectSkills([gated],"a",signals({text:"queue",complexity:5})).map(s=>s.name),["dist"]);
});

test("compiled plans inject specialist skills only where signals and agent applicability require them",async()=>{
 const secure=await compileBriefToProjectPlan({projectId:"s1",objective:"Build a payment API with password login for customers",capabilities:["backend","security-critical"],complexity:3});
 const by=(id:string)=>secure.tasks.find(t=>t.agentRole===id)!;
 assert.ok(by("backend-engineer").skills.includes("security"));assert.ok(by("backend-engineer").system.includes("# Security"));
 assert.ok(!by("product-lead").skills.includes("security"),"agents a skill does not apply to never receive it");
 assert.ok(!by("backend-engineer").skills.includes("android")&&!by("backend-engineer").skills.includes("flutter"));
 assert.ok(!by("backend-engineer").system.includes("# Flutter"));
 const mobile=await compileBriefToProjectPlan({projectId:"m1",objective:"Build a field-service app",capabilities:["mobile"],complexity:2,mobileSkills:["flutter","dart"],signals:["android"]});
 const mob=mobile.tasks.find(t=>t.agentRole==="mobile-engineer")!;
 for(const name of ["flutter","android","mobile-native"])assert.ok(mob.skills.includes(name),name);
 assert.ok(!mob.skills.includes("ios"),"ios stays out without an ios signal");
 const plain=await compileBriefToProjectPlan({projectId:"p1",objective:"Build a small internal tool",capabilities:["backend"],complexity:2});
 assert.deepEqual(plain.tasks.find(t=>t.agentRole==="backend-engineer")!.skills.filter(s=>["security","devops","ios","android","flutter"].includes(s)),[]);
 const again=await compileBriefToProjectPlan({projectId:"p1",objective:"Build a small internal tool",capabilities:["backend"],complexity:2});
 assert.deepEqual(plain.tasks.map(t=>t.skills),again.tasks.map(t=>t.skills));
});

test("reviewers get only the specialist skills relevant to the work under review",async()=>{
 const plan=await compileBriefToProjectPlan({projectId:"r1",objective:"Build a payment API with password login",capabilities:["backend","security-critical"],complexity:3,mode:"MAX_QUALITY"});
 const backend=plan.tasks.find(t=>t.agentRole==="backend-engineer")!;
 assert.ok(backend.review);
 for(const slot of backend.review!.slots){assert.ok(slot.system.includes("# Security"));assert.ok(!slot.system.includes("# Flutter"));}
});

test("quality modes decide who is reviewed and how thoroughly (policy comes from Markdown)",async()=>{
 const md=await loadCompanyMarkdown();
 assert.equal(reviewDecision(md.policy,"FAST","medium"),undefined);
 assert.equal(reviewDecision(md.policy,"FAST","critical")?.level,"NORMAL");
 assert.deepEqual(reviewDecision(md.policy,"BALANCED","medium"),{level:"NORMAL",reviewers:1,maxRounds:2,gates:[]});
 assert.equal(reviewDecision(md.policy,"BALANCED","critical")?.reviewers,2);
 assert.equal(reviewDecision(md.policy,"MAX_QUALITY","high")?.level,"CRITICAL");
 assert.deepEqual(reviewDecision(md.policy,"MAX_QUALITY","critical"),{level:"HIGH_RISK",reviewers:2,maxRounds:4,gates:["checks","qa","security"]});
 const brief={projectId:"q1",objective:"Build a secure commerce backend",capabilities:["backend","security-critical"] as ("backend"|"security-critical")[],complexity:4 as const};
 const count=async(mode:"FAST"|"BALANCED"|"MAX_QUALITY")=>(await compileBriefToProjectPlan({...brief,mode})).tasks.map(t=>t.review?.slots.length??0);
 assert.ok((await count("FAST")).every(n=>n<=1));
 assert.ok((await count("BALANCED")).some(n=>n===2));
 const max=await compileBriefToProjectPlan({...brief,mode:"MAX_QUALITY"});
 const backend=max.tasks.find(t=>t.agentRole==="backend-engineer")!;
 assert.equal(backend.review?.level,"HIGH_RISK");assert.deepEqual(backend.review?.slots.map(s=>s.lens),[undefined,"security"]);
 assert.equal(backend.minQualityTier,4);assert.equal(backend.routing,"QUALITY_FIRST");
 const fast=await compileBriefToProjectPlan({...brief,mode:"FAST",capabilities:["backend"],complexity:2});
 assert.ok(fast.tasks.every(t=>!t.review),"medium-risk FAST projects skip review");assert.equal(fast.tasks[0].routing,"COST_FIRST");
});

test("the architecture is reviewed through an architecture lens with only the applicable categories",async()=>{
 const categories=async(brief:Parameters<typeof planCompanyWork>[0])=>{
  const task=(await planCompanyWork(brief)).tasks.find(t=>t.agentRole==="tech-lead")!;
  const slot=task.review!.slots[0];
  return {lens:slot.lens,validators:slot.contract.validators,list:slot.contract.params.architectureCategories as string[]};
 };
 const backend=await categories({projectId:"a1",objective:"Build an inventory backend service",capabilities:["backend"],complexity:3});
 assert.equal(backend.lens,"architecture");assert.deepEqual(backend.validators,["architecture-review"]);
 for(const c of ["modularity","maintainability","scalability","security","observability","cost","failure-modes","data-integrity"])assert.ok(backend.list.includes(c),c);
 assert.ok(!backend.list.includes("backward-compatibility")&&!backend.list.includes("portability"));
 const mobile=await categories({projectId:"a2",objective:"Build a notes app for phones",capabilities:["mobile"],complexity:2,signals:["brownfield"]});
 assert.ok(mobile.list.includes("portability")&&mobile.list.includes("backward-compatibility"));
 assert.ok(!mobile.list.includes("data-integrity")&&!mobile.list.includes("scalability"));
});

test("appliesWhen evaluates always, capability, signal and complexity terms",()=>{
 const ctx={capabilities:["backend"],complexity:3,tags:["Legacy"]};
 assert.equal(appliesWhen("always",ctx),true);
 assert.equal(appliesWhen("capability:web-ui|backend",ctx),true);
 assert.equal(appliesWhen("capability:web-ui|mobile",ctx),false);
 assert.equal(appliesWhen("complexity>=4|signal:legacy",ctx),true);
 assert.equal(appliesWhen("complexity>=4",ctx),false);
 assert.equal(appliesWhen("signal:brownfield|migration",ctx),false);
});

test("frontmatter JSON values may span several lines",()=>{
 const parsed=parseMarkdownFrontmatter('---\nname: x\nmap: {\n "a":[1,2],\n "b":{"c":true}\n}\nafter: 3\n---\nbody');
 assert.deepEqual(parsed.meta,{name:"x",map:{a:[1,2],b:{c:true}},after:3});
});
