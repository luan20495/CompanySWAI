import {execFileSync} from "node:child_process";
import {mkdtemp,mkdir,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runAutonomous} from "./autonomous.js";
import {createCapacitySelector,type ProviderSelector} from "./provider-selector.js";
import {DryRunProvider} from "./providers/dry-run.js";
import {CompanyState} from "./state.js";
import {MarkdownAgentRegistry} from "./md-agent-loader.js";
import {SkillCatalog} from "./skill-selector.js";
import type {ProjectBriefInput} from "./work-planner.js";
import type {ModelProvider,ModelRequest} from "./provider.js";

/**
 * Deterministic benchmark project: product, research, requirements, architecture, backend, frontend, QA, review and DevOps,
 * with real git worktrees and gates, double review, an induced rate limit, a forced revision and a crash-and-resume.
 * Dry-run mode (CI) fabricates model answers; live mode runs the same project through a real provider selector.
 */
export type BenchmarkOptions={briefPath?:string;live?:{selector:ProviderSelector;label:string};stateDir?:string};
export type BenchmarkReport={
 mode:"dry-run"|"live";label:string;ok:boolean;failures:string[];
 agents:{declared:number;active:string[]};
 tasks:{planned:number;succeeded:number;failed:number};
 reviews:{runs:number;revisions:number;disagreements:number};
 retries:number;failovers:number;
 resume:{crashInjected:boolean;correct:boolean;duplicateWork:number;firstRunFailed:string[];secondRunCompleted:number};
 providers:Record<string,number>;
 /** `failed` counts failed gate attempts, including ones the task later repaired. */
 gates:{passed:number;failed:number;worktreeCommits:number};
 traceability:{requirements:number;tests:number;qa:string;citations:number;decisions:number};
 final:{status:string;risks:number};
 runtimeMs:number;usage:{inputTokens:number;outputTokens:number;knownCost:number;subscriptionRuns:number};
};

const ok=(code:string)=>({cmd:"node",args:["-e",code]});
const pass=ok("process.exit(0)");

/**
 * Real, dependency-free gates for the live benchmark: every JavaScript file must parse, and `node --test` must run at least
 * one test and pass. Reviewers get genuine executed evidence instead of a no-op command. (Dry-run uses no-op gates because
 * the deterministic provider writes no code.)
 */
export function liveGates(){
 const tests=ok("const {spawnSync}=require('child_process');const env={...process.env};delete env.NODE_TEST_CONTEXT;const r=spawnSync(process.execPath,['--test'],{encoding:'utf8',env});process.stdout.write((r.stdout||'').slice(-1500));process.stderr.write((r.stderr||'').slice(-500));if(r.status!==0||!/# tests [1-9]/.test(r.stdout||''))process.exit(1)");
 const syntax=ok("const fs=require('fs'),cp=require('child_process');const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name.startsWith('.')||e.name==='node_modules'?[]:e.isDirectory()?walk(d+'/'+e.name):[d+'/'+e.name]);const files=walk('.').filter(f=>/\\.(js|mjs)$/.test(f));if(!files.length){console.error('no JavaScript files were delivered');process.exit(1)}for(const f of files){const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0){console.error(f+': '+r.stderr);process.exit(1)}}");
 return {checks:[tests],gates:{typecheck:[syntax],"unit-tests":[tests],"integration-tests":[],lint:[],build:[],security:[]}};
}

async function benchmarkRepo(files:Record<string,string>={}){
 const root=await mkdtemp(join(tmpdir(),"companyswai-benchmark-repo-"));
 const git=(...args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"});
 git("init","-q","-b","main");git("config","user.email","benchmark@example.test");git("config","user.name","Benchmark");git("config","commit.gpgsign","false");
 await mkdir(join(root,"src"),{recursive:true});await writeFile(join(root,"README.md"),"# Benchmark project\n");
 for(const [name,content] of Object.entries(files))await writeFile(join(root,name),content);git("add","-A");git("commit","-qm","base");
 return {root,git};
}

export async function runBenchmark(options:BenchmarkOptions={}):Promise<BenchmarkReport>{
 const started=Date.now(),live=options.live,failures:string[]=[];
 const brief=JSON.parse(await readFile(options.briefPath??(live?"benchmarks/library-brief.json":"benchmarks/commerce-brief.json"),"utf8")) as ProjectBriefInput;
 const repo=await benchmarkRepo(live?{"package.json":JSON.stringify({name:"benchmark-project",private:true,type:"module"},null,2)+"\n"}:{}),state=new CompanyState(options.stateDir??await mkdtemp(join(tmpdir(),"companyswai-benchmark-state-")));
 const real=live?liveGates():undefined;
 const withWorkspace={...brief,workspacePath:repo.root,isolation:"worktree" as const,autoCommit:true,checks:real?.checks??[pass],setup:[],
  gates:real?.gates??{typecheck:[pass],"unit-tests":[pass],"integration-tests":[pass],lint:[pass],build:[pass],security:[pass]}};
 const roles=(await new MarkdownAgentRegistry().loadAll()).map(a=>a.id),skills=(await new SkillCatalog().load()).map(s=>s.name);

 // Fault injection (dry-run only): a rate-limited first profile, one forced revision, and a crash of the QA step on its first attempt.
 let rateLimited=false,qaCrashed=false;const crashTask="qa-engineer";
 const provider=(name:string,limited:boolean):ModelProvider=>{
  const inner=new DryRunProvider("deterministic",{requestChangesFor:["backend-engineer"]});
  return {name,model:name+"-model",async generate(request:ModelRequest){
   if(limited&&!rateLimited){rateLimited=true;throw new Error("429 rate limit exceeded (injected)");}
   if(request.meta?.taskId===crashTask&&request.meta.kind==="maker"&&!qaCrashed){qaCrashed=true;throw new Error("model process died (injected crash)");}
   return inner.generate(request);
  }};
 };
 const common={state:"AVAILABLE" as const,capabilities:["reasoning","product","architecture","coding","design","deployment","testing","review"],contextWindow:200000,maxConcurrency:3};
 const selector:ProviderSelector=live?live.selector:createCapacitySelector([
  {id:"primary",provider:"alpha",model:"alpha-model",qualityTier:5,inputCostPerMillion:3,outputCostPerMillion:15,...common},
  {id:"secondary",provider:"beta",model:"beta-model",qualityTier:4,inputCostPerMillion:1,outputCostPerMillion:5,...common}
 ],(name)=>provider(name,name==="alpha"),{defaultPolicy:"QUALITY_FIRST",unavailableCooldownMs:1,cooldownMs:1});

 const run=()=>runAutonomous({brief:withWorkspace},{state,selector,replan:Boolean(options.stateDir),dryRun:!live,knownRoles:roles,knownSkills:skills,orchestrator:{maxParallelTasks:4}});
 const first=await run();
 const firstFailed=first.summary?.failed??[];
 // Resume: a crashed or parked run is simply run again; finished work must not be repeated.
 const beforeResume=(await state.executions.list(brief.projectId as string)).filter(r=>r.status==="SUCCEEDED").length;
 const second=firstFailed.length||first.final?.status==="PARKED"?await run():first;
 const records=await state.executions.list(brief.projectId as string);
 const succeeded=records.filter(r=>r.status==="SUCCEEDED");
 const duplicates=succeeded.length-new Set(succeeded.map(r=>r.id)).size;
 const makerSuccess=new Map<string,number>();for(const r of succeeded)if(!/--review-/.test(r.taskId))makerSuccess.set(r.taskId,(makerSuccess.get(r.taskId)??0)+1);
 const maxRevisions=Math.max(0,...[...makerSuccess.values()])-1;
 void beforeResume;
 const trace=await state.traceability.load(brief.projectId as string);
 const research=await state.research.load(brief.projectId as string,"researcher");
 const allEvents=await state.telemetry.list(brief.projectId as string);
 const providers:Record<string,number>={};for(const r of succeeded)providers[r.provider+"/"+(r.profileId??r.model)]=(providers[r.provider+"/"+(r.profileId??r.model)]??0)+1;
 const gatePass=succeeded.reduce((n,r)=>n+r.gates.filter(g=>g.status==="PASS").length,0),gateFail=records.reduce((n,r)=>n+r.gates.filter(g=>g.status==="FAIL").length,0);
 const commits=succeeded.filter(r=>r.commitSha).length;
 const final=second.final;
 const summary=second.summary;
 const report:BenchmarkReport={
  mode:live?"live":"dry-run",label:live?.label??"deterministic",ok:true,failures,
  agents:{declared:roles.length,active:[...new Set(second.plan.tasks.map(t=>t.agentRole))]},
  tasks:{planned:second.plan.tasks.length,succeeded:summary?.completed.length??0,failed:summary?.failed.length??0},
  reviews:{runs:records.filter(r=>/--review-/.test(r.taskId)&&r.status==="SUCCEEDED").length,revisions:Math.max(0,maxRevisions),disagreements:(first.summary?.disagreements??0)+(second===first?0:second.summary?.disagreements??0)},
  retries:allEvents.filter(e=>e.type==="provider.failover"||e.type==="provider.retry").length,failovers:allEvents.filter(e=>e.type==="provider.failover").length,
  resume:{crashInjected:!live,correct:duplicates===0&&Boolean(final?.status.startsWith("ACCEPTED")),duplicateWork:duplicates,firstRunFailed:firstFailed,secondRunCompleted:second.summary?.completed.length??0},
  providers,gates:{passed:gatePass,failed:gateFail,worktreeCommits:commits},
  traceability:{requirements:trace.requirements.length,tests:trace.tests.length,qa:trace.qa?.overall??"NOT_RUN",citations:research?.sources.length??0,decisions:trace.decisions.length},
  final:{status:final?.status??"UNKNOWN",risks:final?.risks.length??0},
  runtimeMs:Date.now()-started,
  usage:{inputTokens:records.filter(r=>r.status==="SUCCEEDED").reduce((n,r)=>n+r.inputTokens,0),outputTokens:records.filter(r=>r.status==="SUCCEEDED").reduce((n,r)=>n+r.outputTokens,0),knownCost:Number(records.filter(r=>r.status==="SUCCEEDED").reduce((n,r)=>n+(r.actualCost??0),0).toFixed(6)),subscriptionRuns:records.filter(r=>r.status==="SUCCEEDED"&&r.billing==="subscription").length}
 };
 const expect=(cond:boolean,message:string)=>{if(!cond)failures.push(message);};
 expect(report.agents.declared===11,"exactly 11 core agents must be declared");
 expect(report.tasks.failed===0&&report.tasks.succeeded===report.tasks.planned,"every planned task must succeed");
 expect(Boolean(final?.status.startsWith("ACCEPTED")),"final status must be ACCEPTED*, got "+final?.status);
 expect(duplicates===0,"no successful execution may be duplicated");
 expect(report.traceability.requirements>0&&report.traceability.tests>=report.traceability.requirements&&report.traceability.qa==="PASS","requirements must be traced to passing QA tests");
 expect(report.gates.passed>0,"deterministic gates must have run and passed");
 if(!live)expect(report.gates.failed===0,"no gate may fail in the deterministic benchmark");
 expect(report.gates.worktreeCommits>0,"coding tasks must integrate through isolated worktrees");
 if(!live){
  expect(report.reviews.revisions>=1,"the forced revision must have happened");
  expect(report.retries>=1,"the injected rate limit must have been retried");
  expect(firstFailed.includes(crashTask),"the injected crash must have failed the QA task on the first run");
  expect(report.resume.correct,"resume after the crash must complete without repeating work");
  expect(report.traceability.citations>=1,"research citations must be persisted");
  expect(Object.keys(providers).length>=2,"work must be spread over more than one provider profile");
 }
 report.ok=failures.length===0;
 return report;
}
