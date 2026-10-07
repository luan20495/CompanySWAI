import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {z} from "zod";
import {SafeId} from "./ids.js";

const Ref=z.string().min(1).max(256);
export const Artifact=z.object({id:SafeId,projectId:SafeId,taskId:SafeId,kind:z.enum(["document","code","test","design","report","other"]),title:z.string().min(1),content:z.string(),createdAt:z.string().datetime()});
export const Decision=z.object({id:SafeId,projectId:SafeId,taskId:SafeId,title:z.string().min(1),decision:z.string().min(1),rationale:z.string().min(1),createdAt:z.string().datetime()});
export const Handoff=z.object({id:SafeId,projectId:SafeId,taskId:SafeId,fromRole:z.string().min(1),toRole:z.string().min(1),summary:z.string().min(1),refs:z.array(Ref).default([]),createdAt:z.string().datetime()});
export type ArtifactValue=z.infer<typeof Artifact>;export type DecisionValue=z.infer<typeof Decision>;export type HandoffValue=z.infer<typeof Handoff>;

class JsonStore<T>{
 constructor(private root:string,private schema:z.ZodType<T>){}
 private path(projectId:string,id:string){return join(this.root,projectId,id+".json");}
 async save(projectId:string,id:string,value:unknown){const parsed=this.schema.parse(value);const path=this.path(projectId,id);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(parsed,null,2),"utf8");return parsed;}
 async load(projectId:string,id:string){try{return this.schema.parse(JSON.parse(await readFile(this.path(projectId,id),"utf8")));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}}
}
export class FileArtifactStore extends JsonStore<ArtifactValue>{constructor(root=".companyswai/artifacts"){super(root,Artifact);}}
export class FileDecisionStore extends JsonStore<DecisionValue>{constructor(root=".companyswai/decisions"){super(root,Decision);}}
export class FileHandoffStore extends JsonStore<HandoffValue>{constructor(root=".companyswai/handoffs"){super(root,Handoff);}}
