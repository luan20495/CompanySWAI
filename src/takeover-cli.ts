import "dotenv/config";
import {loadRuntime} from "./runtime.js";
import {CompanyState} from "./state.js";
import {approveTakeover,runTakeover} from "./takeover.js";
import {fingerprint,takeSnapshot,TakeoverError} from "./takeover-probe.js";
import {buildTakeoverPlan} from "./takeover-plan.js";
import {renderTakeoverStatus} from "./takeover-view.js";
import {ExecOutcome,gateRecord,junitRecords,loadLedger,recordExec} from "./takeover-exec.js";

const USAGE=[
 "Usage: npm run takeover -- <command> [options]",
 "  run <workspace> --project <id> [--focus topic]... [--runtime config/providers.json] [--max-parallel N] [--dry-run]",
 "       read-only audit of an existing repository by the company's roles; ends at AUDIT_COMPLETE_WAITING_APPROVAL",
 "       --dry-run: snapshot and plan only, no model call and no state written",
 "  status [project]     where each takeover stands (read-only)",
 "  report <project>     the takeover report",
 "  approve <project> [--by name]   the explicit go-ahead that unlocks writing to the audited workspace",
 "  evidence add <project> --name <n> --commit <40-hex> --outcome PASS|FAIL|NOT_RUN [--command c] [--summary s] [--log file] [--id id] [--tests N --failures N --errors N --skipped N]",
 "       record a run YOU made (a gate, a suite) for the commit to audit; only before `run`. The engine does not re-run it; it keeps the log's hash",
 "  evidence junit <project> --dir <test-results dir> --commit <40-hex>   one record per JUnit class (TEST-*.xml)",
 "  evidence list <project>   what is recorded",
 "Options: --state-dir <dir> (default .companyswai)"
].join("\n");

const args=process.argv.slice(2),valued=["--project","--focus","--runtime","--state-dir","--max-parallel","--by","--name","--commit","--outcome","--command","--summary","--log","--id","--dir","--tests","--failures","--errors","--skipped"];
const values=(name:string)=>args.flatMap((a,i)=>a===name&&args[i+1]!=null?[args[i+1]]:[]);
const one=(name:string)=>values(name)[0];
const positional=args.filter((a,i)=>!a.startsWith("--")&&!valued.includes(args[i-1]??""));
const [command,target,subject]=positional,state=new CompanyState(one("--state-dir")??".companyswai");

try{
 if(command==="run"){
  const project=one("--project");
  if(!target||!project)throw new Error(USAGE);
  if(args.includes("--dry-run")){
   const snapshot=await takeSnapshot(target,new Date(),values("--focus")),plan=await buildTakeoverPlan(project,snapshot,{focus:values("--focus")}),before=await fingerprint(target),after=await fingerprint(target);
   console.log(JSON.stringify({dryRun:true,project,workspace:snapshot.workspace,head:snapshot.head,branch:snapshot.branch,trackedFiles:snapshot.files.total,dirty:snapshot.dirty.total,byClass:snapshot.files.byClass,docsRead:snapshot.docs.map(d=>d.path),
    tasks:plan.tasks.map(t=>({id:t.id,role:t.agentRole,dependsOn:t.dependencies,promptChars:t.prompt.length,skills:t.skills,reviewedBy:t.review?.role})),targetUnchanged:JSON.stringify(before)===JSON.stringify(after)},null,2));
  }else{
   const runtime=await loadRuntime(one("--runtime")??"config/providers.json"),parallel=one("--max-parallel");
   const result=await runTakeover({state,selector:runtime.selector,projectId:project,workspace:target,focus:values("--focus"),orchestrator:parallel?{maxParallelTasks:Number(parallel)}:undefined});
   console.log(await renderTakeoverStatus(state,project));
   if(result.record.status==="AUDITING"){console.error("parked: "+(result.record.reason??"unfinished")+" (run the same command again to resume)");process.exitCode=2;}
   else if(result.record.status!=="AUDIT_COMPLETE_WAITING_APPROVAL"&&result.record.status!=="APPROVED_FOR_EXECUTION")process.exitCode=1;
  }
 }else if(command==="status"){
  console.log(await renderTakeoverStatus(state,target));
 }else if(command==="report"){
  if(!target)throw new Error(USAGE);
  console.log(await state.takeover.readText(target,"TAKEOVER-REPORT.md")??"No report yet for '"+target+"'.");
 }else if(command==="approve"){
  if(!target)throw new Error(USAGE);
  const record=await approveTakeover(state,target,one("--by")??"owner");
  console.log(JSON.stringify({projectId:record.projectId,status:record.status,approvedBy:record.approvedBy,approvedAt:record.approvedAt,auditedHead:record.auditedHead},null,2));
 }else if(command==="evidence"){
  const project=subject;
  if(!target||!project)throw new Error(USAGE);
  const commit=one("--commit"),num=(name:string)=>one(name)==null?undefined:Number(one(name));
  if(target==="add"){
   const name=one("--name"),outcome=ExecOutcome.parse(one("--outcome"));
   if(!name||!commit)throw new Error(USAGE);
   const counts=num("--tests")==null?undefined:{tests:num("--tests")!,failures:num("--failures")??0,errors:num("--errors")??0,skipped:num("--skipped")??0};
   const ledger=await recordExec(state.takeover,project,[await gateRecord({name,commit,outcome,command:one("--command"),summary:one("--summary"),log:one("--log"),id:one("--id"),counts})]);
   console.log("recorded; "+ledger.records.length+" record(s) for '"+project+"'");
  }else if(target==="junit"){
   const dir=one("--dir");
   if(!dir||!commit)throw new Error(USAGE);
   const records=await junitRecords(dir,commit),ledger=await recordExec(state.takeover,project,records);
   console.log("recorded "+records.length+" JUnit class(es) ("+records.filter(r=>r.outcome==="PASS").length+" PASS, "+records.filter(r=>r.outcome==="FAIL").length+" FAIL, "+records.filter(r=>r.outcome==="NOT_RUN").length+" NOT_RUN); "+ledger.records.length+" record(s) for '"+project+"'");
  }else if(target==="list"){
   const ledger=await loadLedger(state.takeover,project);
   console.log(ledger.records.length?ledger.records.map(r=>r.commit.slice(0,10)+" "+r.outcome.padEnd(7)+" "+r.id+(r.kind==="gate"&&r.summary?" — "+r.summary:"")).join("\n"):"Nothing recorded for '"+project+"'.");
  }else throw new Error(USAGE);
 }else throw new Error(USAGE);
}catch(error){
 if(error instanceof TakeoverError){console.error(error.code+": "+error.message);process.exitCode=1;}
 else throw error;
}
