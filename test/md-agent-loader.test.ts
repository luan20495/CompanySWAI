import assert from "node:assert/strict";
import test from "node:test";
import {MarkdownAgentRegistry,activationMatches,parseMarkdownFrontmatter} from "../src/md-agent-loader.js";

test("loads exactly eleven MD-defined agents and only their declared skills",async()=>{
 const agents=await new MarkdownAgentRegistry().loadAll();
 assert.equal(agents.length,11);
 const backend=agents.find(a=>a.id==="backend-engineer")!;
 assert.deepEqual(backend.skills,["engineering-fundamentals","backend-engineering"]);
 assert.equal(backend.skillText.length,2);assert.ok(backend.rules.includes("Done only when"));
});
test("frontmatter parser and activation rules are deterministic",()=>{
 const parsed=parseMarkdownFrontmatter("---\nid: x\nskills: [\"a\",\"b\"]\n---\nBody");assert.equal(parsed.meta.id,"x");
 assert.equal(activationMatches("capability:web-ui|mobile",["mobile"],2),true);
 assert.equal(activationMatches("complexity>=3",[],2),false);
});
