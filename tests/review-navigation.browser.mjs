/* Search and reading navigation must remain presentation state, including offline copies. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {waitPreviewLayout} from './preview-layout.mjs';
import {ensureBackup, openAnnotationData} from './backup-ui.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const executablePath=process.env.BROWSER_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const browserName=executablePath?(/edge/i.test(executablePath)?'edge':'chrome'):'chromium';
const output=path.join(root,'output/playwright/refinement',browserName);
await mkdir(output,{recursive:true});
const temp=await mkdtemp(path.join(os.tmpdir(),'review-navigation-'));
const errors=[],checks=[];
let browser,context,page;
const cards=()=>page.locator('#annotation-list .annotation-card');
const card=id=>page.locator(`.annotation-card[data-annotation-id="${id}"]`);
async function settle(){await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function ready(){await page.waitForFunction(()=>!document.getElementById('open-button').disabled);await page.locator('#preview-frame[aria-busy=false]').waitFor();await waitPreviewLayout(page);}
async function data(){await openAnnotationData(page);const value=JSON.parse(await page.locator('#data-preview').textContent());await page.locator('#data-dialog [data-close]').click();await page.locator('#data-dialog').waitFor({state:'hidden'});return value;}
async function filter(value){await page.locator('#annotation-filter-trigger').click();const label={all:'全部记录',open:'待处理',resolved:'已完成'}[value];await page.getByRole('option',{name:label,exact:true}).click();}
async function search(value){await page.locator('#annotation-search').fill(value);}
async function expectIds(ids){assert.deepEqual(await cards().evaluateAll(nodes=>nodes.map(node=>node.dataset.annotationId)),ids);}
async function shot(name){await settle();await page.screenshot({animations:'disabled',path:path.join(output,name+'.png')});}

try{
 browser=await chromium.launch({headless:true,executablePath});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);
 await page.waitForFunction(()=>!document.getElementById('open-button').disabled);
 const source=path.join(temp,'导航验证.html');
 await writeFile(source,'<!doctype html><meta charset="utf-8"><style>body{max-width:700px;margin:60px auto;font:18px/1.8 sans-serif}section{padding:70px 20px}</style><h1>审阅导航验证</h1><section><p id="first">原文甲：季度营收增长。</p></section><section><p id="second">原文乙：现金流保持稳健。</p></section>');
 await page.locator('#file-input').setInputFiles(source);await ready();
 const longOpinion='目录 Alpha：精简营收说明。\n'+Array.from({length:12},(_,index)=>`第 ${index+1} 点：保留关键数字，说明统计口径与同比基准，并补充结论所依据的限制条件。`).join('\n');
 for(const [target,comment] of [['#first',longOpinion],['#second','目录 Beta：补充现金流来源。']]){
  await page.locator('[data-mode=element]').click();await waitPreviewLayout(page);await page.frameLocator('#preview-frame').locator(target).click();
  await page.locator('#comment-scope').filter({hasText:'所选元素'}).waitFor();await page.locator('#comment-input').fill(comment);await page.locator('#save-button').click();
 }
 await page.locator('[data-mode=browse]').click();await page.locator('#comment-input').fill('目录 Gamma：统一整体格式。');await page.locator('#save-button').click();
 await cards().last().locator('[data-action=status]').click();
 const baseline=await data(),[first,second,third]=baseline.annotations;

 await search('ＡＬＰＨＡ');await expectIds([first.id]);
 await search('现金流保持稳健');await expectIds([second.id]);
 await search('用户标记已完成');await expectIds([third.id]);
 await search('目录');await filter('open');await expectIds([first.id,second.id]);
 await filter('resolved');await expectIds([third.id]);
 await search('不存在的搜索词');await expectIds([]);assert.match(await page.locator('#annotation-search-status').textContent(),/没有找到/);assert(await page.locator('#annotation-next').isDisabled());
 await shot('search-empty');await page.locator('#annotation-search-clear').click();assert.equal(await page.locator('#annotation-search').inputValue(),'');
 await filter('open');await search('目录');await expectIds([first.id,second.id]);
 assert.deepEqual(await data(),baseline,'search and status filters do not change protocol data');
 checks.push('normalized opinion, original-text and history-summary search; combined status filters and empty results preserve protocol data');

 await card(first.id).locator('[data-action=locate]').click();await page.locator('#reading-context').waitFor();
 assert.match(await page.locator('#reading-position').textContent(),/1 \/ 2/);assert(await page.locator('#reading-previous').isDisabled());assert(!await page.locator('#reading-next').isDisabled());
 await settle();const compactHeight=await page.locator('#reading-comment').evaluate(node=>node.clientHeight);
 await page.locator('#reading-expand').click();await settle();assert.equal(await page.locator('#reading-expand').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'true');assert.equal(await page.locator('#reading-comment').textContent(),longOpinion);
 assert(await page.locator('#reading-comment').evaluate(node=>node.clientHeight)>compactHeight,'expanded opinion has a readable scrollable area');
 await page.locator('#reading-comment').focus();await page.keyboard.press('End');assert(await page.locator('#reading-comment').evaluate(node=>node.tabIndex===0&&node.scrollHeight>node.clientHeight),'full opinion is keyboard focusable and scrollable');await shot('reading-expanded');
 await page.locator('#reading-expand').click();await settle();assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'false');assert.equal(await page.locator('#reading-comment').evaluate(node=>node.tabIndex),-1);assert.equal(await page.locator('#reading-comment').evaluate(node=>node.clientHeight),compactHeight);
 await page.locator('#reading-expand').click();await page.locator('#reading-next').click();assert.equal(await page.locator('#reading-comment').textContent(),second.comment);assert.match(await page.locator('#reading-position').textContent(),/2 \/ 2/);assert(await page.locator('#reading-next').isDisabled());assert.equal(await page.locator('#reading-expand').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'false');
 await page.locator('#reading-previous').click();assert.equal(await page.locator('#reading-comment').textContent(),first.comment);
 await page.locator('#reading-return').click();assert(await card(first.id).locator('[data-action=select]').evaluate(node=>node===document.activeElement));
 assert.deepEqual(await data(),baseline,'locating and reading navigation do not change protocol data');await shot('reading-desktop');
 checks.push('filtered reading queue, long-opinion expand/collapse and keyboard scroll, collapse on next opinion, boundaries, return focus and immutable protocol data');

 await search('');await filter('all');await card(third.id).locator('[data-action=details]').click();
 const history=card(third.id).locator('.annotation-history:not(.target-history)'),summary=history.locator('summary');
 await summary.click();assert(await history.evaluate(node=>node.open));await summary.focus();
 // A location reply may rebuild the list while a summary has focus. Dispatching
 // the existing filter event reproduces that refresh without moving user focus.
 await page.locator('#annotation-filter').dispatchEvent('change');
 assert(await history.evaluate(node=>node.open));assert(await summary.evaluate(node=>node===document.activeElement));
 checks.push('history details expansion and summary focus survive list refresh');

 await page.locator('#comment-input').fill('折叠和窄屏切换都应保留的草稿。');
 await page.locator('#composer-toggle').click();await page.locator('#composer-content').waitFor({state:'hidden'});
 await page.locator('#composer-toggle').click();await page.locator('#composer-content').waitFor({state:'visible'});assert.equal(await page.locator('#comment-input').inputValue(),'折叠和窄屏切换都应保留的草稿。');
 await page.locator('#composer-toggle').click();await page.locator('#composer-content').waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:844});await page.locator('#mobile-write').click();await page.locator('#composer-content').waitFor({state:'visible'});assert.equal(await page.locator('#composer-toggle').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#comment-input').inputValue(),'折叠和窄屏切换都应保留的草稿。');
 await page.locator('#cancel-edit').click();await page.locator('#mobile-annotations').click();
 await filter('open');await search('目录');await page.locator('#annotation-search').press('Escape');assert.equal(await page.locator('#annotation-search').inputValue(),'');assert.equal(await page.locator('.workspace').getAttribute('data-mobile-panel'),'list');assert(await page.locator('#review-sidebar').isVisible());
 await search('目录');await card(first.id).locator('[data-action=locate]').click();await page.locator('#review-sidebar').waitFor({state:'hidden'});assert(await page.locator('#reading-context').isVisible());
 await page.locator('#reading-expand').click();await settle();assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'true');const expandedBox=await page.locator('#reading-context').boundingBox();assert(expandedBox.x>=0&&expandedBox.x+expandedBox.width<=390&&expandedBox.y>=0&&expandedBox.y+expandedBox.height<=844,'expanded mobile opinion remains inside the viewport');
 await page.locator('#reading-next').click();assert.equal(await page.locator('#reading-comment').textContent(),second.comment);assert(await page.locator('#reading-next').isDisabled());assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'false');
 await page.locator('#reading-return').click();await page.locator('#review-sidebar').waitFor({state:'visible'});assert.equal(await page.locator('.workspace').getAttribute('data-mobile-panel'),'list');assert(await card(second.id).locator('[data-action=select]').evaluate(node=>node===document.activeElement));await shot('reading-mobile');
 assert.deepEqual(await data(),baseline);
 checks.push('composer preserves draft through collapse and narrow transition; mobile search Escape, locate, filtered navigation and return focus');

 await page.setViewportSize({width:1440,height:1000});await settle();await filter('all');await search('Alpha');
 await card(first.id).locator('[data-action=locate]').click();await page.locator('#reading-expand').click();await settle();assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'true');await page.locator('#composer-toggle').click();await page.locator('#composer-content').waitFor({state:'hidden'});
 await ensureBackup(page);await page.locator('#export-format-trigger').click();await page.getByRole('option',{name:/完整工作区/}).click();
 const pending=page.waitForEvent('download');await page.locator('#download-button').click();const copy=path.join(temp,'导航验证.review.html');await(await pending).saveAs(copy);
 const html=await readFile(copy,'utf8');
 const cleaned=await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');return {search:doc.getElementById('annotation-search').value,reading:doc.getElementById('reading-context').hidden,comment:doc.getElementById('reading-comment').textContent,readingExpanded:doc.getElementById('reading-context').dataset.expanded,expandAria:doc.getElementById('reading-expand').getAttribute('aria-expanded'),commentTabIndex:doc.getElementById('reading-comment').tabIndex,annotationId:doc.getElementById('reading-context').dataset.annotationId,composer:doc.getElementById('composer-content').hidden,expanded:doc.getElementById('composer-toggle').getAttribute('aria-expanded')};},html);
 assert.deepEqual(cleaned,{search:'',reading:true,comment:'',readingExpanded:'false',expandAria:'false',commentTabIndex:-1,annotationId:undefined,composer:false,expanded:'true'});
 await page.goto(pathToFileURL(copy).href);await ready();assert.equal(await page.locator('#annotation-search').inputValue(),'');assert(await page.locator('#reading-context').isHidden());assert.equal(await page.locator('#reading-context').getAttribute('data-expanded'),'false');assert.equal(await page.locator('#reading-expand').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#reading-comment').evaluate(node=>node.tabIndex),-1);assert(await page.locator('#composer-content').isVisible());assert.equal(await page.locator('#composer-toggle').getAttribute('aria-expanded'),'true');assert.equal(await cards().count(),3);assert.deepEqual((await data()).annotations,baseline.annotations);await shot('reopened-copy');
 checks.push('actual complete HTML download strips search, reading navigation and collapsed composer; offline reopened copy preserves annotations');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'review-navigation.json'),JSON.stringify({status:'PASS',browser:await browser.version(),checks,errors},null,2));
 console.log('PASS '+checks.join('\nPASS '));
}catch(error){await writeFile(path.join(output,'review-navigation.json'),JSON.stringify({status:'FAIL',error:error.stack,checks,errors},null,2));if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'review-navigation-failure.png')}).catch(()=>{});throw error;}
finally{await context?.close();await browser?.close();await rm(temp,{recursive:true,force:true});console.log('PROCESS_CLEANUP_COMPLETE');}
