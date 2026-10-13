import {audit,cleanup,renderAudit,renderCleanup,UsageError} from "./branch-lifecycle.js";

const USAGE=`Usage:
  npm run branches -- audit <repoPath> --target <ref> [--remote <name>] [--protect <glob> ...] [--fetch] [--json]
  npm run branches -- cleanup <repoPath> <branch> --target <ref> [--remote <name>] [--protect <glob> ...] [--fetch] [--pr <text>] [--next <name>] [--apply]
audit is read-only. cleanup is a dry run unless --apply; it never force-deletes, never removes worktrees, never touches protected branches.
Exit codes: 0 done or dry run, 3 BLOCKED (nothing deleted), 2 usage error.`;
const VALUE=new Set(["--target","--remote","--protect","--pr","--next"]),BOOL=new Set(["--json","--fetch","--apply"]);

function parse(raw:string[]){
 const pos:string[]=[],opt:Record<string,string>={},flags=new Set<string>(),protect:string[]=[];
 for(let i=0;i<raw.length;i++){
  const a=raw[i]!;
  if(VALUE.has(a)){const v=raw[++i];if(v===undefined)throw new UsageError(a+" needs a value");if(a==="--protect")protect.push(v);else opt[a]=v;}
  else if(BOOL.has(a))flags.add(a);
  else if(a.startsWith("--"))throw new UsageError("unknown option "+a);
  else pos.push(a);
 }
 return {pos,opt,flags,protect};
}

try{
 const {pos,opt,flags,protect}=parse(process.argv.slice(2)),[cmd,repo,branch]=pos;
 const base={repo:repo??"",target:opt["--target"]??"",remote:opt["--remote"],protect,fetch:flags.has("--fetch")};
 if((cmd!=="audit"&&cmd!=="cleanup")||!repo||(cmd==="audit"&&pos.length!==2)||(cmd==="cleanup"&&(!branch||pos.length!==3)))throw new UsageError("bad arguments");
 if(cmd==="audit"){
  const a=audit(base);
  console.log(flags.has("--json")?JSON.stringify(a,null,2):renderAudit(a).trimEnd());
 }else{
  const r=cleanup({...base,branch:branch!,apply:flags.has("--apply"),pr:opt["--pr"],next:opt["--next"]});
  console.log(flags.has("--json")?JSON.stringify(r,null,2):renderCleanup(r).trimEnd());
  process.exitCode=r.exitCode;
 }
}catch(e){
 if(!(e instanceof UsageError))throw e;
 console.error("branches: "+e.message+"\n"+USAGE);
 process.exitCode=2;
}
