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

const Profile=z.object({
 id:z.string().min(1).optional(),provider:z.string().min(1),model:z.string().min(1),
 credentialEnv:z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),baseUrl:z.string().url().optional(),timeoutMs:z.number().int().positive().optional(),
 state:z.enum(["AVAILABLE","QUOTA_LOW","RATE_LIMITED","OUT_OF_CREDIT","UNAVAILABLE"]).default("AVAILABLE"),capabilities:z.array(z.string()).min(1),contextWindow:z.number().int().positive(),
 inputCostPerMillion:z.number().nonnegative().optional(),outputCostPerMillion:z.number().nonnegative().optional(),creditRemaining:z.number().nonnegative().optional(),tokenQuotaRemaining:z.number().int().nonnegative().optional(),resetAt:z.string().optional(),maxConcurrency:z.number().int().positive().default(1),estimatedTokensPerSecond:z.number().positive().optional()
});
const RuntimeConfig=z.object({providers:z.array(Profile).min(1)});
export type RuntimeProfile=z.infer<typeof Profile>&{id:string};

/** Built-in provider kinds. New kinds register a factory here; nothing else in the runtime is provider specific. */
export function createProviderRegistry(){
 return new ProviderRegistry()
  .register("anthropic",({apiKey,model,timeoutMs})=>new AnthropicProvider(new Anthropic({apiKey,maxRetries:1,...(timeoutMs?{timeout:timeoutMs}:{})}),model))
  .register("openrouter",({apiKey,model,baseUrl,timeoutMs})=>new OpenRouterProvider(apiKey,model,baseUrl,timeoutMs))
  .register("openai-compatible",({apiKey,model,baseUrl,timeoutMs})=>{
   if(!baseUrl)throw new Error("openai-compatible profiles require baseUrl");
   return new OpenAICompatibleProvider("openai-compatible",apiKey,model,baseUrl.replace(/\/$/,""),timeoutMs);
  });
}

const defaultCredential:Record<string,string>={anthropic:"ANTHROPIC_API_KEY",openrouter:"OPENROUTER_API_KEY"};
const credentialEnvFor=(profile:RuntimeProfile)=>profile.credentialEnv??defaultCredential[profile.provider];

export async function loadRuntimeConfig(path:string,registry=createProviderRegistry()):Promise<RuntimeProfile[]>{
 const config=RuntimeConfig.parse(JSON.parse(await readFile(path,"utf8")));
 const profiles=config.providers.map((profile,index)=>({...profile,id:profile.id??profile.provider+"-"+profile.model.replace(/[^A-Za-z0-9._-]/g,"-")+"-"+index}));
 const ids=new Set<string>();
 for(const profile of profiles){
  if(ids.has(profile.id))throw new Error("Duplicate provider profile id: "+profile.id);ids.add(profile.id);
  if(!registry.has(profile.provider))throw new Error("Unknown provider kind '"+profile.provider+"' in profile "+profile.id+" (registered: "+registry.ids().join(", ")+")");
  if(!credentialEnvFor(profile))throw new Error("Profile "+profile.id+" needs credentialEnv: provider '"+profile.provider+"' has no default credential variable");
  if(profile.provider==="openai-compatible"&&!profile.baseUrl)throw new Error("Profile "+profile.id+" needs baseUrl");
 }
 return profiles;
}

export async function loadRuntime(path:string,registry=createProviderRegistry()){
 const config=await loadRuntimeConfig(path,registry);
 const keyed=new Map(config.map(profile=>[profile.id,profile]));
 const usable=config.filter(profile=>Boolean(process.env[credentialEnvFor(profile)!]));
 const skipped=config.filter(profile=>!usable.includes(profile)).map(profile=>({id:profile.id,missing:credentialEnvFor(profile)!}));
 if(usable.length===0)throw new Error("No configured provider profile has credentials. Set the credentialEnv variable of at least one profile ("+skipped.map(x=>x.missing).join(", ")+").");
 for(const profile of usable)registerSecret(process.env[credentialEnvFor(profile)!]);
 const profiles:CapacityProfile[]=usable.map(({credentialEnv:_credentialEnv,baseUrl:_baseUrl,timeoutMs:_timeoutMs,...profile})=>profile);
 const selector=createCapacitySelector(profiles,(_provider,_model,capacityProfile)=>{
  const profile=capacityProfile?.id?keyed.get(capacityProfile.id):undefined;
  if(!profile)throw new Error("Unknown provider profile: "+capacityProfile?.id);
  const env=credentialEnvFor(profile)!,apiKey=process.env[env];
  if(!apiKey)throw new Error("Missing credential environment variable: "+env);
  return registry.create(profile.provider,{model:profile.model,apiKey,baseUrl:profile.baseUrl,timeoutMs:profile.timeoutMs});
 });
 return {profiles,selector,skipped};
}
