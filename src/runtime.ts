import Anthropic from "@anthropic-ai/sdk";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import type {CapacityProfile} from "./capacity.js";
import {ProviderRegistry} from "./provider.js";
import {createCapacitySelector} from "./provider-selector.js";
import {registerSecret} from "./secrets.js";
import {AnthropicProvider} from "./providers/anthropic.js";
import {OpenAICompatibleProvider} from "./providers/openai-compatible.js";
import {OpenRouterProvider} from "./providers/openrouter.js";
import {ClaudeCodeProvider,checkClaudeCode,isSafeModel,type ClaudeAvailability} from "./providers/claude-code.js";

const Profile=z.object({
 id:z.string().min(1).optional(),provider:z.string().min(1),model:z.string().min(1),
 credentialEnv:z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),baseUrl:z.string().url().optional(),qualityTier:z.number().int().min(1).max(5).optional(),locality:z.enum(["local","remote"]).optional(),command:z.string().regex(/^[A-Za-z0-9._-]+$/,"command must be a bare executable name").optional(),timeoutMs:z.number().int().positive().optional(),
 state:z.enum(["AVAILABLE","QUOTA_LOW","RATE_LIMITED","OUT_OF_CREDIT","UNAVAILABLE"]).default("AVAILABLE"),capabilities:z.array(z.string()).min(1),contextWindow:z.number().int().positive(),
 inputCostPerMillion:z.number().nonnegative().optional(),outputCostPerMillion:z.number().nonnegative().optional(),creditRemaining:z.number().nonnegative().optional(),tokenQuotaRemaining:z.number().int().nonnegative().optional(),resetAt:z.string().optional(),maxConcurrency:z.number().int().positive().default(1),estimatedTokensPerSecond:z.number().positive().optional()
});
import {RoutingPolicy} from "./company.js";
const RuntimeConfig=z.object({providers:z.array(Profile).min(1),routing:z.object({policy:RoutingPolicy.default("BALANCED"),healthWindow:z.number().int().min(3).max(200).default(20)}).default({policy:"BALANCED",healthWindow:20})});
export type RuntimeProfile=z.infer<typeof Profile>&{id:string};

const requireKey=(kind:string,apiKey?:string)=>{if(!apiKey)throw new Error("Provider kind '"+kind+"' needs an API key");return apiKey;};
/** Provider kinds that sign in through their own tool, bill by subscription instead of per token, and need no credentialEnv. */
const SUBSCRIPTION_KINDS=new Set(["claude-code"]);
export const usesSubscription=(provider:string)=>SUBSCRIPTION_KINDS.has(provider);

/** Built-in provider kinds. New kinds register a factory here; nothing else in the runtime is provider specific. */
export function createProviderRegistry(){
 return new ProviderRegistry()
  .register("anthropic",({apiKey,model,timeoutMs})=>new AnthropicProvider(new Anthropic({apiKey:requireKey("anthropic",apiKey),maxRetries:1,...(timeoutMs?{timeout:timeoutMs}:{})}),model))
  .register("openrouter",({apiKey,model,baseUrl,timeoutMs})=>new OpenRouterProvider(requireKey("openrouter",apiKey),model,baseUrl,timeoutMs))
  .register("openai-compatible",({apiKey,model,baseUrl,timeoutMs})=>{
   if(!baseUrl)throw new Error("openai-compatible profiles require baseUrl");
   return new OpenAICompatibleProvider("openai-compatible",requireKey("openai-compatible",apiKey),model,baseUrl.replace(/\/$/,""),timeoutMs);
  })
  // Authentication belongs to the Claude CLI itself: no credential is read, passed or stored here.
  .register("claude-code",({model,command,timeoutMs})=>new ClaudeCodeProvider(model,{executable:command,timeoutMs}));
}

const defaultCredential:Record<string,string>={anthropic:"ANTHROPIC_API_KEY",openrouter:"OPENROUTER_API_KEY"};
const credentialEnvFor=(profile:RuntimeProfile)=>usesSubscription(profile.provider)?undefined:profile.credentialEnv??defaultCredential[profile.provider];

export async function readRuntimeFile(path:string,registry=createProviderRegistry()){
 const config=RuntimeConfig.parse(JSON.parse(await readFile(path,"utf8")));
 const profiles=config.providers.map((profile,index)=>({...profile,id:profile.id??profile.provider+"-"+profile.model.replace(/[^A-Za-z0-9._-]/g,"-")+"-"+index}));
 const ids=new Set<string>();
 for(const profile of profiles){
  if(ids.has(profile.id))throw new Error("Duplicate provider profile id: "+profile.id);ids.add(profile.id);
  if(!registry.has(profile.provider))throw new Error("Unknown provider kind '"+profile.provider+"' in profile "+profile.id+" (registered: "+registry.ids().join(", ")+")");
  if(usesSubscription(profile.provider)){
   if(profile.inputCostPerMillion!=null||profile.outputCostPerMillion!=null||profile.creditRemaining!=null)throw new Error("Profile "+profile.id+" is subscription billed ('"+profile.provider+"'); remove per-token prices and credit — they would misstate cost");
   if(!isSafeModel(profile.model)&&profile.model!=="default")throw new Error("Profile "+profile.id+" has an unsafe model name");
  }else if(!credentialEnvFor(profile))throw new Error("Profile "+profile.id+" needs credentialEnv: provider '"+profile.provider+"' has no default credential variable");
  if(profile.provider==="openai-compatible"&&!profile.baseUrl)throw new Error("Profile "+profile.id+" needs baseUrl");
 }
 return {profiles:profiles as RuntimeProfile[],routing:config.routing};
}
export async function loadRuntimeConfig(path:string,registry=createProviderRegistry()):Promise<RuntimeProfile[]>{return (await readRuntimeFile(path,registry)).profiles;}

/** The routing view of a profile: connection details stay behind, billing is derived from the provider kind. */
const isLoopback=(url?:string)=>{try{return url?["localhost","127.0.0.1","[::1]","::1"].includes(new URL(url).hostname):false;}catch{return false;}};
export function toCapacityProfile({credentialEnv:_credentialEnv,baseUrl,timeoutMs:_timeoutMs,command:_command,...profile}:RuntimeProfile):CapacityProfile{
 const local=profile.locality??(usesSubscription(profile.provider)||isLoopback(baseUrl)?"local":"remote");
 return {...profile,locality:local,billing:usesSubscription(profile.provider)?"subscription":"metered"};
}

export type RuntimeOptions={registry?:ProviderRegistry;checkClaude?:(profile:RuntimeProfile)=>Promise<ClaudeAvailability>};

export async function loadRuntime(path:string,options:RuntimeOptions={}){
 const registry=options.registry??createProviderRegistry(),check=options.checkClaude??(profile=>checkClaudeCode({executable:profile.command}));
 const {profiles:config,routing}=await readRuntimeFile(path,registry);
 const keyed=new Map(config.map(profile=>[profile.id,profile]));
 const usable:RuntimeProfile[]=[],skipped:Array<{id:string;missing:string}>=[];
 for(const profile of config){
  if(usesSubscription(profile.provider)){
   const availability=await check(profile);
   if(availability.ok)usable.push(profile);else skipped.push({id:profile.id,missing:availability.reason});
  }else{
   const env=credentialEnvFor(profile)!;
   if(process.env[env]){usable.push(profile);registerSecret(process.env[env]);}else skipped.push({id:profile.id,missing:env});
  }
 }
 if(usable.length===0)throw new Error("No configured provider profile is usable. "+skipped.map(x=>x.id+": missing "+x.missing).join("; "));
 const profiles=usable.map(toCapacityProfile);
 const selector=createCapacitySelector(profiles,(_provider,_model,capacityProfile)=>{
  const profile=capacityProfile?.id?keyed.get(capacityProfile.id):undefined;
  if(!profile)throw new Error("Unknown provider profile: "+capacityProfile?.id);
  const env=credentialEnvFor(profile),apiKey=env?process.env[env]:undefined;
  if(env&&!apiKey)throw new Error("Missing credential environment variable: "+env);
  return registry.create(profile.provider,{model:profile.model,apiKey,baseUrl:profile.baseUrl,timeoutMs:profile.timeoutMs,command:profile.command});
 },{defaultPolicy:routing.policy,healthWindow:routing.healthWindow});
 return {profiles,selector,skipped,routing};
}
