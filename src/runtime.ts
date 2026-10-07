import Anthropic from "@anthropic-ai/sdk";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import type {CapacityProfile} from "./capacity.js";
import {ProviderRegistry} from "./provider.js";
import {createCapacitySelector} from "./provider-selector.js";
import {AnthropicProvider} from "./providers/anthropic.js";
import {OpenRouterProvider} from "./providers/openrouter.js";

const Profile=z.object({
 provider:z.enum(["anthropic","openrouter"]),
 model:z.string().min(1),
 state:z.enum(["AVAILABLE","QUOTA_LOW","RATE_LIMITED","OUT_OF_CREDIT","UNAVAILABLE"]).default("AVAILABLE"),
 capabilities:z.array(z.string()).min(1),
 contextWindow:z.number().int().positive(),
 inputCostPerMillion:z.number().nonnegative().optional(),
 outputCostPerMillion:z.number().nonnegative().optional(),
 creditRemaining:z.number().nonnegative().optional(),
 tokenQuotaRemaining:z.number().int().nonnegative().optional(),
 resetAt:z.string().optional(),
 maxConcurrency:z.number().int().positive().default(1)
});

const RuntimeConfig=z.object({providers:z.array(Profile).min(1)});

export async function loadRuntime(path:string){
 const config=RuntimeConfig.parse(JSON.parse(await readFile(path,"utf8")));
 const registry=new ProviderRegistry();
 const anthropicKey=process.env.ANTHROPIC_API_KEY;
 const openRouterKey=process.env.OPENROUTER_API_KEY;

 if(anthropicKey){
  const client=new Anthropic({apiKey:anthropicKey});
  registry.register("anthropic",model=>new AnthropicProvider(client,model));
 }
 if(openRouterKey){
  registry.register("openrouter",model=>new OpenRouterProvider(openRouterKey,model));
 }

 const profiles:CapacityProfile[]=config.providers.filter(profile=>registry.ids().includes(profile.provider));
 if(profiles.length===0){
  throw new Error("No configured provider has matching credentials. Set ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY.");
 }
 return {
  profiles,
  selector:createCapacitySelector(profiles,(provider,model)=>registry.create(provider,model))
 };
}
