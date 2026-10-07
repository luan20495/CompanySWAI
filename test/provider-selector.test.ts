import assert from "node:assert/strict";
import test from "node:test";
import {createCapacitySelector} from "../src/provider-selector.js";

test("capacity selector routes capability task to cheapest eligible provider",()=>{
 const selector=createCapacitySelector([
  {provider:"premium",model:"large",state:"AVAILABLE",capabilities:["coding"],contextWindow:200000,inputCostPerMillion:10,outputCostPerMillion:30,maxConcurrency:2},
  {provider:"value",model:"small",state:"AVAILABLE",capabilities:["coding"],contextWindow:100000,inputCostPerMillion:1,outputCostPerMillion:3,maxConcurrency:4}
 ],(provider,model)=>({name:provider,model,async generate(){return {text:"ok",inputTokens:1,outputTokens:1};}}));
 const selected=selector({demand:{capabilities:["coding"],estimatedInputTokens:1000,estimatedOutputTokens:1000}});
 assert.equal(selected.provider.name,"value");
 assert.equal(selected.provider.model,"small");
 assert.equal(selected.profile.provider,"value");
});

test("capacity selector honors explicit provider preference but still enforces capacity",()=>{
 const selector=createCapacitySelector([
  {provider:"a",model:"m",state:"OUT_OF_CREDIT",capabilities:["coding"],contextWindow:10000,maxConcurrency:1},
  {provider:"b",model:"m",state:"AVAILABLE",capabilities:["coding"],contextWindow:10000,maxConcurrency:1}
 ],(provider,model)=>({name:provider,model,async generate(){return {text:"ok",inputTokens:1,outputTokens:1};}}));
 assert.throws(()=>selector({preferredProvider:"a",preferredModel:"m",demand:{capabilities:["coding"],estimatedInputTokens:10,estimatedOutputTokens:10}}),/No eligible provider capacity/);
});
