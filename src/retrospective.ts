import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {z} from "zod";
import type {ExecutionRecordValue} from "./execution-record.js";

export const Retrospective=z.object({
 projectId:z.string().min(1),createdAt:z.string().datetime(),
 totalRuns:z.number().int().nonnegative(),failures:z.number().int().nonnegative(),paused:z.number().int().nonnegative(),
 inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),actualCost:z.number().nonnegative(),
 lessons:z.array(z.string())
});
export type RetrospectiveValue=z.infer<typeof Retrospective>;

export function buildRetrospective(projectId:string,records:ExecutionRecordValue[]):RetrospectiveValue{
 const terminal=records.filter(r=>r.status!=="STARTED");
 const failures=terminal.filter(r=>r.status==="FAILED").length,paused=terminal.filter(r=>r.status==="PAUSED_CAPACITY").length;
 const actualCost=terminal.reduce((s,r)=>s+(r.actualCost??0),0);
 const lessons:string[]=[];
 if(failures)lessons.push("Provider/task failures occurred; inspect failed execution records before reusing the same routing strategy.");
 if(paused)lessons.push("Capacity pauses occurred; provision fallback capacity or reduce concurrency before the next comparable run.");
 const estimates=terminal.filter(r=>r.status==="SUCCEEDED"&&r.estimatedCost!=null&&r.actualCost!=null);
 if(estimates.length){const estimated=estimates.reduce((s,r)=>s+(r.estimatedCost??0),0),actual=estimates.reduce((s,r)=>s+(r.actualCost??0),0);if(estimated>0&&actual>estimated*1.25)lessons.push("Actual model cost exceeded estimates by more than 25%; increase future token/cost estimates for similar tasks.");}
 if(!lessons.length)lessons.push("Execution completed without a detected capacity, failure or material cost-estimation issue.");
 return Retrospective.parse({projectId,createdAt:new Date().toISOString(),totalRuns:terminal.length,failures,paused,inputTokens:terminal.reduce((s,r)=>s+r.inputTokens,0),outputTokens:terminal.reduce((s,r)=>s+r.outputTokens,0),actualCost,lessons});
}
export class FileRetrospectiveStore{
 constructor(private root=".companyswai/retrospectives"){}
 private path(projectId:string){return join(this.root,projectId,"latest.json");}
 async save(value:RetrospectiveValue){const v=Retrospective.parse(value),path=this.path(v.projectId);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(v,null,2),"utf8");return v;}
 async load(projectId:string){try{return Retrospective.parse(JSON.parse(await readFile(this.path(projectId),"utf8")));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw e;}}
}
