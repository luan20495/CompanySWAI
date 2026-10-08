import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {CapacityProfile} from "../src/capacity.js";
import {effectiveState} from "../src/capacity.js";
import {classifyProviderError,createCapacitySelector} from "../src/provider-selector.js";
import {createProviderRegistry,loadRuntime,loadRuntimeConfig} from "../src/runtime.js";
import {clearRegisteredSecrets,containsSecret,redact,registerSecret,sanitizedEnv} from "../src/secrets.js";
import {KeyedSemaphore} from "../src/semaphore.js";

const demand={capabilities:["coding"],estimatedInputTokens:100,estimatedOutputTokens:100};
const profile=(id:string,extra:Partial<CapacityProfile>={}):CapacityProfile=>({id,provider:"p",model:"m",state:"AVAILABLE",capabilities:["coding"],contextWindow:10000,maxConcurrency:1,...extra});
const build=(profiles:CapacityProfile[],now=()=>Date.now())=>createCapacitySelector(profiles,(provider,model)=>({name:provider,model,async generate(){return {text:"ok",inputTokens:1,outputTokens:1};}}),{now,cooldownMs:1000,unavailableCooldownMs:500});

test("routing spills to a free profile instead of queueing on a saturated cheaper one",()=>{
 const selector=build([profile("cheap",{inputCostPerMillion:1,outputCostPerMillion:1}),profile("pricey",{inputCostPerMillion:5,outputCostPerMillion:5})]);
 const first=selector({demand}),second=selector({demand}),third=selector({demand});
 assert.equal(first.profile.id,"cheap");assert.equal(second.profile.id,"pricey");
 assert.equal(third.profile.id,"cheap","everything saturated: falls back to cheapest and the semaphore queues");
 selector.release?.(first);
 assert.equal(selector({demand}).profile.id,"cheap");
});

test("release returns quota and credit reservations and is idempotent",()=>{
 const selector=build([profile("a",{tokenQuotaRemaining:1000,creditRemaining:1,inputCostPerMillion:1,outputCostPerMillion:1})]);
 const selection=selector({demand});
 assert.equal(selector.snapshot?.()[0].tokenQuotaRemaining,800);
 selector.release?.(selection);selector.release?.(selection);
 assert.equal(selector.snapshot?.()[0].tokenQuotaRemaining,1000);
 assert.ok(Math.abs((selector.snapshot?.()[0].creditRemaining??0)-1)<1e-9);
});

test("rate limited profile cools down and becomes eligible after resetAt",()=>{
 let clock=1_000_000;
 const selector=build([profile("a"),profile("b")],()=>clock);
 const picked=selector({preferredProvider:"p",demand});selector.reportFailure?.(picked,new Error("429 rate limit"));
 const state=selector.snapshot?.().find(p=>p.id===picked.profile.id)!;
 assert.equal(state.state,"RATE_LIMITED");assert.ok(state.resetAt);
 assert.notEqual(selector({demand}).profile.id,picked.profile.id);
 clock+=1001;
 assert.equal(effectiveState(state,clock),"AVAILABLE");
});

test("out-of-credit profiles never auto-recover and unavailable ones recover quickly",()=>{
 let clock=0;
 const selector=build([profile("a")],()=>clock);
 const credit=selector({demand});selector.reportFailure?.(credit,new Error("insufficient credit"));
 clock+=10_000_000;
 assert.throws(()=>selector({demand}),/No eligible/);
 const other=build([profile("b")],()=>clock),down=other({demand});other.reportFailure?.(down,new Error("503 service unavailable"));
 assert.throws(()=>other({demand}),/No eligible/);clock+=501;
 assert.equal(other({demand}).profile.id,"b");
});

test("provider error classification separates capacity, credit and availability failures",()=>{
 assert.equal(classifyProviderError(new Error("429 quota exceeded"))?.state,"RATE_LIMITED");
 assert.equal(classifyProviderError(new Error("billing problem"))?.state,"OUT_OF_CREDIT");
 assert.equal(classifyProviderError(new Error("fetch failed"))?.state,"UNAVAILABLE");
 assert.equal(classifyProviderError(new Error("max_tokens 5000 too large")),undefined);
 assert.equal(classifyProviderError(new Error("schema validation failed")),undefined);
});

test("two profiles of the same model keep independent concurrency limits",async()=>{
 const gate=new KeyedSemaphore();let active=0,max=0;
 const work=(key:string)=>gate.use(key,1,async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;});
 await Promise.all([work("profile-a"),work("profile-b"),work("profile-a"),work("profile-b")]);
 assert.equal(max,2);
});

test("runtime config supports multiple profiles, registry kinds and rejects bad ones",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"companyswai-runtime-")),path=join(dir,"p.json");
 const base={model:"m",capabilities:["coding"],contextWindow:1000};
 await writeFile(path,JSON.stringify({providers:[{...base,id:"a",provider:"anthropic"},{...base,id:"b",provider:"openrouter",credentialEnv:"CSWAI_TEST_B"},{...base,id:"c",provider:"openai-compatible",baseUrl:"https://llm.test/v1",credentialEnv:"CSWAI_TEST_C"}]}));
 assert.deepEqual((await loadRuntimeConfig(path)).map(p=>p.id),["a","b","c"]);
 assert.deepEqual(createProviderRegistry().ids().sort(),["anthropic","openai-compatible","openrouter"]);
 await writeFile(path,JSON.stringify({providers:[{...base,provider:"mystery",credentialEnv:"X_KEY"}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/Unknown provider kind/);
 await writeFile(path,JSON.stringify({providers:[{...base,id:"a",provider:"anthropic"},{...base,id:"a",provider:"anthropic"}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/Duplicate/);
 await writeFile(path,JSON.stringify({providers:[{...base,provider:"openai-compatible",credentialEnv:"X_KEY"}]}));
 await assert.rejects(()=>loadRuntimeConfig(path),/baseUrl/);
});

test("loadRuntime skips profiles without credentials and never echoes credential values",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"companyswai-runtime-")),path=join(dir,"p.json");
 const base={model:"m",capabilities:["coding"],contextWindow:1000};
 await writeFile(path,JSON.stringify({providers:[{...base,id:"live",provider:"openrouter",credentialEnv:"CSWAI_TEST_LIVE"},{...base,id:"dead",provider:"anthropic",credentialEnv:"CSWAI_TEST_DEAD"}]}));
 process.env.CSWAI_TEST_LIVE="sk-or-live-secret-value-123456";delete process.env.CSWAI_TEST_DEAD;
 try{
  const runtime=await loadRuntime(path);
  assert.deepEqual(runtime.profiles.map(p=>p.id),["live"]);assert.deepEqual(runtime.skipped,[{id:"dead",missing:"CSWAI_TEST_DEAD"}]);
  assert.ok(!JSON.stringify(runtime.profiles).includes("secret-value"));
  assert.equal(redact("failed with key sk-or-live-secret-value-123456 here"),"failed with key [REDACTED] here");
  delete process.env.CSWAI_TEST_LIVE;
  await assert.rejects(()=>loadRuntime(path),error=>error instanceof Error&&/CSWAI_TEST_LIVE/.test(error.message)&&!/secret-value/.test(error.message));
 }finally{delete process.env.CSWAI_TEST_LIVE;clearRegisteredSecrets();}
});

test("secret redaction covers token shapes, registered values and agent-visible environments",()=>{
 clearRegisteredSecrets();
 assert.equal(redact("key sk-ant-api03-abcdefghij1234567890 ok"),"key [REDACTED] ok");
 assert.ok(containsSecret("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"));
 assert.ok(!containsSecret("plain documentation text with api_key placeholder"));
 registerSecret("hunter2-custom-value");
 assert.equal(redact("pw hunter2-custom-value"),"pw [REDACTED]");
 const env=sanitizedEnv({PATH:"/bin",ANTHROPIC_API_KEY:"a",MY_TOKEN:"b",HOME:"/h",OTHER:"hunter2-custom-value"});
 assert.deepEqual(Object.keys(env).sort(),["HOME","PATH"]);
 clearRegisteredSecrets();
});
