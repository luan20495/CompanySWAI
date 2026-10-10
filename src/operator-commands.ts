import {ProjectPlan} from "./project.js";
import {hashOf} from "./run-store.js";
import {runAutonomous,superviseAutonomous,type AutonomousResult} from "./autonomous.js";
import type {OrchestratorOptions} from "./orchestrator.js";
import type {ProviderSelector} from "./provider-selector.js";
import type {CompanyState} from "./state.js";
import {redact,redactError} from "./secrets.js";
import {
 OperatorError,agentsView,blockersView,handoffsView,loadProjectModel,logEntries,projectSummaries,qaView,resolveProject,resolveTask,reviewsView,statusView,taskDetail,usageView,
 type LoadOptions,type ProjectModel
} from "./operator.js";
import {renderAgents,renderBlockers,renderHandoffs,renderLogs,renderProjects,renderQa,renderReviews,renderStatus,renderTask,renderTasks,renderUsage} from "./operator-render.js";

/**
 * The operator command surface (`npm run operator -- <command> ...`). Read commands only read persisted state. The three
 * mutating commands are deliberately narrow and go through the engine's own mechanisms:
 *   stop      -> a cooperative stop request the running engine honours between task steps
 *   resume    -> the same autonomous pipeline entry, fed the persisted plan (finished work is skipped from the execution log)
 *   priority  -> the plan's own `priority` field, only while no engine is running, only with --apply
 */
export type OperatorContext=LoadOptions&{
 state:CompanyState;
 /** Builds the provider selector (and agent/skill catalogue) for `resume`; absent in read-only hosts. */
 engine?:(options:{dryRun:boolean;runtimePath?:string})=>Promise<{selector:ProviderSelector;knownRoles:string[];knownSkills:string[]}>;
 orchestrator?:OrchestratorOptions;
};
export type OperatorResult={code:number;stdout:string;stderr:string};

export const OPERATOR_USAGE=[
 "Usage: npm run operator -- <command> [project] [options]   (project may be omitted only when exactly one project exists)",
 "  projects                              list known projects and whether an engine is running",
 "  status   [project]                    what is running / waiting / blocked / next",
 "  agents   [project] [--agent role]     per-agent state, current task, outputs, pending handoffs",
 "  tasks    [project] [--state STATE]    every task with its state",
 "  task     [project] <task> [--evidence]  one task; --evidence adds artifacts, gates, commits, attempts, log tail",
 "  handoffs [project] [task] [--latest]  who handed what to whom (artifact-driven; detail with a task or --latest)",
 "  blockers [project]                    why work is not moving",
 "  reviews  [project]                    review verdicts and code gates",
 "  qa       [project]                    requirement -> test results and QA rework",
 "  logs     [project] [task] [--agent role] [--tail N] [--full]   concise latest events; --full adds raw output",
 "  usage    [project]                    tokens, known cost, retries, per-agent calls",
 "  stop     [project] [--reason text]    ask the running engine to stop safely between steps",
 "  resume   [project] [--dry-run] [--runtime file] [--max-parallel N] [--supervise[=minutes]]   continue from the persisted plan and log",
 "  priority [project] <task> [--apply]   preview/apply a higher scheduling priority for a task and its unfinished upstream tasks",
 "Options: --project <id>, --json (machine-readable), --state-dir <dir> (default .companyswai)"
].join("\n");

const BOOLEAN=new Set(["--json","--evidence","--full","--latest","--apply","--dry-run"]);
const VALUED=new Set(["--project","-p","--state","--agent","--task","--tail","--reason","--runtime","--max-parallel","--state-dir"]);
const TASK_STATES=new Set<string>(["DONE","RUNNING","BLOCKED","PAUSED","AWAITING_APPROVAL","WAITING","READY","INTERRUPTED"]);
const usage=(message:string)=>new OperatorError("USAGE",message+"\n"+OPERATOR_USAGE);

function parseArgs(argv:string[]){
 const flags=new Map<string,string|true>(),positionals:string[]=[];
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg.startsWith("--supervise")){flags.set("--supervise",arg.includes("=")?arg.split("=")[1]:true);continue;}
  if(BOOLEAN.has(arg)){flags.set(arg,true);continue;}
  if(VALUED.has(arg)){const value=argv[++i];if(value===undefined||value.startsWith("--"))throw usage(arg+" needs a value");flags.set(arg,value);continue;}
  if(arg.startsWith("-")&&arg.length>1)throw usage("Unknown option "+arg);
  positionals.push(arg);
 }
 return {flags,positionals};
}
const text=(flags:Map<string,string|true>,name:string)=>{const v=flags.get(name);return typeof v==="string"?v:undefined;};

/** Splits positionals into project / argument. An explicit --project wins; two positionals are always project then argument. */
function target(positionals:string[],flags:Map<string,string|true>,arg:"none"|"optional"|"required"){
 const flagged=text(flags,"--project")??text(flags,"-p");
 const max=arg==="none"?1:2;
 if(positionals.length>max)throw usage("Too many arguments: "+positionals.join(" "));
 let project:string|undefined,value:string|undefined;
 if(arg==="none")project=positionals[0];
 else if(positionals.length===2)[project,value]=positionals;
 else if(positionals.length===1){
  if(arg==="required")value=positionals[0];
  else project=positionals[0];// `logs xweb` / `handoffs xweb`: a lone positional is the project; use --task to filter
 }
 if(arg!=="none"&&text(flags,"--task")){if(value&&value!==text(flags,"--task"))throw usage("Task given twice");value=text(flags,"--task");}
 if(flagged&&project&&flagged!==project)throw usage("Project given twice ('"+project+"' and --project "+flagged+")");
 if(arg==="required"&&!value)throw usage("A task id is required");
 return {project:flagged??project,value};
}

const json=(value:unknown)=>JSON.stringify(value,null,2);

async function engineGuard(model:ProjectModel,what:string){
 if(model.live.state==="RUNNING")throw new OperatorError("CONFLICT","An engine is running for '"+model.projectId+"' (pid "+model.live.pid+"). "+what);
}

export type StopOutcome={requested:boolean;projectId:string;runId?:string;inFlight:string[];message:string};
/** Asks the engine run that is live right now to stop between steps. Nothing is killed: in-flight steps finish and are persisted. */
export async function stopProject(state:CompanyState,projectId:string,reason="",options:LoadOptions={}):Promise<StopOutcome>{
 const model=await loadProjectModel(state,projectId,options),inFlight=model.tasks.filter(t=>t.state==="RUNNING").map(t=>t.id);
 if(model.live.state!=="RUNNING"||!model.live.runId)return {requested:false,projectId,inFlight:[],message:"No engine is running for '"+projectId+"' (engine "+model.live.state+"). Nothing to stop; all persisted work is intact and `resume` continues from it."};
 await state.stops.request({projectId,runId:model.live.runId,requestedBy:"operator",reason:reason||"stop requested by operator"});
 return {requested:true,projectId,runId:model.live.runId,inFlight,message:"Stop requested for run "+model.live.runId+". The engine finishes the step it is in ("+(inFlight.join(", ")||"none in flight")+"), starts nothing new, keeps every completed artifact and checkpoint, then exits. `status` shows ENGINE FINISHED when it has stopped; `resume` continues."};
}

export type ResumeOutcome={noop:boolean;message:string;result?:AutonomousResult};
export async function resumeProject(ctx:OperatorContext,projectId:string,options:{dryRun:boolean;runtimePath?:string;supervise?:(run:()=>Promise<AutonomousResult>)=>Promise<AutonomousResult>}):Promise<ResumeOutcome>{
 const {state}=ctx,model=await loadProjectModel(state,projectId,ctx);
 if(!model.plan||!model.run)throw new OperatorError("NO_PLAN","Project '"+projectId+"' has no persisted plan/run to resume. Start it with `npm run company -- <brief.json>`.");
 await engineGuard(model,"Refusing to start a second engine on the same project; use `stop` first if you want it to stop.");
 const finalStatus=model.run.final?.status;
 if(model.run.phase==="DONE"&&(finalStatus==="ACCEPTED"||finalStatus==="ACCEPTED_WITH_RISKS"))return {noop:true,message:"'"+projectId+"' is already complete ("+finalStatus+"); nothing to resume. Completed work is never re-run."};
 if(options.dryRun&&model.records.some(r=>r.status==="SUCCEEDED"&&r.provider!=="dry-run"))throw new OperatorError("CONFLICT","Refusing --dry-run: '"+projectId+"' already has real provider output; a dry run would mix fabricated results into it.");
 if(!ctx.engine)throw new OperatorError("UNSUPPORTED","This host cannot start an engine (no provider runtime configured).");
 const engine=await ctx.engine({dryRun:options.dryRun,runtimePath:options.runtimePath});
 await state.stops.clear(projectId);
 const once=()=>runAutonomous({plan:model.plan!},{state,selector:engine.selector,dryRun:options.dryRun,resumeStored:true,knownRoles:engine.knownRoles,knownSkills:engine.knownSkills,orchestrator:ctx.orchestrator});
 const result=await(options.supervise?options.supervise(once):once());
 return {noop:false,message:"",result};
}

export type PriorityChange={taskId:string;from:number;to:number};
export type PriorityOutcome={applied:boolean;target:string;changes:PriorityChange[];message:string};
/**
 * "Do X first" is expressed with the plan's own `priority` field. The target and every unfinished upstream task are raised above
 * everything else, so the target becomes reachable first; dependencies, tasks, gates and reviews are not touched, finished work
 * stays finished. A live engine already holds its plan, so this is refused while one runs (stop, reprioritise, resume).
 */
export async function prioritizeTask(state:CompanyState,projectId:string,taskId:string,apply:boolean,options:LoadOptions={}):Promise<PriorityOutcome>{
 const model=await loadProjectModel(state,projectId,options),plan=model.plan;
 if(!plan||!model.run)throw new OperatorError("NO_PLAN","Project '"+projectId+"' has no persisted plan, so priorities cannot be changed.");
 const task=resolveTask(model,taskId);
 if(task.state==="DONE")throw new OperatorError("UNSUPPORTED","Task "+task.id+" is already done; there is nothing to prioritise.");
 const open=new Set(model.tasks.filter(t=>t.state!=="DONE").map(t=>t.id)),chain=new Set<string>();
 const visit=(id:string)=>{if(chain.has(id)||!open.has(id))return;chain.add(id);plan.tasks.find(t=>t.id===id)!.dependencies.forEach(visit);};
 visit(task.id);
 const top=Math.max(0,...plan.tasks.filter(t=>!chain.has(t.id)&&open.has(t.id)).map(t=>t.priority));
 const changes:PriorityChange[]=[...chain].sort().map(id=>({taskId:id,from:plan.tasks.find(t=>t.id===id)!.priority,to:Math.max(plan.tasks.find(t=>t.id===id)!.priority,top+1)})).filter(c=>c.to!==c.from);
 const describe=changes.length?changes.map(c=>c.taskId+": "+c.from+" → "+c.to).join(", "):"already ahead of every other unfinished task";
 if(!apply)return {applied:false,target:task.id,changes,message:"Preview (nothing written; add --apply): prioritising "+task.id+" raises "+describe+". Dependencies are unchanged, so upstream work still runs first."};
 await engineGuard(model,"Run `stop`, wait for the engine to finish, apply the priority, then `resume`.");
 if(!changes.length)return {applied:false,target:task.id,changes,message:task.id+" is already ahead of every other unfinished task; nothing to change."};
 const next=ProjectPlan.parse({...plan,tasks:plan.tasks.map(t=>({...t,priority:changes.find(c=>c.taskId===t.id)?.to??t.priority}))});
 // Invariants: only priorities may differ; the dependency graph and task set are exactly as before.
 const shape=(p:typeof plan)=>JSON.stringify(p.tasks.map(t=>[t.id,t.agentRole,[...t.dependencies].sort()]));
 if(shape(next)!==shape(plan))throw new OperatorError("CONFLICT","Refusing to write: the change would alter the task graph.");
 await state.runs.savePlan(next);
 const note="operator: priority raised for "+describe;
 await state.runs.save({...model.run,planHash:hashOf(next),notes:[...model.run.notes,note]});
 await state.memory.recordStatus(projectId,"operator","PRIORITY_CHANGED",describe);
 return {applied:true,target:task.id,changes,message:"Applied: "+describe+". Takes effect on the next `resume` (the plan on disk is what a resume schedules from)."};
}

function summarizeResume(outcome:ResumeOutcome){
 if(outcome.noop||!outcome.result)return {text:outcome.message,code:0};
 const r=outcome.result,s=r.summary,f=r.final;
 const lines=["RESUMED: "+r.projectId+"  PHASE: "+r.phase+(r.stopped?"  STOPPED: "+r.stopped:"")];
 if(s)lines.push("SKIPPED (already complete, not re-run): "+(s.skipped.join(", ")||"none"),"COMPLETED: "+s.completed.join(", "),...(s.waiting.length?["WAITING: "+s.waiting.join(", ")]:[]),...(s.paused.length?["PAUSED (capacity): "+s.paused.join(", ")]:[]),...(s.failed.length?["FAILED: "+s.failed.join(", ")]:[]),...(s.approvalRequired.length?["APPROVAL REQUIRED: "+s.approvalRequired.join(", ")]:[]));
 if(f)lines.push("FINAL: "+f.status+(f.reasons.length?" — "+f.reasons.join("; "):"")+(f.risks.length?" | risks: "+f.risks.join("; "):""));
 else if(r.stopped)lines.push("STOPPED: "+r.stopped);
 const status=f?.status,code=r.stopped?2:status==="FAILED"||status==="FAILED_QA"||status==="BLOCKED"||status==="INCOMPLETE"?1:status==="PARKED"?2:0;
 return {text:lines.join("\n"),code};
}

/** Runs one operator command. Never throws for expected errors: they come back as a message and an exit code. All output is redacted. */
export async function runOperator(argv:string[],ctx:OperatorContext):Promise<OperatorResult>{
 const done=(code:number,stdout:string,stderr=""):OperatorResult=>({code,stdout:stdout?redact(stdout)+(stdout.endsWith("\n")?"":"\n"):"",stderr:stderr?redact(stderr)+"\n":""});
 try{
  const [command,...rest]=argv;
  if(!command||command==="help"||command==="--help")return done(0,OPERATOR_USAGE);
  const {flags,positionals}=parseArgs(rest),asJson=flags.has("--json"),{state}=ctx;
  const emit=(view:unknown,render:()=>string)=>done(0,asJson?json(view):render());
  if(command==="projects"){
   if(positionals.length)throw usage("projects takes no arguments");
   const rows=await projectSummaries(state,ctx);return emit(rows,()=>renderProjects(rows));
  }
  const spec:Record<string,"none"|"optional"|"required">={status:"none",agents:"none",tasks:"none",blockers:"none",reviews:"none",qa:"none",usage:"none",stop:"none",resume:"none",task:"required",priority:"required",handoffs:"optional",logs:"optional"};
  if(!(command in spec))throw usage("Unknown command '"+clipArg(command)+"'");
  const {project,value}=target(positionals,flags,spec[command]);
  const resolved=await resolveProject(state,project),{projectId}=resolved;
  if(command==="stop"){
   const outcome=await stopProject(state,projectId,text(flags,"--reason")??"",ctx);return emit(outcome,()=>outcome.message);
  }
  if(command==="priority"){
   const outcome=await prioritizeTask(state,projectId,value!,flags.has("--apply"),ctx);return emit(outcome,()=>outcome.message);
  }
  if(command==="resume"){
   const maxParallel=text(flags,"--max-parallel"),supervise=flags.get("--supervise");
   const ctxResume:OperatorContext={...ctx,orchestrator:maxParallel?{...ctx.orchestrator,maxParallelTasks:Number(maxParallel)}:ctx.orchestrator};
   if(maxParallel&&!(Number.isInteger(Number(maxParallel))&&Number(maxParallel)>0))throw usage("--max-parallel needs a positive integer");
   const minutes=typeof supervise==="string"?Number(supervise):360;
   if(supervise&&!(minutes>0))throw usage("--supervise needs a positive number of minutes");
   const outcome=await resumeProject(ctxResume,projectId,{dryRun:flags.has("--dry-run"),runtimePath:text(flags,"--runtime"),supervise:supervise?run=>superviseAutonomous(run,{maxWaitMs:minutes*60_000}):undefined});
   const summary=summarizeResume(outcome);
   return done(summary.code,asJson?json({noop:outcome.noop,message:outcome.message,summary:outcome.result?.summary,final:outcome.result?.final,stopped:outcome.result?.stopped}):summary.text);
  }
  const model=await loadProjectModel(state,projectId,ctx);
  switch(command){
   case "status":{const view=statusView(model);return emit(view,()=>renderStatus(view,resolved.implicit));}
   case "usage":{const view=usageView(model);return emit(view,()=>renderUsage(view));}
   case "tasks":{
    const filter=text(flags,"--state")?.toUpperCase();
    if(filter&&!TASK_STATES.has(filter))throw usage("--state must be one of "+[...TASK_STATES].join(", "));
    const tasks=filter?model.tasks.filter(t=>t.state===filter):model.tasks;return emit(tasks,()=>renderTasks(tasks));
   }
   case "task":{const view=await taskDetail(state,model,value!,flags.has("--evidence"));return emit(view,()=>renderTask(view));}
   case "agents":{
    let agents=await agentsView(state,model);const only=text(flags,"--agent");
    if(only){agents=agents.filter(a=>a.role===only);if(!agents.length)throw new OperatorError("UNKNOWN_AGENT","Unknown agent '"+clipArg(only)+"'. Agents: "+(await agentsView(state,model)).map(a=>a.role).join(", ")+".");}
    return emit(agents,()=>renderAgents(agents));
   }
   case "handoffs":{
    let handoffs=await handoffsView(state,model);
    if(value)handoffs=handoffs.filter(h=>h.task===resolveTask(model,value).id);
    const detail=Boolean(value)||flags.has("--latest");
    if(flags.has("--latest"))handoffs=handoffs.slice(-1);
    return emit(handoffs,()=>renderHandoffs(handoffs,detail));
   }
   case "blockers":{const view=await blockersView(state,model);return emit(view,()=>renderBlockers(view));}
   case "reviews":{const view=await reviewsView(state,model);return emit(view,()=>renderReviews(view));}
   case "qa":{const view=await qaView(state,model);return emit(view,()=>renderQa(view));}
   case "logs":{
    const full=flags.has("--full"),tailArg=text(flags,"--tail"),tail=tailArg?Number(tailArg):full?Number.MAX_SAFE_INTEGER:15;
    if(tailArg&&!(Number.isInteger(tail)&&tail>0))throw usage("--tail needs a positive integer");
    const agent=text(flags,"--agent");
    if(agent&&!model.plan?.tasks.some(t=>t.agentRole===agent||t.review?.role===agent))throw new OperatorError("UNKNOWN_AGENT","Unknown agent '"+clipArg(agent)+"'.");
    const taskId=value?resolveTask(model,value).id:undefined,entries=logEntries(model,{taskId,agentRole:agent,full}),shown=entries.slice(-tail);
    const location=state.root+"/executions/"+projectId+"/records.jsonl, "+state.root+"/telemetry/"+projectId+"/events.jsonl";
    return emit(shown,()=>renderLogs(entries,{tail,full,total:entries.length,location}));
   }
  }
  throw usage("Unhandled command "+command);
 }catch(error){
  if(error instanceof OperatorError&&error.code==="UNKNOWN_PROJECT"&&argv[0]&&["logs","handoffs"].includes(argv[0]))error.message+=" (to filter by task: `"+argv[0]+" <project> <task>` or `--task <id>`)";
  if(error instanceof OperatorError)return done(error.code==="USAGE"||error.code==="AMBIGUOUS_PROJECT"?2:1,"",error.code+": "+error.message);
  return done(1,"","ERROR: "+redactError(error));
 }
}
const clipArg=(text:string)=>text.length>60?text.slice(0,59)+"…":text;
