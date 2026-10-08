import assert from "node:assert/strict";
import test from "node:test";
import {chmod,mkdtemp,readFile,readdir,stat,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {delimiter,join} from "node:path";
import {ProjectOrchestrator} from "../src/orchestrator.js";
import {ProviderRegistry} from "../src/provider.js";
import {ClaudeCodeError,ClaudeCodeProvider,buildClaudeArgs,checkClaudeCode,claudeEnv,isSafeModel} from "../src/providers/claude-code.js";
import {createProviderRegistry,loadRuntime,loadRuntimeConfig,toCapacityProfile} from "../src/runtime.js";
import {estimateProject} from "../src/estimate.js";
import {classifyProviderError} from "../src/provider-selector.js";
import {fakeAnthropicKey,plan,task,tmpDir,tmpState} from "./helpers.js";

// A stand-in `claude` executable. Behaviour comes from FAKE_MODE; what it was called with is written to FAKE_CAPTURE.
const FAKE=`#!/usr/bin/env node
const fs=require("fs");
const mode=process.env.FAKE_MODE||"ok",args=process.argv.slice(2);
if(args[0]==="--version"){console.log("9.9.9 (Claude Code)");process.exit(0);}
if(args[0]==="auth"){
 if(mode==="loggedout"){console.log(JSON.stringify({loggedIn:false}));process.exit(1);}
 console.log(JSON.stringify({loggedIn:true,authMethod:"claude.ai",subscriptionType:"team",email:"person@example.test",orgName:"Some Org"}));process.exit(0);
}
let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
 if(process.env.FAKE_CAPTURE)fs.writeFileSync(process.env.FAKE_CAPTURE,JSON.stringify({argv:args,stdin:input,cwd:process.cwd(),sawApiKey:Boolean(process.env.ANTHROPIC_API_KEY)}));
 const reply=result=>{console.log(JSON.stringify({type:"result",is_error:false,result,usage:{input_tokens:3,cache_creation_input_tokens:100,cache_read_input_tokens:10,output_tokens:7},modelUsage:{"claude-fake-1":{}},total_cost_usd:9.99}));process.exit(0);};
 if(mode==="sleep"){setTimeout(()=>process.exit(0),20000);return;}
 if(mode==="fail"){console.error("exploded token "+process.env.LEAK_ME);process.exit(3);}
 if(mode==="unauth"){console.log(JSON.stringify({is_error:true,result:"Not logged in · Please run /login"}));process.exit(1);}
 if(mode==="iserror"){console.log(JSON.stringify({is_error:true,result:"model overloaded"}));process.exit(0);}
 if(mode==="garbage"){console.log("not json at all");process.exit(0);}
 if(input.includes("Review the output below"))return reply("PASS\\n\\n## Evidence\\nchecked\\n\\n## Blockers\\nNone.");
 reply("## Deliverables\\nfake work\\n\\n## Decisions\\nNone.\\n\\n## Evidence\\nfake evidence\\n\\n## Blockers\\nNone.\\n\\n## Handoff\\nnext");
});
`;
async function installFake(){
 const dir=await mkdtemp(join(tmpdir(),"companyswai-fakeclaude-")),path=join(dir,"claude");
 await writeFile(path,FAKE);await chmod(path,0o755);return {dir,path};
}
const request={system:"system text",prompt:"prompt text",maxTokens:100};
const withEnv=(env:Record<string,string>)=>({...process.env,...env});
const failCode=(code:string)=>(error:unknown)=>error instanceof ClaudeCodeError&&error.code===code;

test("claude-code is a registered provider kind and the existing kinds are unchanged",()=>{
 const registry=createProviderRegistry();
 assert.deepEqual(registry.ids().sort(),["anthropic","claude-code","openai-compatible","openrouter"]);
 const provider=registry.create("claude-code",{model:"sonnet"});
 assert.equal(provider.name,"claude-code");assert.equal(provider.model,"sonnet");
 assert.ok(new ProviderRegistry().register("x",()=>provider).has("x"));
 assert.throws(()=>registry.create("anthropic",{model:"m"}),/needs an API key/);
});

test("claude-code profiles need no credentialEnv; per-token prices and unsafe values are rejected",async()=>{
 const dir=await tmpDir(),path=join(dir,"p.json"),base={provider:"claude-code",capabilities:["reasoning"],contextWindow:200000,maxConcurrency:1};
 await writeFile(path,JSON.stringify({providers:[{...base,id:"claude-code-team",model:"sonnet"}]}));
 const [profile]=await loadRuntimeConfig(path);
 assert.equal(profile.credentialEnv,undefined);assert.equal(toCapacityProfile(profile).billing,"subscription");
 await writeFile(path,JSON.stringify({providers:[{...base,id:"a",model:"sonnet",inputCostPerMillion:3,outputCostPerMillion:15}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/subscription billed/);
 await writeFile(path,JSON.stringify({providers:[{...base,id:"a",model:"--dangerously-skip-permissions"}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/unsafe model/);
 await writeFile(path,JSON.stringify({providers:[{...base,id:"a",model:"sonnet",command:"/tmp/evil"}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/bare executable name/);
 await writeFile(path,JSON.stringify({providers:[{...base,id:"a",model:"sonnet",command:"claude; rm -rf /"}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/bare executable name/);
});

test("arguments are built without a shell: model validated, prompt only via stdin, no hard-coded model version",async()=>{
 assert.deepEqual(buildClaudeArgs("sonnet"),["-p","--output-format","json","--tools","","--no-session-persistence","--setting-sources","project","--model","sonnet"]);
 assert.ok(!buildClaudeArgs("default").includes("--model"));
 assert.deepEqual(buildClaudeArgs("opus","SYS").slice(-2),["--system-prompt","SYS"]);
 for(const bad of ["x; rm -rf /","$(whoami)","--model","-p","a b","`id`","","a\nb"])assert.equal(isSafeModel(bad),false,JSON.stringify(bad));
 assert.throws(()=>buildClaudeArgs("evil; touch pwned"),failCode("CLAUDE_FAILED"));
 const {path}=await installFake(),capture=join(await tmpDir(),"capture.json"),marker=join(await tmpDir(),"pwned");
 const nasty="line1\n$(touch "+marker+") `touch "+marker+"` ; touch "+marker+" && echo '\"'";
 const provider=new ClaudeCodeProvider("sonnet",{executable:path,env:withEnv({FAKE_CAPTURE:capture})});
 await provider.generate({system:"sys $(touch "+marker+")",prompt:nasty,maxTokens:10});
 const seen=JSON.parse(await readFile(capture,"utf8"));
 assert.equal(seen.stdin,nasty,"prompt travels through stdin byte for byte");
 assert.ok(!seen.argv.some((a:string)=>a.includes("line1")),"prompt is never in argv");
 assert.equal(seen.argv[seen.argv.indexOf("--system-prompt")+1],"sys $(touch "+marker+")");
 assert.equal(seen.argv[seen.argv.indexOf("--tools")+1],"");assert.ok(seen.argv.includes("--no-session-persistence"));
 await assert.rejects(()=>stat(marker),"no shell interpreted the text");
});

test("a successful call returns text, summed token usage and the model that actually answered",async()=>{
 const {path}=await installFake();
 const result=await new ClaudeCodeProvider("sonnet",{executable:path,env:withEnv({FAKE_MODE:"ok"})}).generate(request);
 assert.match(result.text,/## Deliverables/);assert.equal(result.inputTokens,113);assert.equal(result.outputTokens,7);assert.equal(result.model,"claude-fake-1");
});

test("very large system prompts move to stdin instead of argv",async()=>{
 const {path}=await installFake(),capture=join(await tmpDir(),"c.json"),big="S".repeat(120_000);
 await new ClaudeCodeProvider("sonnet",{executable:path,env:withEnv({FAKE_CAPTURE:capture})}).generate({system:big,prompt:"p",maxTokens:1});
 const seen=JSON.parse(await readFile(capture,"utf8"));assert.ok(!seen.argv.includes("--system-prompt"));assert.ok(seen.stdin.includes(big));
});

test("timeout and cancellation stop the CLI and report distinct errors",async()=>{
 const {path}=await installFake(),started=Date.now();
 await assert.rejects(()=>new ClaudeCodeProvider("sonnet",{executable:path,timeoutMs:300,env:withEnv({FAKE_MODE:"sleep"})}).generate(request),failCode("CLAUDE_TIMEOUT"));
 assert.ok(Date.now()-started<5000);
 const controller=new AbortController();setTimeout(()=>controller.abort(),200);
 await assert.rejects(()=>new ClaudeCodeProvider("sonnet",{executable:path,env:withEnv({FAKE_MODE:"sleep"})}).generate({...request,signal:controller.signal}),failCode("CLAUDE_CANCELLED"));
 const pre=new AbortController();pre.abort();
 await assert.rejects(()=>new ClaudeCodeProvider("sonnet",{executable:path}).generate({...request,signal:pre.signal}),failCode("CLAUDE_CANCELLED"));
 assert.equal(classifyProviderError(new ClaudeCodeError("claude-code timed out after 1s","CLAUDE_TIMEOUT"))?.state,"UNAVAILABLE");
 assert.equal(classifyProviderError(new ClaudeCodeError("claude-code request cancelled","CLAUDE_CANCELLED")),undefined);
});

test("non-zero exit, error results and garbage output become useful, redacted provider errors",async()=>{
 const {path}=await installFake(),run=(mode:string,extra:Record<string,string>={})=>new ClaudeCodeProvider("sonnet",{executable:path,env:withEnv({FAKE_MODE:mode,...extra})}).generate(request);
 await assert.rejects(()=>run("fail",{LEAK_ME:fakeAnthropicKey()}),error=>error instanceof ClaudeCodeError&&error.code==="CLAUDE_FAILED"&&/exit 3/.test(error.message)&&/exploded/.test(error.message)&&!error.message.includes(fakeAnthropicKey()));
 await assert.rejects(()=>run("iserror"),error=>error instanceof ClaudeCodeError&&/model overloaded/.test(error.message));
 await assert.rejects(()=>run("garbage"),failCode("CLAUDE_BAD_OUTPUT"));
 await assert.rejects(()=>run("unauth"),error=>error instanceof ClaudeCodeError&&error.code==="CLAUDE_NOT_LOGGED_IN"&&/claude auth login/.test(error.message));
 assert.equal(classifyProviderError(new ClaudeCodeError("Claude Code is not logged in or its session is unusable","CLAUDE_NOT_LOGGED_IN"))?.state,"UNAVAILABLE");
});

test("availability: missing executable, logged-out session and healthy session are told apart",async()=>{
 const {path}=await installFake();
 const missing=await checkClaudeCode({executable:join(await tmpDir(),"no-such-claude")});
 assert.equal(missing.ok,false);assert.match(missing.ok?"":missing.reason,/not found/);
 const gone=join(await tmpDir(),"no-such-claude");
 await assert.rejects(()=>new ClaudeCodeProvider("sonnet",{executable:gone}).generate(request),failCode("CLAUDE_NOT_FOUND"));
 const out=await checkClaudeCode({executable:path,env:withEnv({FAKE_MODE:"loggedout"})});
 assert.equal(out.ok,false);assert.match(out.ok?"":out.reason,/not logged in/);
 const good=await checkClaudeCode({executable:path,env:withEnv({FAKE_MODE:"ok"})});
 assert.deepEqual(good,{ok:true,version:"9.9.9 (Claude Code)",authMethod:"claude.ai",subscriptionType:"team"});
 assert.ok(!JSON.stringify(good).includes("person@example.test"),"identity details are not carried around");
 assert.equal((await checkClaudeCode({executable:path,probe:true,env:withEnv({FAKE_MODE:"unauth"})})).ok,false);
 assert.equal((await checkClaudeCode({executable:path,probe:true,env:withEnv({FAKE_MODE:"ok"})})).ok,true);
});

test("no authentication material is passed on or persisted",async()=>{
 const {path}=await installFake(),capture=join(await tmpDir(),"c.json"),key=fakeAnthropicKey();
 const env=claudeEnv({PATH:"/bin",ANTHROPIC_API_KEY:key,ANTHROPIC_AUTH_TOKEN:"t",CLAUDE_CODE_USE_BEDROCK:"1",HOME:"/h"});
 assert.deepEqual(Object.keys(env).sort(),["HOME","PATH"],"API-key and cloud switches are removed so the signed-in subscription is used");
 await new ClaudeCodeProvider("sonnet",{executable:path,env:withEnv({FAKE_CAPTURE:capture,ANTHROPIC_API_KEY:key})}).generate(request);
 const seen=JSON.parse(await readFile(capture,"utf8"));assert.equal(seen.sawApiKey,false);
 await assert.rejects(()=>stat(seen.cwd),"the scratch working directory is removed after the call");
 // end to end: nothing the CLI reported about the account reaches the state directory
 const state=await tmpState(),old=process.env.PATH,oldKey=process.env.ANTHROPIC_API_KEY;
 process.env.PATH=(await installFake()).dir+delimiter+old;process.env.ANTHROPIC_API_KEY=key;
 try{
  const cfg=join(await tmpDir(),"p.json");
  await writeFile(cfg,JSON.stringify({providers:[{id:"cc",provider:"claude-code",model:"sonnet",capabilities:["reasoning","review"],contextWindow:200000,maxConcurrency:1}]}));
  const runtime=await loadRuntime(cfg);
  await new ProjectOrchestrator(runtime.selector,state).run(plan("secret-scan",[task("a")]));
  const files:string[]=[];const walk=async(dir:string)=>{for(const e of await readdir(dir,{withFileTypes:true}))e.isDirectory()?await walk(join(dir,e.name)):files.push(join(dir,e.name));};
  await walk(state.root);assert.ok(files.length>5);
  for(const file of files){const text=await readFile(file,"utf8");for(const needle of [key,"person@example.test","Some Org"])assert.ok(!text.includes(needle),file+" leaked "+needle);}
 }finally{process.env.PATH=old;if(oldKey==null)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldKey;}
});

test("routing through a claude-code profile: runs complete, records show provider/model/billing, money budgets do not misfire",async()=>{
 const state=await tmpState(),old=process.env.PATH;process.env.PATH=(await installFake()).dir+delimiter+old;
 try{
  const cfg=join(await tmpDir(),"p.json");
  await writeFile(cfg,JSON.stringify({providers:[{id:"claude-code-team",provider:"claude-code",model:"sonnet",capabilities:["reasoning","review"],contextWindow:200000,maxConcurrency:1}]}));
  const runtime=await loadRuntime(cfg);assert.deepEqual(runtime.profiles.map(p=>p.billing),["subscription"]);assert.deepEqual(runtime.skipped,[]);
  const review={role:"qa-reviewer",department:"quality",system:"reviewer",capabilities:["review"],estimatedInputTokens:10,estimatedOutputTokens:10,maxTokens:100,maxRounds:2};
  const summary=await new ProjectOrchestrator(runtime.selector,state).run(plan("cc",[task("a",{review,contract:{sections:["Deliverables","Decisions","Evidence","Blockers","Handoff"],verdict:false}}),task("b",{dependencies:["a"]})],{budget:{maxProjectCost:0.01,approvalThreshold:0.001}}));
  assert.deepEqual(summary.completed.sort(),["a","b"]);assert.deepEqual(summary.failed,[]);assert.deepEqual(summary.approvalRequired,[]);
  const records=(await state.executions.list("cc")).filter(r=>r.status==="SUCCEEDED");
  assert.ok(records.length>=3);
  for(const r of records){assert.equal(r.provider,"claude-code");assert.equal(r.model,"claude-fake-1");assert.equal(r.billing,"subscription");assert.equal(r.actualCost,undefined);assert.equal(r.estimatedCost,undefined);assert.ok(r.inputTokens>0);}
  assert.equal(summary.budget.project.subscriptionRuns,summary.budget.project.runs);assert.equal(summary.budget.project.actual,0);
 }finally{process.env.PATH=old;}
});

test("a claude-code profile that is not logged in is skipped with the reason and never routed to",async()=>{
 const cfg=join(await tmpDir(),"p.json");
 await writeFile(cfg,JSON.stringify({providers:[{id:"cc",provider:"claude-code",model:"sonnet",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1}]}));
 await assert.rejects(()=>loadRuntime(cfg,{checkClaude:async()=>({ok:false,reason:"Claude Code is not logged in; run `claude auth login`"})}),/cc: missing Claude Code is not logged in/);
 process.env.CSWAI_CC_KEY="some-test-credential-value";
 try{
  await writeFile(cfg,JSON.stringify({providers:[{id:"cc",provider:"claude-code",model:"sonnet",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1},{id:"api",provider:"openrouter",model:"m",credentialEnv:"CSWAI_CC_KEY",capabilities:["reasoning"],contextWindow:1000,maxConcurrency:1}]}));
  const runtime=await loadRuntime(cfg,{checkClaude:async()=>({ok:false,reason:"down"})});
  assert.deepEqual(runtime.profiles.map(p=>p.id),["api"]);assert.deepEqual(runtime.skipped,[{id:"cc",missing:"down"}]);
 }finally{delete process.env.CSWAI_CC_KEY;}
});

test("estimate marks subscription cost as n/a instead of $0 and never claims per-token pricing",async()=>{
 const dir=await tmpDir(),cfg=join(dir,"p.json");
 await writeFile(cfg,JSON.stringify({providers:[{id:"cc",provider:"claude-code",model:"sonnet",capabilities:["reasoning","coding"],contextWindow:200000,maxConcurrency:1}]}));
 const profiles=(await loadRuntimeConfig(cfg)).map(toCapacityProfile);
 const p:any={projectId:"p",budget:{maxProjectCost:1},tasks:[{id:"a",agentRole:"dev",dependencies:[],system:"s",prompt:"p",inputRefs:[],maxTokens:10,capabilities:["coding"],estimatedInputTokens:1000,estimatedOutputTokens:1000}]};
 const out=estimateProject(p,profiles);
 assert.equal(out.tasks[0].cost,undefined);assert.equal(out.tasks[0].costBasis,"subscription");
 assert.equal(out.totalKnownCost,0);assert.deepEqual(out.subscriptionTasks,["a"]);assert.deepEqual(out.unknownCostTasks,[]);
 assert.match(out.budget.note??"",/subscription-billed/);assert.equal(out.modelMix[0].costBasis,"subscription");
 const unpriced=estimateProject(p,[{...profiles[0],billing:"metered"}]);assert.equal(unpriced.tasks[0].costBasis,"unknown");assert.deepEqual(unpriced.unknownCostTasks,["a"]);
});
