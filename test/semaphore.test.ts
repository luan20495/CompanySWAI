import assert from "node:assert/strict";
import test from "node:test";
import {KeyedSemaphore} from "../src/semaphore.js";

test("keyed semaphore enforces provider concurrency",async()=>{
 const gate=new KeyedSemaphore();let active=0,max=0;
 await Promise.all(Array.from({length:5},(_,i)=>gate.use("p/m",2,async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return i;})));
 assert.equal(max,2);
});
