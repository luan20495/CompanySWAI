import Anthropic from "@anthropic-ai/sdk";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import type {CapacityProfile} from "./capacity.js";
import {createCapacitySelector} from "./provider-selector.js";
import {AnthropicProvider} from "./providers/anthropic.js";
import {OpenRouterProvider} from "./providers/openrouter.js";

const Profile=z.object({
 id:z.string().min(1).optional(),provider:z.enum(["anthropic","openrouter"]),model:z.string().min(1),credentialEnv:z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
 state:z.enum(["AVAILABLE","QUOTA_LOW","RATE_LIMITED","OUT_OF_CREDIT","UNAVAILABLE"]).default("AVAILABLE"),capabilities:z.array(z.string()).min(1),contextWindow:z.number().int().positive(),
 inputCostPerMillion:z.number().nonnegative().optional(),outputCostPerMillion:z.number().nonnegative().optional(),creditRemaining:z.number().nonnegative().optional(),tokenQuotaRemaining:z.number().int().nonnegative().optional(),resetAt:z.string().optional(),maxConcurrency:z.number().int().positive().default(1),estimatedTokensPerSecond:z.number().positive().optional()
});
const RuntimeConfig=z.object({providers:z.array(Profile).min(1)});
export type RuntimeProfile=z.infer<typeof Profile>;

export async function loadRuntimeConfig(path:string){
 const config=RuntimeConfig.parse(JSON.parse(await readFile(path,"utf8")));
 return config.providers.map((profile,index)=>({...profile,id:profile.id??profile.provider+"-"+profile.model.replace(/[^A-Za-z0-9._-]/g,"-")+"-"+index})) as Array<RuntimeProfile&{id:string}>;
}
const defaultCredential=(provider:string)=>provider==="anthropic"?"ANTHROPIC_API_KEY":"OPENROUTER_API_KEY";

export async function loadRuntime(path:string){
 const config=await loadRuntimeConfig(path);
 const keyed=new Map(config.map(profile=>[profile.id,profile]));
 const profiles:CapacityProfile[]=config.filter(profile=>Boolean(process.env[profile.credentialEnv??defaultCredential(profile.provider)])).map(({credentialEnv,...profile})=>profile);
 if(profiles.length===0)throw new Error("No configured provider profile has matching credentials. Set each profile credentialEnv or the default ANTHROPIC_API_KEY / OPENROUTER_API_KEY.");
 const selector=createCapacitySelector(profiles,(provider,model,capacityProfile)=>{
  const id=capacityProfile?.id;if(!id)throw new Error("Provider profile id is required");
  const profile=keyed.get(id);if(!profile)throw new Error("Unknown provider profile: "+id);
  const env=profile.credentialEnv??defaultCredential(provider),key=process.env[env];if(!key)throw new Error("Missing credential environment variable: "+env);
  if(provider==="anthropic")return new AnthropicProvider(new Anthropic({apiKey:key}),model);
  if(provider==="openrouter")return new OpenRouterProvider(key,model);
  throw new Error("Unsupported provider: "+provider);
 });
 return {profiles,selector};
}
