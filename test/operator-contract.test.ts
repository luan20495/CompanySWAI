import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {OPERATOR_USAGE} from "../src/operator-commands.js";

/** Guards the documents that make Claude Code the operator: they must stay true to the commands that exist. */
const commands=[...OPERATOR_USAGE.matchAll(/^ {2}(\w+)\s/gm)].map(m=>m[1]);
const claudeMd=readFile("CLAUDE.md","utf8"),readme=readFile("README.md","utf8");

test("CLAUDE.md states the operator contract: what Claude is, is not, and the bypass bans",async()=>{
 const text=await claudeMd;
 assert.ok(commands.length>=14,"usage lists the commands");
 for(const phrase of ["human-facing operator","## You ARE","## You are NOT","scheduler, planner","fake backend-engineer","hidden bypass","never hand-edit `.companyswai/**`","goes through CompanySWAI","Never say DONE from prose","ACCEPTED_WITH_RISKS","No invented numbers","If CompanySWAI lacks an operation, say so","Never guess","Stop** is cooperative","completed work is skipped, never re-run","the **user** approves"])assert.ok(text.includes(phrase),"CLAUDE.md lost: "+phrase);
 const priority=text.indexOf("1 runtime state"),order=["2 artifacts","3 tests/gates","4 git evidence","5 canonical project Markdown","6 execution logs"].map(x=>text.indexOf(x));
 assert.ok(priority>=0&&order.every((x,i)=>x>(i?order[i-1]:priority)),"evidence priority order is runtime > artifacts > tests/gates > git > canonical MD > logs");
});

test("every operator command CLAUDE.md or the README names exists, and every command is documented",async()=>{
 const docs=(await claudeMd)+"\n"+(await readme),mentioned=new Set<string>();
 for(const m of docs.matchAll(/operator -- (\w+)/g))mentioned.add(m[1]);
 for(const m of (await claudeMd).matchAll(/^\| [^|]*\| `?(?:npm run -s operator -- )?([a-z]+)\b/gm))if(commands.includes(m[1]))mentioned.add(m[1]);
 for(const name of mentioned)assert.ok(commands.includes(name),"docs mention a command that does not exist: "+name);
 const readmeText=await readme;
 for(const name of commands.filter(c=>c!=="help"))assert.ok(new RegExp("`"+name+"[ `]").test(readmeText),"README does not document: "+name);
 const claudeText=await claudeMd;
 for(const name of ["status","agents","task","handoffs","blockers","logs","stop","resume","priority"])assert.ok(claudeText.includes("`"+name+" ")||claudeText.includes("`"+name+"`")||claudeText.includes(name+" <p>"),"CLAUDE.md does not route to: "+name);
});

test("the contract never tells Claude to fake state or run work itself",async()=>{
 const text=(await claudeMd).toLowerCase();
 for(const bad of ["edit .companyswai","mark the task done","write the code yourself","skip the reviewer","bypass the runtime"])assert.ok(!text.includes(bad),bad);
});
