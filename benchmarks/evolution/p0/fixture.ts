import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ProjectPlan,type ProjectPlanInput} from "../../../src/project.js";
import {ExecutionRecord} from "../../../src/execution-record.js";
import {StoredReview} from "../../../src/artifact-store.js";
import {Intervention} from "../../../src/intervention-log.js";
import {hashOf} from "../../../src/run-store.js";
import {LESSONS_HEADER} from "../../../src/plan-compiler.js";

/**
 * Phase 0 golden fixture: a small, entirely synthetic CompanySWAI state directory (no real project, prompt, output or credential)
 * that covers what the scorecard must get right. Deterministic: fixed ids and timestamps, so `build.ts` reproduces it byte for byte.
 *
 *   demo-brief-accepted   plan compiled from a brief, provenance + company version recorded, lessons injected, review PASS, QA PASS
 *   demo-supplied-retry   plan supplied whole (provenance derived), gate failure then repair, review CHANGES_REQUIRED then PASS,
 *                         several log lines per attempt (must be counted once), legacy token records without tokenSource
 *   demo-qa-conflict      a QA task that says FAIL while the run is ACCEPTED (must be flagged, not changed)
 *   demo-failed-timeout   provider timeout (no usage → UNKNOWN tokens), then a gate failure; run FAILED; one torn log line
 *   demo-dryrun           dry-run provider: tokens are fixture estimates, never counted as real usage
 *   demo-running          an engine that started and has not finished (pid decides RUNNING vs INTERRUPTED)
 */
export const RUNNING_PID=424242;
export const FIXTURE_NOW=Date.parse("2026-01-20T12:30:00.000Z");
const T=(day:number,h:number,m:number,s=0)=>new Date(Date.UTC(2026,0,day,h,m,s)).toISOString();

const SYSTEM="# Synthetic fixture company\nRole instructions for the fixture.";
const task=(id:string,role:string,extra:Record<string,unknown>={})=>({id,agentRole:role,department:"engineering",dependencies:[] as string[],system:SYSTEM,prompt:"Synthetic task "+id,inputRefs:[],maxTokens:4096,capabilities:["reasoning"],estimatedInputTokens:1000,estimatedOutputTokens:1000,...extra});
const review={role:"reviewer",department:"quality",system:SYSTEM+" (reviewer)",capabilities:["review"],estimatedInputTokens:1000,estimatedOutputTokens:500,maxTokens:4096,maxRounds:2};
const planOf=(projectId:string,tasks:ReturnType<typeof task>[])=>ProjectPlan.parse({projectId,budget:{},tasks} as ProjectPlanInput);
const out=(body:string)=>"## Deliverables\n"+body+"\n\n## Decisions\nNone.\n\n## Evidence\nSynthetic.\n\n## Blockers\nNone.\n\n## Handoff\nNext.";
const qaOut=(status:string)=>"## Deliverables\nQA report.\n\n## QA Status\n"+status+"\n\n## Traceability\n- [REQ-1] -> [T-1] "+(status.startsWith("FAIL")?"FAIL: deviates | evidence: synthetic | owner: build":"PASS: works | evidence: synthetic")+"\n\n## Evidence\nSynthetic.\n\n## Blockers\nNone.\n\n## Handoff\nDone.";
const version={gitSha:"0".repeat(40),dirty:false,organizationHash:"f1x7ure0000000a1",organizationFiles:3,packageVersion:"0.1.0",at:T(10,9,0)};

type Line=Record<string,unknown>;
/** One attempt as the engine writes it: STARTED, then (for model output) CHECKPOINTED, then the terminal line. */
function attempt(p:{id:string;projectId:string;taskId:string;role:string;start:string;end:string;status:"SUCCEEDED"|"FAILED";output?:string;inputTokens?:number;outputTokens?:number;provider?:string;model?:string;billing?:string;tokenSource?:string;cacheRead?:number;cacheCreation?:number;gates?:Array<{name:string;status:string;detail?:string}>;error?:string;checkpoint?:boolean}):Line[]{
 const base={id:p.id,projectId:p.projectId,taskId:p.taskId,agentRole:p.role,department:"engineering",provider:p.provider??"claude-code",model:p.model??"claude-sonnet-fixture",startedAt:p.start,billing:p.billing??"subscription",profileId:"fixture-profile"};
 const usage=p.inputTokens!=null?{inputTokens:p.inputTokens,outputTokens:p.outputTokens??0,...(p.tokenSource?{tokenSource:p.tokenSource}:{}),...(p.cacheRead!=null?{cacheReadInputTokens:p.cacheRead}:{}),...(p.cacheCreation!=null?{cacheCreationInputTokens:p.cacheCreation}:{})}:{};
 const lines:Line[]=[{...base,status:"STARTED"}];
 if(p.checkpoint!==false&&p.output)lines.push({...base,...usage,status:"CHECKPOINTED",finishedAt:p.end,output:p.output});
 lines.push({...base,...usage,status:p.status,finishedAt:p.end,output:p.status==="SUCCEEDED"?p.output??"":p.output??"",gates:p.gates??[],...(p.error?{error:p.error}:{})});
 return lines.map(l=>ExecutionRecord.parse(l));
}
const reviewRec=(projectId:string,taskId:string,n:number,verdict:"PASS"|"CHANGES_REQUIRED",at:string)=>StoredReview.parse({id:taskId+"--review-"+n+"-0-fixture",projectId,taskId,reviewerRole:"reviewer",verdict,body:verdict+"\n\n## Evidence\nSynthetic.",createdAt:at});

export async function buildFixture(root:string){
 const files=new Map<string,string>();
 const put=(path:string,value:unknown)=>files.set(path,typeof value==="string"?value:JSON.stringify(value,null,2)+"\n");
 const jsonl=(lines:unknown[])=>lines.map(l=>JSON.stringify(l)).join("\n")+"\n";
 const runState=(projectId:string,plan:ReturnType<typeof planOf>,extra:Record<string,unknown>)=>({version:1,projectId,planHash:hashOf(plan),notes:[],...extra});
 const final=(status:string,qa:string,start:string,completed:number,failed=0)=>({status,reasons:["fixture"],risks:[],qa:{status:qa,required:qa!=="NOT_RUN"},tasks:{completed,failed,paused:0,waiting:0,approvalRequired:0},at:start});

 // demo-brief-accepted
 {
  const id="demo-brief-accepted";
  const plan=planOf(id,[
   task("api","backend-engineer",{system:SYSTEM+"\n\n"+LESSONS_HEADER+"\n- Synthetic lesson.",review:{...review}}),
   task("verify","qa-engineer",{dependencies:["api"],contract:{sections:["Deliverables","QA Status","Traceability","Evidence","Blockers","Handoff"],validators:["qa-traceability"]}})
  ]);
  put("runs/"+id+".plan.json",plan);
  put("runs/"+id+".json",runState(id,plan,{briefHash:"b1ef0000000000a1",completedPhases:["PLAN","ESTIMATE","APPROVAL","EXECUTE","FINALIZE","RETROSPECTIVE","DONE"],phase:"DONE",startedAt:T(10,9,0),updatedAt:T(10,9,20),
   final:final("ACCEPTED","PASS",T(10,9,20),2),companyVersion:version,provenance:{source:"brief",lessonsInjected:1,lessonsAvailable:1}}));
  put("executions/"+id+"/records.jsonl",jsonl([
   ...attempt({id:"a1000000-0000-4000-8000-000000000001",projectId:id,taskId:"api",role:"backend-engineer",start:T(10,9,1),end:T(10,9,6),status:"SUCCEEDED",output:out("API done."),inputTokens:12000,outputTokens:3000,tokenSource:"reported",cacheRead:8000,cacheCreation:1000,gates:[{name:"unit-tests",status:"PASS"}]}),
   ...attempt({id:"a1000000-0000-4000-8000-000000000002",projectId:id,taskId:"api--review-1-0",role:"reviewer",start:T(10,9,7),end:T(10,9,9),status:"SUCCEEDED",output:"PASS\n\n## Evidence\nSynthetic.",inputTokens:6000,outputTokens:800,tokenSource:"reported",cacheRead:0,cacheCreation:0}),
   ...attempt({id:"a1000000-0000-4000-8000-000000000003",projectId:id,taskId:"verify",role:"qa-engineer",start:T(10,9,10),end:T(10,9,19),status:"SUCCEEDED",output:qaOut("PASS — every requirement checked."),inputTokens:9000,outputTokens:2000,tokenSource:"reported",cacheRead:4000,cacheCreation:0})
  ]));
  put("reviews/"+id+"/api--review-1-0-fixture.json",reviewRec(id,"api",1,"PASS",T(10,9,9)));
 }
 // demo-supplied-retry
 {
  const id="demo-supplied-retry";
  const plan=planOf(id,[task("ui","frontend-engineer",{review:{...review}})]),hash=hashOf(plan);
  put("runs/"+id+".plan.json",plan);
  put("runs/"+id+".json",runState(id,plan,{briefHash:hash,completedPhases:["PLAN","ESTIMATE","APPROVAL","EXECUTE","FINALIZE","RETROSPECTIVE","DONE"],phase:"DONE",startedAt:T(11,10,0),updatedAt:T(11,10,40),final:final("ACCEPTED","NOT_RUN",T(11,10,40),1)}));
  put("executions/"+id+"/records.jsonl",jsonl([
   ...attempt({id:"b2000000-0000-4000-8000-000000000001",projectId:id,taskId:"ui",role:"frontend-engineer",start:T(11,10,1),end:T(11,10,8),status:"FAILED",output:out("UI v1."),inputTokens:20000,outputTokens:5000,gates:[{name:"unit-tests",status:"FAIL",detail:"1 test failed"}],error:"Gate 'unit-tests' failed: synthetic assertion"}),
   ...attempt({id:"b2000000-0000-4000-8000-000000000002",projectId:id,taskId:"ui",role:"frontend-engineer",start:T(11,10,8),end:T(11,10,15),status:"SUCCEEDED",output:out("UI v2."),inputTokens:22000,outputTokens:5000,gates:[{name:"unit-tests",status:"PASS"}]}),
   ...attempt({id:"b2000000-0000-4000-8000-000000000003",projectId:id,taskId:"ui--review-1-0",role:"reviewer",start:T(11,10,16),end:T(11,10,18),status:"SUCCEEDED",output:"CHANGES_REQUIRED\n\n## Evidence\nSynthetic.",inputTokens:7000,outputTokens:900}),
   ...attempt({id:"b2000000-0000-4000-8000-000000000004",projectId:id,taskId:"ui",role:"frontend-engineer",start:T(11,10,19),end:T(11,10,30),status:"SUCCEEDED",output:out("UI v3."),inputTokens:25000,outputTokens:6000,gates:[{name:"unit-tests",status:"PASS"}]}),
   ...attempt({id:"b2000000-0000-4000-8000-000000000005",projectId:id,taskId:"ui--review-2-0",role:"reviewer",start:T(11,10,31),end:T(11,10,33),status:"SUCCEEDED",output:"PASS\n\n## Evidence\nSynthetic.",inputTokens:7000,outputTokens:700})
  ]));
  put("reviews/"+id+"/ui--review-1-0-fixture.json",reviewRec(id,"ui",1,"CHANGES_REQUIRED",T(11,10,18)));
  put("reviews/"+id+"/ui--review-2-0-fixture.json",reviewRec(id,"ui",2,"PASS",T(11,10,33)));
 }
 // demo-qa-conflict
 {
  const id="demo-qa-conflict";
  const plan=planOf(id,[task("check","qa-engineer")]),hash=hashOf(plan);
  put("runs/"+id+".plan.json",plan);
  put("runs/"+id+".json",runState(id,plan,{briefHash:hash,completedPhases:["PLAN","ESTIMATE","APPROVAL","EXECUTE","FINALIZE","RETROSPECTIVE","DONE"],phase:"DONE",startedAt:T(12,14,0),updatedAt:T(12,14,10),final:final("ACCEPTED","NOT_RUN",T(12,14,10),1)}));
  put("executions/"+id+"/records.jsonl",jsonl(attempt({id:"c3000000-0000-4000-8000-000000000001",projectId:id,taskId:"check",role:"qa-engineer",start:T(12,14,1),end:T(12,14,9),status:"SUCCEEDED",output:qaOut("FAIL — AC-1 deviates from the specification."),inputTokens:15000,outputTokens:2500})));
 }
 // demo-failed-timeout
 {
  const id="demo-failed-timeout";
  const plan=planOf(id,[task("deploy","devops-sre")]),hash=hashOf(plan);
  put("runs/"+id+".plan.json",plan);
  put("runs/"+id+".json",runState(id,plan,{briefHash:hash,completedPhases:["PLAN","ESTIMATE","APPROVAL"],phase:"EXECUTE",startedAt:T(13,8,0),updatedAt:T(13,8,40),final:final("FAILED","NOT_RUN",T(13,8,40),0,1)}));
  put("executions/"+id+"/records.jsonl",jsonl([
   ...attempt({id:"d4000000-0000-4000-8000-000000000001",projectId:id,taskId:"deploy",role:"devops-sre",start:T(13,8,1),end:T(13,8,11),status:"FAILED",checkpoint:false,error:"claude-code timed out after 600s"}),
   ...attempt({id:"d4000000-0000-4000-8000-000000000002",projectId:id,taskId:"deploy",role:"devops-sre",start:T(13,8,12),end:T(13,8,30),status:"FAILED",output:out("Deploy script."),inputTokens:18000,outputTokens:4000,tokenSource:"reported",gates:[{name:"unit-tests",status:"FAIL"}],error:"Gate 'unit-tests' failed: synthetic script error"})
  ])+"{\"id\":\"torn-line\",\"status\":\n");
 }
 // demo-dryrun
 {
  const id="demo-dryrun";
  const plan=planOf(id,[task("doc","business-analyst")]),hash=hashOf(plan);
  put("runs/"+id+".plan.json",plan);
  put("runs/"+id+".json",runState(id,plan,{briefHash:hash,completedPhases:["PLAN","ESTIMATE","APPROVAL","EXECUTE","FINALIZE","RETROSPECTIVE","DONE"],phase:"DONE",startedAt:T(14,7,0),updatedAt:T(14,7,2),final:final("ACCEPTED","NOT_RUN",T(14,7,2),1)}));
  put("executions/"+id+"/records.jsonl",jsonl(attempt({id:"e5000000-0000-4000-8000-000000000001",projectId:id,taskId:"doc",role:"business-analyst",start:T(14,7,0,10),end:T(14,7,0,11),status:"SUCCEEDED",output:out("Dry-run requirements."),inputTokens:900,outputTokens:120,provider:"dry-run",model:"deterministic",billing:"metered"})));
 }
 // demo-running
 {
  const id="demo-running";
  const plan=planOf(id,[task("build","backend-engineer"),task("check","qa-engineer",{dependencies:["build"]})]),hash=hashOf(plan);
  put("runs/"+id+".plan.json",plan);
  put("runs/"+id+".json",runState(id,plan,{briefHash:hash,completedPhases:["PLAN","ESTIMATE","APPROVAL"],phase:"EXECUTE",startedAt:T(20,12,0),updatedAt:T(20,12,5),companyVersion:version,provenance:{source:"supplied-plan",lessonsInjected:0}}));
  put("executions/"+id+"/records.jsonl",jsonl([ExecutionRecord.parse({id:"f6000000-0000-4000-8000-000000000001",projectId:id,taskId:"build",agentRole:"backend-engineer",provider:"claude-code",model:"claude-sonnet-fixture",status:"STARTED",startedAt:T(20,12,5),billing:"subscription"})]));
  put("telemetry/"+id+"/events.jsonl",jsonl([
   {ts:T(20,12,5),runId:"run-fixture-1",pid:RUNNING_PID,type:"run.started",detail:"BALANCED"},
   {ts:T(20,12,5),runId:"run-fixture-1",pid:RUNNING_PID,type:"task.started",taskId:"build"},
   {ts:T(20,12,5),runId:"run-fixture-1",pid:RUNNING_PID,type:"provider.selected",taskId:"build",profileId:"fixture-profile",provider:"claude-code",model:"claude-sonnet-fixture"}
  ]));
 }
 // Interventions: the log begins on 2026-01-13, so only runs started from then on are covered.
 put("interventions.jsonl",jsonl([
  Intervention.parse({id:"i0000000-0000-4000-8000-000000000001",ts:T(13,7,59),kind:"dispatch",projectId:"demo-failed-timeout",actor:"fixture-owner",actorVerified:false,via:"npm run company",detail:"supplied plan"}),
  Intervention.parse({id:"i0000000-0000-4000-8000-000000000002",ts:T(13,9,0),kind:"redispatch",projectId:"demo-failed-timeout",actor:"fixture-owner",actorVerified:false,via:"npm run intervene",detail:"re-ran the failed deploy by hand"}),
  Intervention.parse({id:"i0000000-0000-4000-8000-000000000003",ts:T(14,6,59),kind:"dispatch",projectId:"demo-dryrun",actor:"fixture-owner",actorVerified:false,via:"npm run company",detail:"brief, dry-run"}),
  Intervention.parse({id:"i0000000-0000-4000-8000-000000000004",ts:T(20,11,59),kind:"dispatch",projectId:"demo-running",actor:"fixture-owner",actorVerified:false,via:"npm run company",detail:"supplied plan"})
 ]));
 for(const [path,content] of files){await mkdir(join(root,path,".."),{recursive:true});await writeFile(join(root,path),content,"utf8");}
 return [...files.keys()].sort();
}
