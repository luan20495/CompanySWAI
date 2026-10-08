import {execFileSync} from "node:child_process";
import {existsSync} from "node:fs";
import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {MarkdownAgentRegistry,activationMatches} from "./md-agent-loader.js";
import {loadCompanyMarkdown} from "./company.js";
import {ProjectBrief} from "./work-planner.js";
import {ProjectPlan} from "./project.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";
import {loadRuntimeConfig} from "./runtime.js";
import {MEMORY_FILES} from "./project-memory.js";
import {containsSecret} from "./secrets.js";

const problems:string[]=[],check=(ok:boolean,message:string)=>{if(!ok)problems.push(message);};

// 1. Exactly the eleven declared agents, no stale or duplicate definitions.
const registry=new MarkdownAgentRegistry(),agents=await registry.loadAll();
check(agents.length===11,"Expected exactly 11 declared agents, found "+agents.length);
const declared=new Set(agents.map(a=>a.id));
const agentDirs=(await readdir("agents",{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name);
for(const dir of agentDirs)check(declared.has(dir),"agents/"+dir+" is not listed in agents/AGENTS.md (stale definition)");
const usedSkills=new Set(agents.flatMap(a=>a.skills));
for(const file of (await readdir("skills")).filter(f=>f.endsWith(".md")))check(usedSkills.has(file.replace(/\.md$/,"")),"skills/"+file+" is not used by any agent (stale skill)");

// 2. Activation, reviewers and the artifact graph come from Markdown and must be coherent.
for(const agent of agents){
 try{activationMatches(agent.activation,[],1);}catch(e){check(false,agent.id+": "+(e as Error).message);}
 if(agent.reviewedBy!=="none"){
  const reviewer=agents.find(a=>a.id===agent.reviewedBy);
  check(reviewer?.mode==="reviewer",agent.id+" is reviewed by '"+agent.reviewedBy+"' which is not a reviewer agent");
  check(agent.reviewedBy!==agent.id,agent.id+" would review itself");
 }
}
check(agents.some(a=>a.mode==="reviewer"),"No reviewer agent is declared");
const producers=new Map<string,string[]>();
for(const agent of agents)for(const artifact of agent.produces)producers.set(artifact,[...(producers.get(artifact)??[]),agent.id]);
for(const agent of agents)for(const required of agent.requires)check(producers.has(required),"No agent produces required artifact "+required+" for "+agent.id);
const visiting=new Set<string>(),done=new Set<string>();
const visit=(id:string,path:string[])=>{
 if(done.has(id))return;
 if(visiting.has(id)){check(false,"Artifact dependency cycle: "+[...path,id].join(" -> "));return;}
 visiting.add(id);
 const agent=agents.find(a=>a.id===id)!;
 for(const artifact of [...agent.requires,...agent.optionalRequires])for(const producer of producers.get(artifact)??[])if(producer!==id)visit(producer,[...path,id]);
 visiting.delete(id);done.add(id);
};
for(const agent of agents)visit(agent.id,[]);

// 3. Company Markdown: contract and memory routing.
const company=await loadCompanyMarkdown();
for(const [artifact,file] of Object.entries(company.memory.routes)){
 check(producers.has(artifact),"company/MEMORY.md routes unknown artifact '"+artifact+"'");
 check((MEMORY_FILES as readonly string[]).includes(file),"company/MEMORY.md routes to unknown memory file "+file);
}
check((MEMORY_FILES as readonly string[]).includes(company.memory.fallback),"company/MEMORY.md fallback is not a memory file");
check(company.contract.sections.join()==="Deliverables,Decisions,Evidence,Blockers,Handoff","company/OUTPUT-CONTRACT.md must define Deliverables, Decisions, Evidence, Blockers, Handoff in that order");

// 4. Examples and provider configuration parse and compile.
const brief=ProjectBrief.parse(JSON.parse(await readFile("examples/project-brief.json","utf8")));
const plan=await compileBriefToProjectPlan(brief);
ProjectPlan.parse(JSON.parse(await readFile("examples/project-plan.json","utf8")));
const profiles=await loadRuntimeConfig("config/providers.example.json");
check(profiles.length>=2,"config/providers.example.json should demonstrate multiple profiles");

// 5. No secrets in tracked files, and local secret files are ignored.
let tracked:string[]=[];
try{tracked=execFileSync("git",["ls-files"],{encoding:"utf8"}).split("\n").filter(Boolean);}catch{problems.push("git is required for the secret scan");}
for(const file of tracked){
 if(!existsSync(file))continue;
 if(/(^|\/)\.env$|^config\/providers\.json$/.test(file))check(false,file+" is tracked but must stay local");
 const text=await readFile(file,"utf8").catch(()=>"");
 if(containsSecret(text))check(false,file+" contains a credential-shaped string");
}
const ignore=existsSync(".gitignore")?await readFile(".gitignore","utf8"):"";
for(const entry of [".env",".companyswai/","config/providers.json","node_modules/"])check(ignore.split(/\r?\n/).includes(entry),".gitignore must list "+entry);
check(existsSync(join("agents","AGENTS.md")),"agents/AGENTS.md is missing");

if(problems.length){console.error(JSON.stringify({status:"failed",problems},null,2));process.exit(1);}
console.log(JSON.stringify({status:"ok",agents:agents.map(a=>a.id),exampleTasks:plan.tasks.map(t=>t.id),providerProfiles:profiles.map(p=>p.id),trackedFilesScanned:tracked.length},null,2));
