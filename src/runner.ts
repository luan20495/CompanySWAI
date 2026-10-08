import {randomUUID} from "node:crypto";
import type {ModelProvider} from "./provider.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import type {CompanyState} from "./state.js";
import {condense,contractViolations,isNone,parseAgentOutput,parseReviewVerdict,type ContractRequirement} from "./output-parser.js";
import {LocalRepoWorkspace,WorkspaceError,parseFilePatches,type CheckCommandSpec,type FilePatch,type GateResult,type GateRun} from "./repo-workspace.js";
import {runIsolated} from "./worktrees.js";
import {redact,redactError} from "./secrets.js";
import {runValidators} from "./validators.js";
import {parseArchitectureReview,parseQa,parseRequirements,parseResearch} from "./structured.js";

export type RunTask={
 projectId:string;taskId:string;agentRole:string;department?:string;kind:"maker"|"review";produces?:string[];
 inputRefs:string[];system:string;prompt:string;maxTokens:number;contract?:ContractRequirement;
 /** Facts only the orchestrator knows (for example the requirement IDs QA must cover); passed to validators. */
 validationContext?:{requirementIds?:string[];retrievedUrls?:string[]};
 /** Documents the research connectors retrieved for this task (shown to the agent, enforced by the research validator). */
 retrieved?:Array<{url:string;title:string;retrieved:string;authority:string;published?:string}>;
 /** Which context this execution was built from: the proof of what it was (and was not) given. */
 contextRefs?:string[];slot?:number;profileId?:string;reviewedTaskId?:string;
 estimatedCost?:number;inputCostPerMillion?:number;outputCostPerMillion?:number;billing?:"metered"|"subscription";
 /** Code gates (typecheck, unit-tests, …) this task must pass when it delivers code. */
 requiredGates?:string[];
 workspace?:{path:string;checks:CheckCommandSpec[];gates:Record<string,CheckCommandSpec[]>;setup:CheckCommandSpec[];autoCommit:boolean;isolation:"none"|"worktree"};
 handoffTo?:Array<{taskId:string;role:string}>;
};

export class ContractViolationError extends Error{
 readonly code="CONTRACT_VIOLATION";
 constructor(readonly problems:string[]){super("Output contract violated after repair attempt: "+problems.join("; "));this.name="ContractViolationError";}
}

const REPAIR_ECHO_CHARS=12000,MAX_REPAIR_ROUNDS=2;
const gateRecords=(gates:GateResult[])=>gates.map(g=>({name:g.name,status:g.status,detail:g.detail}));
const clip=(id:string,length=128)=>id.slice(0,length);

/**
 * Two durable steps per model run so a crash never repeats paid work:
 *  generate()  provider call -> CHECKPOINTED record holding the raw output
 *  finalize()  patches, checks, artifacts, memory -> SUCCEEDED record
 * A CHECKPOINTED record without a terminal record is picked up again by finalize() on resume.
 * Every call is a fresh request: only {system, prompt} reach the provider, never earlier conversation.
 */
export class TaskRunner{
 constructor(private state:CompanyState){}

 private base(task:RunTask,id:string,startedAt:string,provider:{name:string;model:string}){
  return {id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,department:task.department??"general",provider:provider.name,model:provider.model,startedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost,billing:task.billing??"metered",profileId:task.profileId,slot:task.slot,contextRefs:task.contextRefs??[]};
 }

 async run(task:RunTask,provider:ModelProvider){
  return this.finalize(task,await this.generate(task,provider));
 }

 private problemsIn(task:RunTask,text:string){
  const requirement=task.contract??{sections:[],verdict:false};
  return [
   ...contractViolations(text,requirement),
   ...runValidators(requirement.validators??[],text,{params:requirement.params??{},requirementIds:task.validationContext?.requirementIds,retrievedUrls:task.validationContext?.retrievedUrls}).problems
  ];
 }

 async generate(task:RunTask,provider:ModelProvider):Promise<ExecutionRecordValue>{
  const id=randomUUID(),startedAt=new Date().toISOString(),base=this.base(task,id,startedAt,provider);
  await this.state.memory.recordStatus(task.projectId,task.taskId,"STARTED",provider.name+"/"+provider.model);
  await this.state.executions.append({...base,status:"STARTED"});
  try{
   const meta={taskId:task.taskId,kind:task.kind,sections:task.contract?.sections??[],validators:task.contract?.validators??[],params:task.contract?.params??{},requirementIds:task.validationContext?.requirementIds,slot:task.slot,retrieved:task.retrieved};
   let response=await provider.generate({system:task.system,prompt:task.prompt,maxTokens:task.maxTokens,meta});
   let inputTokens=response.inputTokens,outputTokens=response.outputTokens,answeredBy=response.model;
   let problems=this.problemsIn(task,response.text);
   // Repair rounds: the model sees exactly what the contract and validators found wrong, and re-emits the whole answer.
   for(let round=1;problems.length&&round<=MAX_REPAIR_ROUNDS;round++){
    const repair=task.prompt+"\n\n--- CONTRACT VIOLATION ---\nYour previous response did not satisfy the output contract:\n- "+problems.join("\n- ")+"\nRe-emit the complete response now, with every required section and format.\n\n--- PREVIOUS RESPONSE ---\n"+response.text.slice(0,REPAIR_ECHO_CHARS);
    response=await provider.generate({system:task.system,prompt:repair,maxTokens:task.maxTokens,meta});
    inputTokens+=response.inputTokens;outputTokens+=response.outputTokens;answeredBy=response.model??answeredBy;
    problems=this.problemsIn(task,response.text);
   }
   if(problems.length){
    const failedAt=new Date().toISOString(),error=new ContractViolationError(problems),actualCost=this.cost(task,inputTokens,outputTokens);
    await this.state.executions.append({...base,model:answeredBy??base.model,status:"FAILED",finishedAt:failedAt,inputTokens,outputTokens,actualCost,error:error.message});
    await this.state.memory.recordStatus(task.projectId,task.taskId,"FAILED",error.message);
    throw error;
   }
   return await this.state.executions.append({...base,model:answeredBy??base.model,status:"CHECKPOINTED",finishedAt:new Date().toISOString(),output:redact(response.text),inputTokens,outputTokens,actualCost:this.cost(task,inputTokens,outputTokens)});
  }catch(error){
   if(!(error instanceof ContractViolationError)){
    const message=redactError(error);
    await this.state.memory.recordStatus(task.projectId,task.taskId,"FAILED",message);
    await this.state.executions.append({...base,status:"FAILED",finishedAt:new Date().toISOString(),error:message});
   }
   throw error;
  }
 }

 private cost(task:RunTask,inputTokens:number,outputTokens:number){
  return task.inputCostPerMillion!=null&&task.outputCostPerMillion!=null?inputTokens/1e6*task.inputCostPerMillion+outputTokens/1e6*task.outputCostPerMillion:undefined;
 }

 /** Parsed structured sections go to their stores: research citations, requirement IDs, QA traceability, architecture review. */
 private async persistStructured(task:RunTask,output:string){
  const {state}=this,validators=task.contract?.validators??[],project=task.projectId,params=task.contract?.params??{};
  if(validators.includes("research-evidence")){
   const parsed=parseResearch(output),run=runValidators(["research-evidence"],output,{params});
   await state.research.save(project,task.taskId,parsed,params.externalResearch===true,run.notes);
  }
  if(validators.includes("requirements-ids"))await state.traceability.setRequirements(project,task.taskId,parseRequirements(output).requirements);
  if(validators.includes("qa-traceability")){
   const qa=parseQa(output);
   if(qa.overall)await state.traceability.setTests(project,task.taskId,qa.overall,qa.tests);
   await state.memory.recordTraceability(project,await state.traceability.renderMatrix(project));
  }
  if(validators.includes("architecture-review")){
   const review=parseArchitectureReview(output),verdict=parseReviewVerdict(output)??"CHANGES_REQUIRED";
   await state.traceability.addArchitectureReview(project,task.reviewedTaskId??task.taskId,verdict,review.categories,review.unresolvedRisks);
  }
 }

 /** Which gates this task must pass: the plan's required list resolved against the workspace configuration. Unconfigured required gates fail closed. */
 private resolveGates(task:RunTask):{gates:GateRun[];integration:GateRun[]}{
  const ws=task.workspace!,required=task.requiredGates??[];
  const commandsFor=(name:string)=>name==="project-checks"?(ws.checks.length?ws.checks:ws.gates["project-checks"]):ws.gates[name];
  const integration=ws.checks.length?[{name:"project-checks",commands:ws.checks}]:[];
  if(!required.length)return {gates:integration,integration};
  const missing=required.filter(name=>commandsFor(name)===undefined);
  if(missing.length)throw new WorkspaceError("Required code gate(s) not configured: "+missing.join(", ")+". Add them to workspace.gates (an empty list declares a gate not applicable).","GATE_NOT_CONFIGURED",missing.map(name=>"gate "+name+": NOT_CONFIGURED"),missing.map(name=>({name,status:"NOT_CONFIGURED" as const,detail:"not configured",checks:[]})));
  return {gates:required.map(name=>({name,commands:commandsFor(name)!})),integration};
 }

 /** Applies delivered code: in the main workspace, or in an isolated worktree that is integrated once its gates pass. */
 private async applyCode(task:RunTask,patches:FilePatch[]){
  const ws=task.workspace!,{gates,integration}=this.resolveGates(task),message="CompanySWAI: "+task.taskId;
  if(ws.isolation==="worktree"){
   return runIsolated({repo:ws.path,stateRoot:this.state.root,projectId:task.projectId,taskId:task.taskId,patches,gates,setup:ws.setup,integrationGates:integration,commitMessage:message});
  }
  return new LocalRepoWorkspace(ws.path).transaction(patches,[],ws.autoCommit?message:undefined,{gates});
 }

 async finalize(task:RunTask,checkpointed:ExecutionRecordValue):Promise<ExecutionRecordValue>{
  const {state}=this,id=checkpointed.id,output=checkpointed.output,finishedAt=new Date().toISOString();
  const base={...this.base({...task,estimatedCost:task.estimatedCost??checkpointed.estimatedCost},id,checkpointed.startedAt,{name:checkpointed.provider,model:checkpointed.model}),inputTokens:checkpointed.inputTokens,outputTokens:checkpointed.outputTokens,actualCost:checkpointed.actualCost};
  try{
   const patches=task.kind==="maker"?parseFilePatches(output):[];
   let changedFiles:string[]=[],commitSha:string|undefined,evidence:string[]=[],gates:GateResult[]=[];
   if(patches.length){
    if(!task.workspace)throw new WorkspaceError("Agent produced file patches but project has no workspace configured","INVALID_WORKSPACE");
    const result=await this.applyCode(task,patches);
    changedFiles=result.changedFiles;commitSha=result.commitSha;evidence=result.evidence;gates=result.gates;
   }
   const parsed=parseAgentOutput(output),artifactId=clip(task.taskId+"-"+id.slice(0,8));
   await state.artifacts.save(task.projectId,artifactId,{id:artifactId,projectId:task.projectId,taskId:task.taskId,kind:patches.length?"code":"document",title:task.agentRole+" output",content:output,createdAt:finishedAt});
   const displayId=await state.traceability.addArtifact(task.projectId,task.taskId,id,patches.length?"code":"document",artifactId);
   await this.persistStructured(task,output);
   const decisionRefs:string[]=[],reviewRefs:string[]=[],blockerRefs:string[]=[],handoffRefs:string[]=[];
   if(parsed.decision&&!isNone(parsed.decision)){
    const decisionId=clip(task.taskId+"-decision-"+id.slice(0,8)),display=await state.traceability.addDecision(task.projectId,task.taskId,id,parsed.decision);
    await state.decisions.save(task.projectId,decisionId,{id:decisionId,projectId:task.projectId,taskId:task.taskId,title:display+" — "+task.agentRole+" decisions",decision:parsed.decision,rationale:"Captured from structured agent output.",createdAt:finishedAt});
    decisionRefs.push(decisionId);await state.memory.recordDecision(task.projectId,task.taskId,display,parsed.decision);
   }
   if(parsed.blockers&&!isNone(parsed.blockers)){
    const blockerId=clip(task.taskId+"-blocker-"+id.slice(0,8));
    await state.blockers.save(task.projectId,blockerId,{id:blockerId,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,body:parsed.blockers,status:"OPEN",createdAt:finishedAt});
    blockerRefs.push(blockerId);await state.memory.recordBlocker(task.projectId,task.taskId,parsed.blockers);
   }
   if(task.kind==="review"){
    const verdict=parseReviewVerdict(output),reviewedTask=task.reviewedTaskId??task.taskId.replace(/--review-\d+(?:-\d+)?$/,"");
    if(verdict){
     const reviewId=clip(task.taskId+"-"+id.slice(0,8));
     await state.reviews.save(task.projectId,reviewId,{id:reviewId,projectId:task.projectId,taskId:reviewedTask,reviewerRole:task.agentRole,verdict,body:output,createdAt:finishedAt});
     reviewRefs.push(reviewId);await state.memory.recordReview(task.projectId,reviewedTask,task.taskId,verdict,output);
    }
   }else{
    await state.memory.recordOutput(task.projectId,{taskId:task.taskId,agentRole:task.agentRole,produces:task.produces??[],sections:task.contract?.sections??[]},displayId,output);
    const summary=parsed.handoff??condense(output,1200);
    for(const target of task.handoffTo??[]){
     const handoffId=clip(task.taskId+"-to-"+target.taskId+"-"+id.slice(0,6));
     await state.handoffs.save(task.projectId,handoffId,{id:handoffId,projectId:task.projectId,taskId:task.taskId,fromRole:task.agentRole,toRole:target.role,summary,refs:[artifactId],createdAt:finishedAt});
     handoffRefs.push("handoff:"+handoffId);await state.memory.recordHandoff(task.projectId,task.taskId,target.taskId,summary);
    }
   }
   const refs=[artifactId,...changedFiles.map(x=>"file:"+x),...(commitSha?["commit:"+commitSha]:[]),...handoffRefs];
   const record=await state.executions.append({...base,status:"SUCCEEDED",finishedAt,output,artifactRefs:refs,decisionRefs,reviewRefs,blockerRefs,changedFiles,commitSha,evidence,gates:gateRecords(gates)});
   await state.memory.recordStatus(task.projectId,task.taskId,"SUCCEEDED",commitSha?"commit "+commitSha:changedFiles.length?changedFiles.length+" file(s) changed":"");
   await state.checkpoints.save(task.projectId,{taskId:task.taskId,at:finishedAt,status:task.kind==="maker"?"REVIEW":"DONE",completed:["model-execution",...(changedFiles.length?["workspace-patch","deterministic-checks"]:[])],remaining:task.kind==="maker"?["review"]:[],artifactRefs:refs,decisionRefs,compactContext:output.slice(0,8000),provider:checkpointed.provider,model:checkpointed.model,inputTokens:checkpointed.inputTokens,outputTokens:checkpointed.outputTokens});
   return record;
  }catch(error){
   // Deterministic failures (rejected patch, failed check) are terminal for this response; anything else stays recoverable.
   if(error instanceof WorkspaceError){
    const message=redactError(error);
    await state.memory.recordStatus(task.projectId,task.taskId,"FAILED",message);
    await state.executions.append({...base,status:"FAILED",finishedAt:new Date().toISOString(),output,error:message,evidence:error.evidence,gates:gateRecords(error.gates)});
   }
   throw error;
  }
 }

 async pauseCapacity(task:RunTask,reason:string){
  const now=new Date().toISOString(),message=redact(reason);
  await this.state.memory.recordStatus(task.projectId,task.taskId,"PAUSED_CAPACITY",message);
  const record=await this.state.executions.append({id:randomUUID(),projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,department:task.department??"general",provider:"unassigned",model:"unassigned",status:"PAUSED_CAPACITY",startedAt:now,finishedAt:now,inputRefs:task.inputRefs,error:message});
  await this.state.checkpoints.save(task.projectId,{taskId:task.taskId,at:now,status:"PAUSED_CAPACITY",completed:[],remaining:["model-execution"],artifactRefs:[],decisionRefs:[],compactContext:task.prompt.slice(0,8000),inputTokens:0,outputTokens:0});
  return record;
 }
}
