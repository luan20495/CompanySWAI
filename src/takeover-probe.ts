import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {lstat,readFile,readdir,readlink,realpath} from "node:fs/promises";
import {join,resolve} from "node:path";
import {promisify} from "node:util";
import {redact,sanitizedEnv} from "./secrets.js";
import {sanitizeUntrusted} from "./research-connectors.js";
const execFileAsync=promisify(execFile);

/**
 * Read-only probe of an existing repository. A takeover never patches, installs, migrates, checks out or runs a script of the
 * target. It runs a fixed set of git subcommands that cannot write and cannot make git run a program from the repository:
 * no `status`/`diff` (they apply `filter.*.clean` drivers and LFS), no `ls-files --modified`, signatures are not verified, hooks,
 * fsmonitor and global/system config are switched off. Dirtiness is computed from raw file bytes by this module, content is read as
 * committed blobs (`cat-file blob`, never `--filters`), and the list of audited files is the HEAD tree, not the index.
 */
export class TakeoverError extends Error{
 constructor(message:string,readonly code:"FORBIDDEN_COMMAND"|"NOT_A_REPOSITORY"|"UNBORN_HEAD"|"BAD_STATE"|"TARGET_CHANGED"){super(message);this.name="TakeoverError";}
}

const READ_ONLY_GIT=new Set(["rev-parse","ls-files","ls-tree","log","rev-list","remote","for-each-ref","worktree","cat-file","merge-base"]);
const allowed=(args:string[])=>{
 const [sub,next]=args;
 if(!READ_ONLY_GIT.has(sub))return false;
 if(sub==="worktree"&&next!=="list")return false;
 if(sub==="remote"&&!(args.length===2&&next==="-v"))return false;
 if(sub==="merge-base"&&!(args.length===4&&next==="--is-ancestor"))return false;
 return !args.some(a=>a.startsWith("--output")||["--ext-diff","--textconv","--filters","--eol","-m","--modified","--show-signature"].includes(a));
};

export async function git(root:string,args:string[],maxBuffer=128*1024*1024):Promise<string>{
 if(!allowed(args))throw new TakeoverError("git "+args.join(" ")+" is not a read-only audit command","FORBIDDEN_COMMAND");
 const env:NodeJS.ProcessEnv={...sanitizedEnv(),GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0",GIT_PAGER:"cat",GIT_EXTERNAL_DIFF:"",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1"};
 delete env.GIT_DIR;delete env.GIT_WORK_TREE;delete env.GIT_INDEX_FILE;
 const config=["core.fsmonitor=false","core.hooksPath=/dev/null","core.attributesFile=/dev/null","core.quotepath=off","log.showSignature=false","gpg.program=false"].flatMap(c=>["-c",c]);
 const {stdout}=await execFileAsync("git",[...config,"--no-pager","-C",root,...args],{env,maxBuffer,encoding:"utf8"});
 return stdout;
}
/** The workspace must be the repository root: committed paths are root-relative, so a subdirectory would silently mis-resolve every citation. */
async function repositoryRoot(root:string){
 const top=(await git(root,["rev-parse","--show-toplevel"]).catch(()=>"")).trim();
 if(!top)throw new TakeoverError("Not a git repository: "+root,"NOT_A_REPOSITORY");
 if(await realpath(top)!==await realpath(root))throw new TakeoverError(root+" is inside the repository "+top+"; take over the repository root","NOT_A_REPOSITORY");
 return top;
}
const sha=(data:string|Buffer)=>createHash("sha256").update(data).digest("hex");
const blobSha=(data:Buffer)=>createHash("sha1").update("blob "+data.length+"\0").update(data).digest("hex");
const split0=(text:string)=>text.split("\0").filter(Boolean);

/** Blobs of the HEAD tree (path -> object id); gitlinks (submodules) are not files of this repository. */
async function headTree(root:string){
 const out=new Map<string,string>();
 for(const entry of split0(await git(root,["ls-tree","-r","-z","HEAD"]))){
  const tab=entry.indexOf("\t"),[,type,id]=entry.slice(0,tab).split(" ");
  if(type==="blob")out.set(entry.slice(tab+1),id);
 }
 return out;
}
async function indexEntries(root:string){
 const out=new Map<string,string>();
 for(const entry of split0(await git(root,["ls-files","-s","-z"]))){const tab=entry.indexOf("\t"),[,id,stage]=entry.slice(0,tab).split(" ");out.set(entry.slice(tab+1),stage==="0"?id:id+":"+stage);}
 return out;
}
const MAX_RAW_HASH=256*1024*1024;
/** The git object id of a working-tree file's raw bytes (no clean filter, no line-ending conversion), or a marker for what is not a file. */
async function rawId(file:string){
 const info=await lstat(file).catch(()=>undefined);
 if(!info)return "missing";
 if(info.isSymbolicLink())return blobSha(Buffer.from(await readlink(file).catch(()=>"")));
 if(!info.isFile())return "special";
 if(info.size>MAX_RAW_HASH)return "size"+info.size;
 return blobSha(await readFile(file).catch(()=>Buffer.alloc(0)));
}
async function inBatches<T,R>(items:T[],work:(item:T)=>Promise<R>,size=64){
 const out:R[]=[];
 for(let i=0;i<items.length;i+=size)out.push(...await Promise.all(items.slice(i,i+size).map(work)));
 return out;
}

/** What differs from HEAD right now: tracked files whose raw bytes differ from the index, staged changes, untracked files. */
export type WorkingState={modified:string[];staged:string[];untracked:string[];worktree:string;untrackedHash:string;ignored:string};
export async function workingState(root:string,top:string):Promise<WorkingState>{
 const [tree,index]=[await headTree(root),await indexEntries(root)],paths=[...index.keys()].sort();
 const raw=await inBatches(paths,async path=>[path,await rawId(join(top,path))] as const);
 const modified=raw.filter(([path,id])=>id!==index.get(path)).map(([path])=>path);
 const staged=[...new Set([...tree.keys(),...index.keys()])].filter(path=>tree.get(path)!==index.get(path)).sort();
 const untracked=split0(await git(root,["ls-files","--others","--exclude-standard","-z"])).sort();
 const untrackedIds=await inBatches(untracked,async path=>path+":"+await rawId(join(top,path)));
 // Ignored files are compared by name, size and mtime; the inside of an ignored directory (node_modules, build output) is not hashed.
 const ignoredNames=split0(await git(root,["ls-files","--others","--ignored","--exclude-standard","--directory","-z"])).sort();
 const ignored=await inBatches(ignoredNames,async path=>{const info=path.endsWith("/")?undefined:await lstat(join(top,path)).catch(()=>undefined);return path+(info?":"+info.size+":"+Math.trunc(info.mtimeMs):"");});
 return {modified,staged,untracked,worktree:sha(raw.map(([p,id])=>p+":"+id).join("\n")),untrackedHash:sha(untrackedIds.join("\n")),ignored:sha(ignored.join("\n"))};
}

/** Everything that would change if something wrote to the target: refs, index, working tree, untracked and ignored files, .git layout and hooks. */
export type Fingerprint={head:string;branch:string;refs:string;index:string;staged:string;worktree:string;untracked:string;ignored:string;gitDir:string;worktrees:string;dirtyFiles:number};

const VOLATILE_GIT_FILES=new Set(["FETCH_HEAD"]);
async function gitDirectoryHash(dir:string){
 const parts:string[]=[],names=(await readdir(dir).catch(()=>[] as string[])).filter(n=>!VOLATILE_GIT_FILES.has(n)).sort();
 parts.push("names:"+names.join(","));
 for(const name of ["HEAD","config","packed-refs"])parts.push(name+":"+await readFile(join(dir,name)).then(sha,()=>"none"));
 for(const sub of ["hooks","info"]){
  for(const file of (await readdir(join(dir,sub)).catch(()=>[] as string[])).sort())parts.push(sub+"/"+file+":"+await readFile(join(dir,sub,file)).then(sha,()=>"dir"));
 }
 return parts.join("\n");
}

export async function fingerprint(root:string):Promise<Fingerprint>{
 const top=await repositoryRoot(root),gitDir=(await git(root,["rev-parse","--absolute-git-dir"])).trim();
 const common=resolve(root,(await git(root,["rev-parse","--git-common-dir"])).trim());
 const head=(await git(root,["rev-parse","HEAD"]).catch(()=>"")).trim()||"UNBORN";
 const branch=(await git(root,["rev-parse","--abbrev-ref","HEAD"]).catch(()=>"")).trim();
 const state=await workingState(root,top);
 const refs=sha(await git(root,["for-each-ref","--format=%(refname) %(objectname)"]));
 const dirs=[...new Set([gitDir,common])];
 return {
  head,branch,refs,index:await readFile(join(gitDir,"index")).then(sha,()=>"none"),staged:sha(state.staged.join("\n")),worktree:state.worktree,untracked:state.untrackedHash,ignored:state.ignored,
  gitDir:sha((await Promise.all(dirs.map(gitDirectoryHash))).join("\n--\n")),worktrees:sha(await git(root,["worktree","list","--porcelain"])),
  dirtyFiles:new Set([...state.modified,...state.staged]).size+state.untracked.length
 };
}
/** Names of the fingerprint parts that differ: empty means the target was not changed while the audit ran. */
export const changedParts=(before:Fingerprint,after:Fingerprint)=>(Object.keys(before) as Array<keyof Fingerprint>).filter(key=>key!=="dirtyFiles"&&before[key]!==after[key]);

export type EvidenceClass="TEST"|"SOURCE"|"CI"|"CONFIG"|"DOCS"|"OTHER";
const CODE_EXT=/\.(kt|java|scala|ts|tsx|js|jsx|mjs|cjs|py|go|rs|swift|rb|php|cs|sh|vue|svelte)$/i;
const DOC_EXT=/\.(md|mdx|rst|adoc|txt)$/i;
/** The class of a tracked path, decided by the engine from its location and name (an agent can claim a class but never choose it). */
export function classOfPath(path:string):EvidenceClass{
 if(/^\.github\/workflows\/|^\.gitlab-ci\.ya?ml$|^Jenkinsfile$|^\.circleci\/|^azure-pipelines\.ya?ml$/.test(path))return "CI";
 if(DOC_EXT.test(path)||/^docs\//.test(path))return "DOCS";
 // Test source is test CODE: a fixture, snapshot, mock or spec document under a test directory is not.
 if(CODE_EXT.test(path)&&!/(^|\/)(fixtures?|__snapshots__|snapshots?|mocks?|__mocks__|testdata|resources)(\/|$)/i.test(path)&&(/(^|\/)(tests?|__tests__|e2e|specs?)(\/|$)/i.test(path)||/\.(test|spec)\.[a-z]+$|Tests?\.(kt|java|scala|swift)$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i.test(path)))return "TEST";
 if(/(^|\/)(migrations?|flyway)(\/|$)|\.(sql|ya?ml|toml|ini|properties|conf)$|(^|\/)(build|settings)\.gradle(\.kts)?$|(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|Dockerfile|compose[^/]*\.ya?ml|\.env\.example|Makefile|pom\.xml)$/i.test(path))return "CONFIG";
 return CODE_EXT.test(path)?"SOURCE":"OTHER";
}
/** Files whose content is never read, even when tracked. */
export const isSensitivePath=(path:string)=>/(^|\/)\.env(\.(?!example)[^/]*)?$|\.(pem|key|p12|pfx|jks|keystore)$|(^|\/)(id_[rd]sa|id_ed25519)|secret|credential|\.npmrc$|\.netrc$/i.test(path);

export type SnapshotDoc={path:string;bytes:number;excerpt:string};
export type Snapshot={
 version:1;takenAt:string;workspace:string;head:string;branch:string;remotes:string[];commitCount:number;
 dirty:{modified:string[];untracked:string[];total:number};
 log:Array<{sha:string;date:string;subject:string}>;
 files:{total:number;byTop:Record<string,number>;byClass:Record<string,number>};
 tracked:string[];tree:string[];
 lists:{tests:string[];ci:string[];migrations:string[];config:string[];docs:string[];source?:string[]};
 /** Real sizes of the lists above, which are capped. `source` is the index of implementation files the agents may cite (absent in snapshots taken before it existed). */
 listTotals:{tests:number;ci:number;migrations:number;config:number;docs:number;source?:number};
 docs:SnapshotDoc[];manifests:SnapshotDoc[];
};

const DOC_STATUS=/(status|known[_-]?limit|blocker|acceptance|release|qa)/i;
const DOC_SCORE=/(status|known[_-]?limit|board|blocker|decision|roadmap|todo|handoff|release|acceptance|readme|architecture|implementation|qa|golden|p1|ownership|contract|claude)/i;
const MAX_DOC_BYTES=400_000,EXCERPT_KEY=7000,EXCERPT=3500,MAX_DOCS=20,MAX_DOC_CHARS=110_000,LIST_CAP=400,CODE_LIST_CAP=900,LOG_CAP=200;
const STOP=new Set(["status","final","with","from","that","this","items","done","work","flow"]);
/** Words of the user's focus areas that can point at a document by its path ("Golden Company" -> golden, company; "C6" -> c6). */
const focusWords=(focus:string[])=>[...new Set(focus.flatMap(f=>f.toLowerCase().split(/[^a-z0-9]+/)).filter(w=>(w.length>=4&&!STOP.has(w))||(w.length>=2&&/\d/.test(w))))];
const readBlob=async(root:string,head:string,path:string)=>git(root,["cat-file","blob",head+":"+path]).catch(()=>"");
/** key = value credentials that have no recognisable token shape (passwords in compose files, demo credentials in READMEs). */
const ASSIGNMENT=/((?:[A-Za-z0-9_.-]*)(?:pass(?:word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/gi;
/** Sanitise first (control and zero-width characters can split a token), then redact. */
export const scrub=(text:string)=>redact(text.replace(ASSIGNMENT,"$1[REDACTED]"));
const clean=(text:string,limit:number)=>scrub(sanitizeUntrusted(text.slice(0,limit)).text);

/** A committed-content snapshot at HEAD: nothing is read from the working tree, so uncommitted edits can never leak into the evidence. */
export async function takeSnapshot(workspace:string,now=new Date(),focus:string[]=[]):Promise<Snapshot>{
 const root=resolve(workspace),top=await repositoryRoot(root);
 const head=(await git(root,["rev-parse","HEAD"]).catch(()=>"")).trim();
 if(!head)throw new TakeoverError("The repository has no commit to audit","UNBORN_HEAD");
 const branch=(await git(root,["rev-parse","--abbrev-ref","HEAD"])).trim(),tracked=[...(await headTree(root)).keys()].sort();
 const state=await workingState(root,top),modified=[...new Set([...state.modified,...state.staged])].sort(),untracked=state.untracked;
 const log=(await git(root,["log","-n",String(LOG_CAP),"--format=%H%x09%cI%x09%s"])).split("\n").filter(Boolean).map(line=>{const [sha,date,...subject]=line.split("\t");return {sha,date,subject:scrub(subject.join("\t")).slice(0,160)};});
 const commitCount=Number((await git(root,["rev-list","--count","HEAD"])).trim());
 const remotes=[...new Set((await git(root,["remote","-v"])).split("\n").filter(Boolean).map(l=>scrub(l.replace(/\s+\((fetch|push)\)$/,"").replace(/\/\/[^@/\s]+@/,"//"))))];
 const byTop:Record<string,number>={},byClass:Record<string,number>={},dirs=new Map<string,number>();
 const lists={tests:[] as string[],ci:[] as string[],migrations:[] as string[],config:[] as string[],docs:[] as string[],source:[] as string[]};
 for(const path of tracked){
  const parts=path.split("/"),topName=parts.length>1?parts[0]+"/":"(root)",klass=classOfPath(path);
  byTop[topName]=(byTop[topName]??0)+1;byClass[klass]=(byClass[klass]??0)+1;
  for(let depth=1;depth<=Math.min(4,parts.length-1);depth++){const dir=parts.slice(0,depth).join("/")+"/";dirs.set(dir,(dirs.get(dir)??0)+1);}
  if(klass==="TEST")lists.tests.push(path);else if(klass==="SOURCE")lists.source.push(path);else if(klass==="CI")lists.ci.push(path);else if(klass==="DOCS")lists.docs.push(path);
  else if(klass==="CONFIG"){(/(^|\/)(migrations?|flyway)(\/|$)/i.test(path)?lists.migrations:lists.config).push(path);}
 }
 const tree=[...dirs].filter(([,n])=>n>=5).sort((a,b)=>a[0].localeCompare(b[0])).slice(0,220).map(([dir,n])=>dir+" ("+n+")");
 const words=focusWords(focus),focused=(p:string)=>words.some(w=>p.toLowerCase().includes(w));
 const base=(p:string)=>(p.split("/").length===1?3:0)+(DOC_SCORE.test(p.split("/").pop()!)?4:0)+(DOC_STATUS.test(p.split("/").pop()!)?2:0)+(/^docs\/[^/]+$/.test(p)?1:0);
 const pool=lists.docs.filter(p=>DOC_EXT.test(p)&&!isSensitivePath(p)&&!/\/(evidence|logs?|artifacts|archive)\//i.test(p)&&p.split("/").length<=4).map(p=>({p,score:base(p)}));
 // The project's own status documents always come first; documents matching the user's focus areas fill the remaining room.
 const core=pool.filter(x=>x.score>=3).sort((a,b)=>b.score-a.score||a.p.localeCompare(b.p)).slice(0,10),taken=new Set(core.map(x=>x.p));
 const docCandidates=[...core,...pool.filter(x=>!taken.has(x.p)&&focused(x.p)).sort((a,b)=>b.score-a.score||a.p.localeCompare(b.p)).slice(0,MAX_DOCS-core.length).map(x=>({...x,score:Math.min(x.score,4)}))];
 const docs:SnapshotDoc[]=[];let docChars=0;
 for(const {p,score:s} of docCandidates){
  if(docChars>=MAX_DOC_CHARS)break;
  const text=await readBlob(root,head,p);if(text&&text.length<=MAX_DOC_BYTES){const excerpt=clean(text,s>=5?EXCERPT_KEY:EXCERPT);docChars+=excerpt.length;docs.push({path:p,bytes:text.length,excerpt});}
 }
 const manifestPaths=tracked.filter(p=>/(^|\/)(package\.json|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|pom\.xml|compose[^/]*\.ya?ml|Dockerfile|\.env\.example)$/.test(p)&&p.split("/").length<=3&&!isSensitivePath(p)).slice(0,14);
 const manifests:SnapshotDoc[]=[];
 for(const p of manifestPaths){const text=await readBlob(root,head,p);if(text)manifests.push({path:p,bytes:text.length,excerpt:clean(text,2500)});}
 return {
  version:1,takenAt:now.toISOString(),workspace:root,head,branch,remotes,commitCount,
  dirty:{modified:modified.slice(0,50),untracked:untracked.slice(0,50),total:modified.length+untracked.length},log,
  files:{total:tracked.length,byTop,byClass},tracked,tree,
  lists:{tests:lists.tests.slice(0,CODE_LIST_CAP),source:lists.source.slice(0,CODE_LIST_CAP),ci:lists.ci.slice(0,LIST_CAP),migrations:lists.migrations.slice(0,LIST_CAP),config:lists.config.slice(0,LIST_CAP),docs:lists.docs.slice(0,LIST_CAP)},
  listTotals:{tests:lists.tests.length,source:lists.source.length,ci:lists.ci.length,migrations:lists.migrations.length,config:lists.config.length,docs:lists.docs.length},docs,manifests
 };
}

/** Resolves an agent's citation against the snapshot. Anything that is not a tracked path, a tracked directory or a commit in the log is rejected. */
export type ResolvedRef={ref:string;classes:Array<EvidenceClass|"GIT">}|undefined;
export function resolveRef(snapshot:Snapshot,ref:string,index=new Set(snapshot.tracked)):ResolvedRef{
 const text=ref.trim();
 if(/^git:[0-9a-f]{7,40}$/i.test(text)){const id=text.slice(4).toLowerCase();return snapshot.log.some(c=>c.sha.startsWith(id))?{ref:text,classes:["GIT"]}:undefined;}
 if(index.has(text)){const klass=classOfPath(text);return klass==="OTHER"?undefined:{ref:text,classes:[klass]};}
 if(text.endsWith("/")){
  // A directory is evidence only when it is specific: "backend/" would otherwise make every claim look implemented and tested.
  const classes=new Set<EvidenceClass>();let files=0;
  for(const path of snapshot.tracked)if(path.startsWith(text)){files++;const klass=classOfPath(path);if(klass!=="OTHER")classes.add(klass);}
  return classes.size&&files<=MAX_DIRECTORY_EVIDENCE_FILES?{ref:text,classes:[...classes]}:undefined;
 }
 return undefined;
}
export const MAX_DIRECTORY_EVIDENCE_FILES=80;
