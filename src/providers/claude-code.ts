import {execFile,spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";
import {redact} from "../secrets.js";
const execFileAsync=promisify(execFile);

/**
 * Provider that drives the local Claude Code CLI (`claude -p`). Authentication stays owned by the CLI:
 * this adapter never reads, copies or persists credentials, it only inspects `claude auth status` for the
 * logged-in flag. The CLI runs without tools, in an empty scratch directory, with session persistence off.
 */
export const DEFAULT_EXECUTABLE="claude";
const DEFAULT_TIMEOUT_MS=600_000;
const MAX_OUTPUT_BYTES=20*1024*1024;
const MAX_SYSTEM_ARGV_CHARS=100_000;
const KILL_GRACE_MS=2000;
const MODEL_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]*$/;
/** Credentials that would make the CLI bill an API account or another cloud instead of the signed-in subscription. */
const STRIPPED_ENV=["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","CLAUDE_CODE_USE_BEDROCK","CLAUDE_CODE_USE_VERTEX","CLAUDE_CODE_USE_FOUNDRY"];

export type ClaudeCodeErrorCode="CLAUDE_NOT_FOUND"|"CLAUDE_NOT_LOGGED_IN"|"CLAUDE_TIMEOUT"|"CLAUDE_CANCELLED"|"CLAUDE_FAILED"|"CLAUDE_BAD_OUTPUT";
export class ClaudeCodeError extends Error{
 constructor(message:string,readonly code:ClaudeCodeErrorCode){super(message);this.name="ClaudeCodeError";}
}

export type ClaudeCodeOptions={executable?:string;timeoutMs?:number;env?:NodeJS.ProcessEnv};

export function isSafeModel(model:string){return MODEL_PATTERN.test(model);}

/** Argv for one print-mode call. The prompt itself is never part of argv (it goes through stdin). */
export function buildClaudeArgs(model:string,system?:string){
 const args=["-p","--output-format","json","--tools","","--no-session-persistence","--setting-sources","project"];
 if(model&&model!=="default"){
  if(!isSafeModel(model))throw new ClaudeCodeError("Unsafe model name for claude-code: "+JSON.stringify(model),"CLAUDE_FAILED");
  args.push("--model",model);
 }
 if(system&&system.length<=MAX_SYSTEM_ARGV_CHARS)args.push("--system-prompt",system);
 return args;
}

export function claudeEnv(base:NodeJS.ProcessEnv=process.env){
 const env={...base};for(const name of STRIPPED_ENV)delete env[name];return env;
}
const tail=(text:string,max=500)=>redact(text.trim().slice(-max));
const looksUnauthenticated=(text:string)=>/not logged in|please run \/login|\/login|claude auth login|invalid api key|authentication|oauth token|credit balance/i.test(text);

type CliResult={is_error?:boolean;result?:string;subtype?:string;usage?:{input_tokens?:number;cache_creation_input_tokens?:number;cache_read_input_tokens?:number;output_tokens?:number};modelUsage?:Record<string,unknown>};

export class ClaudeCodeProvider implements ModelProvider{
 readonly name="claude-code";
 constructor(readonly model:string,private options:ClaudeCodeOptions={}){}

 async generate(request:ModelRequest):Promise<ModelResponse>{
  const executable=this.options.executable??DEFAULT_EXECUTABLE,timeoutMs=this.options.timeoutMs??DEFAULT_TIMEOUT_MS;
  const args=buildClaudeArgs(this.model,request.system);
  const stdin=request.system.length>MAX_SYSTEM_ARGV_CHARS?"<system-instructions>\n"+request.system+"\n</system-instructions>\n\n"+request.prompt:request.prompt;
  const scratch=await mkdtemp(join(tmpdir(),"companyswai-claude-"));
  try{
   const {stdout,stderr,code}=await this.run(executable,args,stdin,scratch,timeoutMs,request.signal);
   let parsed:CliResult|undefined;
   try{parsed=JSON.parse(stdout) as CliResult;}catch{/* handled below */}
   const failed=code!==0||parsed?.is_error===true;
   if(failed){
    const detail=tail(parsed?.result??((stderr||stdout)||"no output"));
    if(looksUnauthenticated(detail))throw new ClaudeCodeError("Claude Code is not logged in or its session is unusable; run `claude auth login` ("+detail+")","CLAUDE_NOT_LOGGED_IN");
    throw new ClaudeCodeError("claude-code failed (exit "+code+"): "+detail,"CLAUDE_FAILED");
   }
   if(!parsed||typeof parsed.result!=="string"||!parsed.result)throw new ClaudeCodeError("claude-code returned no text result: "+tail(stdout||stderr||"empty output"),"CLAUDE_BAD_OUTPUT");
   const usage=parsed.usage??{};
   return {
    text:parsed.result,
    inputTokens:(usage.input_tokens??0)+(usage.cache_creation_input_tokens??0)+(usage.cache_read_input_tokens??0),
    outputTokens:usage.output_tokens??0,
    model:Object.keys(parsed.modelUsage??{})[0]
   };
  }finally{await rm(scratch,{recursive:true,force:true});}
 }

 private run(executable:string,args:string[],stdin:string,cwd:string,timeoutMs:number,signal?:AbortSignal){
  return new Promise<{stdout:string;stderr:string;code:number}>((resolve,reject)=>{
   if(signal?.aborted){reject(new ClaudeCodeError("claude-code request cancelled","CLAUDE_CANCELLED"));return;}
   // No shell: argv is passed verbatim, so prompt/system/model text can never be interpreted as commands.
   const child=spawn(executable,args,{cwd,env:claudeEnv(this.options.env),stdio:["pipe","pipe","pipe"],shell:false});
   const out:Buffer[]=[],err:Buffer[]=[];let size=0,settled=false,killTimer:NodeJS.Timeout|undefined;
   const finish=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal?.removeEventListener("abort",onAbort);fn();};
   const stop=(error:ClaudeCodeError)=>{
    finish(()=>reject(error));
    child.kill("SIGTERM");killTimer=setTimeout(()=>child.kill("SIGKILL"),KILL_GRACE_MS);killTimer.unref();
   };
   const timer=setTimeout(()=>stop(new ClaudeCodeError("claude-code timed out after "+Math.round(timeoutMs/1000)+"s","CLAUDE_TIMEOUT")),timeoutMs);
   const onAbort=()=>stop(new ClaudeCodeError("claude-code request cancelled","CLAUDE_CANCELLED"));
   signal?.addEventListener("abort",onAbort,{once:true});
   child.stdout.on("data",chunk=>{size+=chunk.length;if(size>MAX_OUTPUT_BYTES){stop(new ClaudeCodeError("claude-code output exceeded "+MAX_OUTPUT_BYTES+" bytes","CLAUDE_FAILED"));return;}out.push(chunk);});
   child.stderr.on("data",chunk=>{if(err.reduce((n,b)=>n+b.length,0)<64*1024)err.push(chunk);});
   child.on("error",(error:NodeJS.ErrnoException)=>finish(()=>reject(error.code==="ENOENT"?new ClaudeCodeError("Claude Code executable '"+executable+"' was not found; install Claude Code and make sure it is on PATH","CLAUDE_NOT_FOUND"):new ClaudeCodeError("Could not start claude-code: "+error.message,"CLAUDE_FAILED"))));
   child.on("close",code=>finish(()=>resolve({stdout:Buffer.concat(out).toString("utf8"),stderr:Buffer.concat(err).toString("utf8"),code:code??-1})));
   child.stdin.on("error",()=>undefined);
   child.stdin.end(stdin);
  });
 }
}

export type ClaudeAvailability={ok:true;version:string;authMethod?:string;subscriptionType?:string}|{ok:false;reason:string};
/**
 * Non-interactive availability check: the executable exists and `claude auth status` reports a logged-in session.
 * Only the logged-in flag, auth method and plan type are read; nothing else from the status output is kept.
 * With probe:true it also performs one tiny real `claude -p` call (consumes a little subscription quota).
 */
export async function checkClaudeCode(options:ClaudeCodeOptions&{probe?:boolean;model?:string}={}):Promise<ClaudeAvailability>{
 const executable=options.executable??DEFAULT_EXECUTABLE,env=claudeEnv(options.env),timeout=options.timeoutMs??30_000;
 let version:string;
 try{version=(await execFileAsync(executable,["--version"],{timeout,env})).stdout.trim();}
 catch(error){
  if((error as NodeJS.ErrnoException).code==="ENOENT")return {ok:false,reason:"Claude Code executable '"+executable+"' was not found on PATH"};
  return {ok:false,reason:"`claude --version` failed: "+tail((error as Error).message)};
 }
 let status:{loggedIn?:boolean;authMethod?:string;subscriptionType?:string};
 try{status=JSON.parse((await execFileAsync(executable,["auth","status"],{timeout,env})).stdout);}
 catch(error){
  const stdout=(error as {stdout?:string}).stdout;
  try{status=JSON.parse(stdout??"");}catch{return {ok:false,reason:"Claude Code is not logged in (`claude auth status` failed); run `claude auth login`"};}
 }
 if(!status.loggedIn)return {ok:false,reason:"Claude Code is not logged in; run `claude auth login`"};
 if(options.probe){
  try{await new ClaudeCodeProvider(options.model??"default",{...options,timeoutMs:options.timeoutMs??120_000}).generate({system:"Answer with one word.",prompt:"Reply with exactly: ok",maxTokens:16});}
  catch(error){return {ok:false,reason:"probe call failed: "+tail((error as Error).message)};}
 }
 return {ok:true,version,authMethod:status.authMethod,subscriptionType:status.subscriptionType};
}
