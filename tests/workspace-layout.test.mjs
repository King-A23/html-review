import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const sandbox=vm.createContext({});
vm.runInContext(await readFile(new URL('../src/workspace-layout.js',import.meta.url),'utf8'),sandbox);
const {normalize,bounds}=sandbox.HRWorkspaceLayout;
test('layout tolerates missing/invalid old preferences and keeps valid independent fields',()=>{
  for(const value of [undefined,null,{},[],{sidebarWidth:Infinity,sidebarCollapsed:'true'},{sidebarWidth:800,sidebarCollapsed:1}]) {
    const result=normalize(value);assert.equal(result.sidebarWidth,352);assert.equal(result.sidebarCollapsed,false);
  }
  const result=normalize({sidebarWidth:421.6,sidebarCollapsed:true});assert.equal(result.sidebarWidth,422);assert.equal(result.sidebarCollapsed,true);
  const restored=normalize({sidebarCollapsed:false},{sidebarWidth:488,sidebarCollapsed:true});assert.equal(restored.sidebarWidth,488);assert.equal(restored.sidebarCollapsed,false);
});
test('desktop width bounds preserve usable preview space and prevent sidebar dominating document',()=>{
  for(let width=761;width<2600;width+=13) {
    const {min,max}=bounds(width);assert(min>=280);assert(min<=max);assert(max<=560);assert(max<=width/2);assert(width-max-8>=360);
  }
  assert.equal(bounds(1400).max,560);assert.equal(bounds(770).max,385);
});
