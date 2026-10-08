import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {CapacityProfile} from "../src/capacity.js";
import type {ModelProvider,ModelRequest,ModelResponse} from "../src/provider.js";
import {createCapacitySelector,type ProviderSelector} from "../src/provider-selector.js";
import type {ProjectPlanInput} from "../src/project.js";
import {REVIEW_REQUEST_PREFIX} from "../src/output-parser.js";
import {CompanyState} from "../src/state.js";

export async function tmpState(){return new CompanyState(await mkdtemp(join(tmpdir(),"companyswai-state-")));}
export async function tmpDir(prefix="companyswai-"){return mkdtemp(join(tmpdir(),prefix));}

/** A response that satisfies the output contract. */
export const compliant=(body="work",extra:{decisions?:string;blockers?:string;handoff?:string}={})=>
 "## Deliverables\n"+body+"\n\n## Decisions\n"+(extra.decisions??"None.")+"\n\n## Evidence\nchecked: "+body+"\n\n## Blockers\n"+(extra.blockers??"None.")+"\n\n## Handoff\n"+(extra.handoff??"next owner continues");
export const pass=(evidence="verified")=>"PASS\n\n## Evidence\n"+evidence+"\n\n## Blockers\nNone.";
export const changes=(why="fix it")=>"CHANGES_REQUIRED\n\n## Evidence\n"+why+"\n\n## Blockers\n"+why;
export const isReviewRequest=(request:ModelRequest)=>request.prompt.startsWith(REVIEW_REQUEST_PREFIX);

export type Generate=(request:ModelRequest,profileId:string)=>Promise<ModelResponse>|ModelResponse;
export function selectorFor(generate:Generate,profiles:Array<Partial<CapacityProfile>&{id:string}>=[{id:"main",inputCostPerMillion:0,outputCostPerMillion:0,maxConcurrency:8}],options?:Parameters<typeof createCapacitySelector>[2]):ProviderSelector{
 return createCapacitySelector(profiles.map(p=>({provider:"fake",model:"m-"+p.id,state:"AVAILABLE",capabilities:["reasoning","coding","review","testing","product","architecture","design","deployment"],contextWindow:100000,maxConcurrency:1,...p})),(_provider,model,profile):ModelProvider=>({
  name:"fake",model,generate:async request=>generate(request,profile!.id!)
 }),options);
}
export const usage=(text:string):ModelResponse=>({text,inputTokens:10,outputTokens:10});

export type TaskOverrides=Record<string,unknown>;
export function task(id:string,overrides:TaskOverrides={}){
 return {id,agentRole:"dev-"+id,department:"engineering",dependencies:[] as string[],system:"maker system "+id,prompt:"do the work for "+id,inputRefs:[],maxTokens:100,capabilities:["reasoning"],estimatedInputTokens:100,estimatedOutputTokens:100,...overrides};
}
export const reviewer=(overrides:TaskOverrides={})=>({role:"qa-reviewer",department:"quality",system:"reviewer system",capabilities:["review"],estimatedInputTokens:100,estimatedOutputTokens:100,maxTokens:100,maxRounds:2,...overrides});
export const plan=(projectId:string,tasks:ReturnType<typeof task>[],extra:Record<string,unknown>={}):ProjectPlanInput=>({projectId,budget:{},tasks,...extra}) as ProjectPlanInput;

/** Credential-shaped fixtures are assembled at runtime so the repository itself never contains one (the doctor scans for them). */
export const fakeAnthropicKey=()=>["sk","ant","api03","abcdefghij1234567890"].join("-");
export const fakeOpenRouterKey=()=>["sk","or","live","secret","value","123456"].join("-");
export const fakePrivateKey=()=>["-----BEGIN RSA ","PRIVATE KEY-----\nabc\n-----END RSA ","PRIVATE KEY-----"].join("");

/** One-shot barrier: resolves once `n` callers have arrived (or after a safety timeout), then lets everyone straight through. Removes sleep-based timing from concurrency assertions. */
export function rendezvous(n:number,timeoutMs=2000){
 let arrived=0,open=n<=1;const waiters:Array<()=>void>=[];
 const release=()=>{open=true;for(const w of waiters.splice(0))w();};
 return ()=>open?Promise.resolve():new Promise<void>(resolve=>{waiters.push(resolve);arrived++;if(arrived>=n)release();else setTimeout(release,timeoutMs).unref();});
}
