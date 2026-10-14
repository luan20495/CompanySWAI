import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {readdir,readFile} from "node:fs/promises";
import {join,relative} from "node:path";
import {promisify} from "node:util";
import {z} from "zod";

const execFileAsync=promisify(execFile);

/**
 * Which CompanySWAI ran a project: the engine source (git commit, dirty flag) and the organisation it ran as (a hash of the
 * Markdown in company/, agents/ and skills/). Recorded on every new run so a later change in behaviour can be attributed to a
 * change in the company. Anything that cannot be determined is "unknown", never guessed.
 */
export const CompanyVersion=z.object({
 gitSha:z.string(),
 dirty:z.union([z.boolean(),z.literal("unknown")]),
 organizationHash:z.string(),
 organizationFiles:z.number().int().nonnegative(),
 packageVersion:z.string(),
 at:z.string()
});
export type CompanyVersionValue=z.infer<typeof CompanyVersion>;

export const ORGANIZATION_DIRS=["company","agents","skills"] as const;
const GIT_TIMEOUT_MS=5000;

async function files(dir:string):Promise<string[]>{
 let entries;
 try{entries=await readdir(dir,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
 const out:string[]=[];
 for(const entry of entries){
  const path=join(dir,entry.name);
  if(entry.isDirectory())out.push(...await files(path));
  else if(entry.isFile())out.push(path);
 }
 return out;
}

/** sha256 over (relative path, content) of every file in the organisation directories, in a stable order. */
export async function organizationHash(root="."){
 const all=(await Promise.all(ORGANIZATION_DIRS.map(d=>files(join(root,d))))).flat().sort();
 const hash=createHash("sha256");
 for(const path of all){hash.update(relative(root,path).split("\\").join("/")+"\0");hash.update(await readFile(path));hash.update("\0");}
 return {hash:all.length?hash.digest("hex").slice(0,16):"unknown",files:all.length};
}

async function git(root:string,args:string[]){
 const {stdout}=await execFileAsync("git",["-C",root,...args],{timeout:GIT_TIMEOUT_MS,env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}});
 return stdout;
}

/** Read-only: `git rev-parse` / `git status --porcelain` with optional locks off, so it never touches the index. */
export async function companyVersion(root=".",now=()=>new Date()):Promise<CompanyVersionValue>{
 const [sha,status,org,pkg]=await Promise.all([
  git(root,["rev-parse","HEAD"]).then(s=>s.trim()).catch(()=>"unknown"),
  git(root,["status","--porcelain","--untracked-files=no"]).catch(()=>undefined),
  organizationHash(root).catch(()=>({hash:"unknown",files:0})),
  readFile(join(root,"package.json"),"utf8").then(t=>String((JSON.parse(t) as {version?:unknown}).version??"unknown")).catch(()=>"unknown")
 ]);
 return {gitSha:/^[0-9a-f]{40}$/.test(sha)?sha:"unknown",dirty:status===undefined?"unknown":status.trim().length>0,organizationHash:org.hash,organizationFiles:org.files,packageVersion:pkg,at:now().toISOString()};
}

export function describeVersion(v:CompanyVersionValue|undefined){
 if(!v)return "UNKNOWN (not recorded before Phase 0)";
 return (v.gitSha==="unknown"?"git unknown":v.gitSha.slice(0,10))+(v.dirty===true?"+dirty":v.dirty==="unknown"?"+dirty?":"")+" org "+v.organizationHash+" ("+v.organizationFiles+" files) v"+v.packageVersion;
}
