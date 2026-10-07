import {mkdir,writeFile,readFile} from "node:fs/promises";
import {join} from "node:path";
import {SafeId} from "./ids.js";
export class ProjectWorkspace{
 constructor(private root=".companyswai/workspaces"){}
 private dir(projectId:string){return join(this.root,SafeId.parse(projectId));}
 async init(projectId:string,metadata:unknown={}){const dir=this.dir(projectId);await mkdir(dir,{recursive:true});await writeFile(join(dir,"project.json"),JSON.stringify({projectId,...(typeof metadata==="object"&&metadata?metadata:{})},null,2),"utf8");return dir;}
 async write(projectId:string,name:string,content:string){if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))throw new Error("Unsafe workspace filename");const dir=this.dir(projectId);await mkdir(dir,{recursive:true});const path=join(dir,name);await writeFile(path,content,"utf8");return path;}
 async read(projectId:string,name:string){if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))throw new Error("Unsafe workspace filename");return readFile(join(this.dir(projectId),name),"utf8");}
}
