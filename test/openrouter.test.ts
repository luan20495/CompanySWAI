import assert from "node:assert/strict";
import test from "node:test";
import {OpenRouterProvider} from "../src/providers/openrouter.js";

test("OpenRouter adapter sends chat request and returns usage",async()=>{
 const original=globalThis.fetch;
 let authorization="";
 globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{
  authorization=new Headers(init?.headers).get("authorization")??"";
  return new Response(JSON.stringify({
   choices:[{message:{content:"hello"}}],
   usage:{prompt_tokens:11,completion_tokens:7}
  }),{status:200,headers:{"content-type":"application/json"}});
 }) as typeof fetch;
 try{
  const provider=new OpenRouterProvider("secret","test-model","https://router.test/v1");
  const result=await provider.generate({system:"system",prompt:"prompt",maxTokens:100});
  assert.equal(authorization,"Bearer secret");
  assert.equal(result.text,"hello");
  assert.equal(result.inputTokens,11);
  assert.equal(result.outputTokens,7);
 }finally{
  globalThis.fetch=original;
 }
});

test("OpenRouter adapter surfaces provider errors without leaking key",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=(async()=>new Response(JSON.stringify({error:{message:"quota exceeded"}}),{status:429,headers:{"content-type":"application/json"}})) as typeof fetch;
 try{
  const provider=new OpenRouterProvider("super-secret","test-model","https://router.test/v1");
  await assert.rejects(
   provider.generate({system:"s",prompt:"p",maxTokens:10}),
   error=>error instanceof Error&&/quota exceeded/.test(error.message)&&!/super-secret/.test(error.message)
  );
 }finally{
  globalThis.fetch=original;
 }
});
