import {randomUUID} from "node:crypto";
import type {ModelProvider} from "./provider.js";
import type {ExecutionRecordValue} from "./execution-record.js";
import type {CompanyState} from "./state.js";
import {condense,contractViolations,isNone,parseAgentOutput,parseReviewVerdict,type ContractRequirement} from "./output-parser.js";
import {LocalRepoWorkspace,WorkspaceError,parseFilePatches,type CheckCommandSpec} from "./repo-workspace.js";
import {redact,redactError} from "./secrets.js";

export type RunTask={
 projectId:string;taskId:string;agentRole:string;department?:string;kind:"maker"|"review";produces?:string[];
 inputRefs:string[];system:string;prompt:string;maxTokens:number;contract?:ContractRequirement;
 estimatedCost?:number;inputCostPerMillion?:number;outputCostPerMillion?:number;
 workspace?:{path:string;checks:CheckCommandSpec[];autoCommit:boolean};
 handoffTo?:Array<{taskId:string;role:string}>;
};

export class ContractViolationError extends Error{
 readonly code="CONTRACT_VIOLATION";
 constructor(readonly problems:string[]){super("Output contract violated after repair attempt: "+problems.join("; "));this.name="ContractViolationError";}
}

const REPAIR_ECHO_CHARS=12000;
const clip=(id:string,length=128)=>id.slice(0,length);

/**
 * Two durable steps per model run so a crash never repeats paid work:
 *  generate()  provider call -> CHECKPOINTED record holding the raw output
 *  finalize()  patches, checks, artifacts, memory -> SUCCEEDED record
 * A CHECKPOINTED record without a terminal record is picked up again by finalize() on resume.
 */
export class TaskRunner{
 constructor(private state:CompanyState){}

 private base(task:RunTask,id:string,startedAt:string,provider:{name:string;model:string}){
  return {id,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,department:task.department??"general",provider:provider.name,model:provider.model,startedAt,inputRefs:task.inputRefs,estimatedCost:task.estimatedCost};
 }

 async run(task:RunTask,provider:ModelProvider){
  return this.finalize(task,await this.generate(task,provider));
 }

 async generate(task:RunTask,provider:ModelProvider):Promise<ExecutionRecordValue>{
  const id=randomUUID(),startedAt=new Date().toISOString(),base=this.base(task,id,startedAt,provider);
  await this.state.memory.recordStatus(task.projectId,task.taskId,"STARTED",provider.name+"/"+provider.model);
  await this.state.executions.append({...base,status:"STARTED"});
  try{
   let response=await provider.generate({system:task.system,prompt:task.prompt,maxTokens:task.maxTokens});
   let inputTokens=response.inputTokens,outputTokens=response.outputTokens;
   const requirement=task.contract??{sections:[],verdict:false};
   let problems=contractViolations(response.text,requirement);
   if(problems.length){
    // One repair round: the model sees exactly what the contract found wrong.
    const repair=task.prompt+"\n\n--- CONTRACT VIOLATION ---\nYour previous response did not satisfy the output contract: "+problems.join("; ")+".\nRe-emit the complete response now, with every required section.\n\n--- PREVIOUS RESPONSE ---\n"+response.text.slice(0,REPAIR_ECHO_CHARS);
    response=await provider.generate({system:task.system,prompt:repair,maxTokens:task.maxTokens});
    inputTokens+=response.inputTokens;outputTokens+=response.outputTokens;
    problems=contractViolations(response.text,requirement);
    if(problems.length){
     const failedAt=new Date().toISOString(),error=new ContractViolationError(problems),actualCost=this.cost(task,inputTokens,outputTokens);
     await this.state.executions.append({...base,status:"FAILED",finishedAt:failedAt,inputTokens,outputTokens,actualCost,error:error.message});
     await this.state.memory.recordStatus(task.projectId,task.taskId,"FAILED",error.message);
     throw error;
    }
   }
   const record=await this.state.executions.append({...base,status:"CHECKPOINTED",finishedAt:new Date().toISOString(),output:redact(response.text),inputTokens,outputTokens,actualCost:this.cost(task,inputTokens,outputTokens)});
   return record;
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

 async finalize(task:RunTask,checkpointed:ExecutionRecordValue):Promise<ExecutionRecordValue>{
  const {state}=this,id=checkpointed.id,output=checkpointed.output,finishedAt=new Date().toISOString();
  const base={...this.base({...task,estimatedCost:task.estimatedCost??checkpointed.estimatedCost},id,checkpointed.startedAt,{name:checkpointed.provider,model:checkpointed.model}),inputTokens:checkpointed.inputTokens,outputTokens:checkpointed.outputTokens,actualCost:checkpointed.actualCost};
  try{
   const patches=task.kind==="maker"?parseFilePatches(output):[];
   let changedFiles:string[]=[],commitSha:string|undefined,evidence:string[]=[];
   if(patches.length){
    if(!task.workspace)throw new WorkspaceError("Agent produced file patches but project has no workspace configured","INVALID_WORKSPACE");
    const result=await new LocalRepoWorkspace(task.workspace.path).transaction(patches,task.workspace.checks,task.workspace.autoCommit?"CompanySWAI: "+task.taskId:undefined);
    changedFiles=result.changedFiles;commitSha=result.commitSha;evidence=result.evidence;
   }
   const parsed=parseAgentOutput(output),artifactId=clip(task.taskId+"-"+id.slice(0,8));
   await state.artifacts.save(task.projectId,artifactId,{id:artifactId,projectId:task.projectId,taskId:task.taskId,kind:patches.length?"code":"document",title:task.agentRole+" output",content:output,createdAt:finishedAt});
   const decisionRefs:string[]=[],reviewRefs:string[]=[],blockerRefs:string[]=[],handoffRefs:string[]=[];
   if(parsed.decision&&!isNone(parsed.decision)){
    const decisionId=clip(task.taskId+"-decision-"+id.slice(0,8));
    await state.decisions.save(task.projectId,decisionId,{id:decisionId,projectId:task.projectId,taskId:task.taskId,title:task.agentRole+" decisions",decision:parsed.decision,rationale:"Captured from structured agent output.",createdAt:finishedAt});
    decisionRefs.push(decisionId);await state.memory.recordDecision(task.projectId,task.taskId,id,parsed.decision);
   }
   if(parsed.blockers&&!isNone(parsed.blockers)){
    const blockerId=clip(task.taskId+"-blocker-"+id.slice(0,8));
    await state.blockers.save(task.projectId,blockerId,{id:blockerId,projectId:task.projectId,taskId:task.taskId,agentRole:task.agentRole,body:parsed.blockers,status:"OPEN",createdAt:finishedAt});
    blockerRefs.push(blockerId);await state.memory.recordBlocker(task.projectId,task.taskId,id,parsed.blockers);
   }
   if(task.kind==="review"){
    const verdict=parseReviewVerdict(output),reviewedTask=task.taskId.replace(/--review-\d+$/,"");
    if(verdict){
     const reviewId=clip(task.taskId+"-"+id.slice(0,8));
     await state.reviews.save(task.projectId,reviewId,{id:reviewId,projectId:task.projectId,taskId:reviewedTask,reviewerRole:task.agentRole,verdict,body:output,createdAt:finishedAt});
     reviewRefs.push(reviewId);await state.memory.recordReview(task.projectId,reviewedTask,task.taskId,id,verdict,output);
    }
   }else{
    await state.memory.recordOutput(task.projectId,{taskId:task.taskId,agentRole:task.agentRole,produces:task.produces??[]},id,output);
    const summary=parsed.handoff??condense(output,1200);
    for(const target of task.handoffTo??[]){
     const handoffId=clip(task.taskId+"-to-"+target.taskId+"-"+id.slice(0,6));
     await state.handoffs.save(task.projectId,handoffId,{id:handoffId,projectId:task.projectId,taskId:task.taskId,fromRole:task.agentRole,toRole:target.role,summary,refs:[artifactId],createdAt:finishedAt});
     handoffRefs.push("handoff:"+handoffId);await state.memory.recordHandoff(task.projectId,task.taskId,target.taskId,id,summary);
    }
   }
   const refs=[artifactId,...changedFiles.map(x=>"file:"+x),...(commitSha?["commit:"+commitSha]:[]),...handoffRefs];
   const record=await state.executions.append({...base,status:"SUCCEEDED",finishedAt,output,artifactRefs:refs,decisionRefs,reviewRefs,blockerRefs,changedFiles,commitSha,evidence});
   await state.memory.recordStatus(task.projectId,task.taskId,"SUCCEEDED",commitSha?"commit "+commitSha:changedFiles.length?changedFiles.length+" file(s) changed":"");
   await state.checkpoints.save(task.projectId,{taskId:task.taskId,at:finishedAt,status:task.kind==="maker"?"REVIEW":"DONE",completed:["model-execution",...(changedFiles.length?["workspace-patch","deterministic-checks"]:[])],remaining:task.kind==="maker"?["review"]:[],artifactRefs:refs,decisionRefs,compactContext:output.slice(0,8000),provider:checkpointed.provider,model:checkpointed.model,inputTokens:checkpointed.inputTokens,outputTokens:checkpointed.outputTokens});
   return record;
  }catch(error){
   // Deterministic failures (rejected patch, failed check) are terminal for this response; anything else stays recoverable.
   if(error instanceof WorkspaceError){
    const message=redactError(error);
    await state.memory.recordStatus(task.projectId,task.taskId,"FAILED",message);
    await state.executions.append({...base,status:"FAILED",finishedAt:new Date().toISOString(),output,error:message,evidence:error.evidence});
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
