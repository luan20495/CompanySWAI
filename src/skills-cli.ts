import {readFile} from "node:fs/promises";
import {SkillRejectedError} from "./skill-registry.js";
import {SkillCatalog} from "./skill-selector.js";
import {catalogView,renderCatalog,renderSkill,skillRows} from "./skills-view.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";

/** Skill registry tooling. Read-only: it never installs, downloads or runs anything. */
const USAGE="Usage: npm run skills -- list [--role r] [--json] | show <skill> [--json] | validate | route <project-brief.json> [--json]";
const [command,...rest]=process.argv.slice(2),flag=(n:string)=>{const i=rest.indexOf(n);return i>=0?rest[i+1]:undefined;},asJson=rest.includes("--json");
const positional=rest.filter((a,i)=>!a.startsWith("--")&&rest[i-1]!=="--role");
const out=(view:unknown,text:string)=>console.log(asJson?JSON.stringify(view,null,2):text);

try{
 if(command==="list"){const role=flag("--role"),view=await catalogView({role});out(view,renderCatalog(view,role));}
 else if(command==="show"){
  const rows=await skillRows(await new SkillCatalog().load()),row=rows.find(r=>r.name===positional[0]);
  if(!row)throw new Error("Unknown skill '"+positional[0]+"'. Known: "+rows.map(r=>r.name).join(", "));
  out(row,renderSkill(row));
 }else if(command==="validate"){
  // Loading is validation: schema, provenance pins, size limits, unsafe-content scan, reference confinement, duplicates and undeclared overlap.
  const catalog=await new SkillCatalog().load();
  out({status:"ok",skills:catalog.length},"OK: "+catalog.length+" dynamic skills valid (schema, provenance, size, safety scan, references, duplicates, overlap)");
 }else if(command==="route"){
  if(!positional[0])throw new Error(USAGE);
  const plan=await compileBriefToProjectPlan(JSON.parse(await readFile(positional[0],"utf8")));
  const rows=plan.tasks.map(t=>({task:t.id,role:t.agentRole,skills:t.skills,skipped:t.skillTrace?.skipped??[],chars:t.skillTrace?.usedChars??0,review:t.review?{role:t.review.role,skills:t.review.skillTrace?.used.map(u=>u.name)??[]}:undefined}));
  out(rows,rows.map(r=>r.task.padEnd(20)+(r.skills.join(", ")||"-")+(r.skipped.length?"   [skipped: "+r.skipped.map(s=>s.name).join(", ")+"]":"")+(r.review?.skills.length?"   review: "+r.review.skills.join(", "):"")).join("\n"));
 }else throw new Error(USAGE);
}catch(error){
 console.error(error instanceof SkillRejectedError?"REJECTED: "+error.message:(error as Error).message);
 process.exitCode=1;
}
