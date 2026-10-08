import assert from "node:assert/strict";
import test from "node:test";
import {chmod,mkdir,mkdtemp,readFile,stat,symlink,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LocalRepoWorkspace,WorkspaceError,parseFilePatches} from "../src/repo-workspace.js";

const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
async function repo(){
 const root=await mkdtemp(join(tmpdir(),"companyswai-repo-"));
 git(root,"init","-q");git(root,"config","user.email","t@example.test");git(root,"config","user.name","T");git(root,"config","commit.gpgsign","false");
 await writeFile(join(root,"README.md"),"base\n");git(root,"add","-A");git(root,"commit","-qm","base");
 return root;
}
const exists=(path:string)=>stat(path).then(()=>true,()=>false);
const fail=(code:string)=>(error:unknown)=>error instanceof WorkspaceError&&error.code===code;

test("file patches are parsed from fenced file blocks",()=>{
 const patches=parseFilePatches("## Deliverables\n```file src/a.ts\nexport const a=1;\n```\ntext\n```file docs/b.md\nhello\n```");
 assert.deepEqual(patches.map(p=>p.path),["src/a.ts","docs/b.md"]);assert.match(patches[0].content,/a=1/);
});

test("patch paths are confined: absolute, traversal, .git and symlink escapes are rejected",async()=>{
 const root=await repo(),outside=await mkdtemp(join(tmpdir(),"companyswai-outside-")),ws=new LocalRepoWorkspace(root);
 await symlink(outside,join(root,"link"));
 for(const path of ["/etc/passwd","../escape.txt","a/../../escape.txt",".git/hooks/pre-commit","sub/.git/config",".companyswai/state.json","link/pwned.txt","C:\\win.txt",""])
  await assert.rejects(()=>ws.transaction([{path,content:"x"}]),fail("UNSAFE_PATH"),path);
 assert.equal(await exists(join(outside,"pwned.txt")),false);
});

test("transaction rolls back overwritten files, created files and created directories when a check fails",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root);await writeFile(join(root,"a.txt"),"old");git(root,"add","-A");git(root,"commit","-qm","a");
 await assert.rejects(()=>ws.transaction([{path:"a.txt",content:"new"},{path:"deep/er/new.txt",content:"created"}],[{cmd:"node",args:["-e","console.log('boom');process.exit(2)"]}]),(error:unknown)=>error instanceof WorkspaceError&&error.code==="CHECK_FAILED"&&error.evidence.some(e=>/exit 2/.test(e)));
 assert.equal(await readFile(join(root,"a.txt"),"utf8"),"old");
 assert.equal(await exists(join(root,"deep")),false);
 assert.equal(git(root,"status","--porcelain"),"");
});

test("a check that exceeds its timeout fails the transaction and rolls back",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root);
 await assert.rejects(()=>ws.transaction([{path:"t.txt",content:"x"}],[{cmd:"node",args:["-e","setTimeout(()=>{},10000)"],timeoutMs:200}]),fail("CHECK_FAILED"));
 assert.equal(await exists(join(root,"t.txt")),false);
});

test("deterministic checks run without provider credentials in their environment",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root);process.env.ANTHROPIC_API_KEY="sk-ant-should-not-leak-1234567890";
 try{
  const result=await ws.transaction([{path:"e.txt",content:"x"}],[{cmd:"node",args:["-e","process.exit(process.env.ANTHROPIC_API_KEY?3:0)"]}]);
  assert.equal(result.checks[0].exitCode,0);
 }finally{delete process.env.ANTHROPIC_API_KEY;}
});

test("successful transaction records changed files, check evidence and commits only the patched paths",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root);
 await writeFile(join(root,"unrelated.txt"),"keep me untracked");
 await writeFile(join(root,"staged.txt"),"s");git(root,"add","staged.txt");
 const result=await ws.transaction([{path:"src/a.ts",content:"export const a=1;\n"},{path:"README.md",content:"base\n"}],[{cmd:"node",args:["-e","process.exit(0)"]}],"CompanySWAI: task");
 assert.deepEqual(result.changedFiles,["src/a.ts"]);assert.match(result.evidence[0],/exit 0/);
 assert.equal(result.commitSha,git(root,"rev-parse","HEAD"));
 assert.equal(git(root,"show","--name-only","--format=","HEAD"),"src/a.ts");
 assert.match(git(root,"status","--porcelain"),/staged\.txt/);assert.match(git(root,"status","--porcelain"),/unrelated\.txt/);
});

test("without autoCommit nothing is committed and unchanged content is not reported as changed",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root),before=git(root,"rev-parse","HEAD");
 const result=await ws.transaction([{path:"README.md",content:"base\n"}],[]);
 assert.deepEqual(result.changedFiles,[]);assert.equal(result.commitSha,undefined);assert.equal(git(root,"rev-parse","HEAD"),before);
});

test("commit mode refuses to overwrite uncommitted local edits",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root);await writeFile(join(root,"README.md"),"my local edit\n");
 await assert.rejects(()=>ws.transaction([{path:"README.md",content:"agent\n"}],[],"msg"),fail("DIRTY_TARGET"));
 assert.equal(await readFile(join(root,"README.md"),"utf8"),"my local edit\n");
});

test("a failing commit hook rolls the files back",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root),hook=join(root,".git","hooks","pre-commit");
 await mkdir(join(root,".git","hooks"),{recursive:true});await writeFile(hook,"#!/bin/sh\nexit 1\n");await chmod(hook,0o755);
 await assert.rejects(()=>ws.transaction([{path:"n.txt",content:"x"}],[],"msg"),fail("COMMIT_FAILED"));
 assert.equal(await exists(join(root,"n.txt")),false);assert.equal(git(root,"status","--porcelain"),"");
});

test("patches containing credentials or duplicate targets are rejected before writing",async()=>{
 const root=await repo(),ws=new LocalRepoWorkspace(root);
 await assert.rejects(()=>ws.transaction([{path:"k.txt",content:"key=sk-ant-api03-abcdefghij1234567890"}]),fail("SECRET_IN_PATCH"));
 await assert.rejects(()=>ws.transaction([{path:"d.txt",content:"1"},{path:"./d.txt",content:"2"}]),fail("UNSAFE_PATH"));
 assert.equal(await exists(join(root,"k.txt")),false);
});

test("workspace validation rejects missing paths and non-git repos for commits",async()=>{
 await assert.rejects(()=>new LocalRepoWorkspace(join(tmpdir(),"definitely-missing-companyswai")).validate(),fail("INVALID_WORKSPACE"));
 const plain=await mkdtemp(join(tmpdir(),"companyswai-plain-"));
 await assert.rejects(()=>new LocalRepoWorkspace(plain).transaction([{path:"a",content:"x"}],[],"msg"),fail("INVALID_WORKSPACE"));
});
