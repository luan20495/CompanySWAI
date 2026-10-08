import {mkdir,rename,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {randomUUID} from "node:crypto";

/** Write-then-rename so a crash never leaves a half-written state file behind. */
export async function writeFileAtomic(path:string,content:string){
 await mkdir(dirname(path),{recursive:true});
 const temp=path+".tmp-"+process.pid+"-"+randomUUID().slice(0,8);
 await writeFile(temp,content,"utf8");
 await rename(temp,path);
}
