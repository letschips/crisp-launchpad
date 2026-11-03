// E2E failure modes: IME submits early; refresh destroys focused drafts; capped total;
// hidden findings/projects; unconfirmed review writes; hidden tabs built eagerly; narrow overflow.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {chromium}=require(process.env.LAUNCHPAD_PLAYWRIGHT||'playwright-core');
const install=require('./browser-fixture.cjs');
const repo=path.resolve(__dirname,'..');const out=path.resolve(process.env.LAUNCHPAD_E2E_OUTPUT||'/tmp/crisp-launchpad-e2e');fs.mkdirSync(out,{recursive:true});
const results=[];let browser;
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.LAUNCHPAD_CHROME?{executablePath:process.env.LAUNCHPAD_CHROME}:{channel:'chrome'})});
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 page.setDefaultTimeout(5000);
 await page.route('http://launchpad.test/**',route=>route.fulfill({body:'<!doctype html><html><body class="theme-light"></body></html>',contentType:'text/html'}));
 await page.goto('http://launchpad.test/');
 await page.addStyleTag({content:':root{--background-primary:#fafafa;--background-secondary:#eee;--text-normal:#232324;--text-muted:#666;--text-faint:#888;--interactive-accent:#477ed0;--text-on-accent:white;--background-modifier-border:#ddd;--font-interface:Arial;--font-text:Arial;--font-monospace:monospace;--radius-l:12px;--text-warning:#a60;}body{margin:0}.theme-dark{--background-primary:#181818;--background-secondary:#252525;--text-normal:#eee;--text-muted:#bbb;--background-modifier-border:#444}.crisp-launchpad-view{height:850px;overflow:auto;contain:strict}.modal-container{position:fixed;inset:5%;overflow:auto;background:var(--background-primary);padding:24px;z-index:99}button,input{font:inherit}'});
 await page.addStyleTag({content:fs.readFileSync(path.join(repo,'styles.css'),'utf8')});
 if(process.env.LAUNCHPAD_TEMPO_SOURCE){const tempo=process.env.LAUNCHPAD_TEMPO_SOURCE;const esbuild=require(path.join(tempo,'node_modules/esbuild'));const bundle=await esbuild.build({entryPoints:[path.join(tempo,'src/core/selectors.ts')],bundle:true,write:false,format:'iife',globalName:'tempoSelectors',platform:'browser'});await page.addScriptTag({content:bundle.outputFiles[0].text});}
 await page.evaluate(install);
 await page.addScriptTag({content:fs.readFileSync(path.join(repo,'main.js'),'utf8')});
 await page.evaluate(async()=>{const p=new module.exports();p.app=fixture.app;p.manifest={dir:'.obsidian/plugins/crisp-launchpad'};await p.onload();fixture.plugin=p;fixture.main=p.views.get('crisp-launchpad-view')({});fixture.panel=p.views.get('crisp-launchpad-panel-view')({});await fixture.main.onOpen();await fixture.panel.onOpen();fixture.panel.contentEl.style.width='320px';});
 async function check(name,fn){if(process.env.LAUNCHPAD_E2E_FILTER&&!new RegExp(process.env.LAUNCHPAD_E2E_FILTER).test(name))return;try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:String(e)});}}
 await check('inactive tabs are built on first visit',async()=>{assert.equal(await page.locator('.crisp-launchpad-view .launchpad-heat-cell').count(),0);});
 await check('IME confirmation does not save; refresh preserves the same focused textarea',async()=>{
  const state=await page.evaluate(async()=>{const v=fixture.panel;await v.setPanelTab('capture');const input=v.contentEl.querySelector('textarea');input.value='中文草稿';input.dispatchEvent(new Event('input'));input.focus();input.setSelectionRange(2,2);const size=fixture.files.size;const e=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});input.dispatchEvent(e);await new Promise(r=>setTimeout(r,30));await v.render();return{same:input===v.contentEl.querySelector('textarea'),focused:document.activeElement===input,value:input.value,selection:input.selectionStart,saved:fixture.files.size-size};});
  assert.deepEqual(state,{same:true,focused:true,value:'中文草稿',selection:2,saved:0});
 });
 await check('explicit capture saves once and clears the retained editor',async()=>{await page.locator('.crisp-launchpad-panel-view button').filter({hasText:'记下'}).click();await page.waitForFunction(()=>fixture.files.size===35);assert.equal(await page.locator('.crisp-panel-capture-input').inputValue(),'');});
 await check('sidebar reports full total and exposes remaining inbox items',async()=>{await page.evaluate(()=>fixture.panel.setPanelTab('triage'));const text=await page.locator('.crisp-panel-header').innerText();assert.match(text,/28/);await page.getByRole('button',{name:/查看全部.*28/}).click();assert.equal(await page.locator('.crisp-panel-body .crisp-panel-task').count(),28);});
 await check('system findings can be opened from the complete queue',async()=>{await page.locator('.launchpad-tab').filter({hasText:'系统'}).click();assert.equal(await page.locator('.launchpad-finding-row').count(),27);await page.locator('.launchpad-finding-row').first().click();assert.match(await page.evaluate(()=>window.lastOpened),/item-0\.md$/);});
 await check('stage expansion stays in the selected stage and reveals all projects',async()=>{await page.locator('.launchpad-tab').filter({hasText:'创作'}).click();assert.equal(await page.getByText('内容 5',{exact:true}).count(),0);await page.getByRole('button',{name:/查看该阶段全部 6 篇/}).click();assert.equal(await page.getByText('内容 5',{exact:true}).count(),1);});
 await check('review preview excludes completed work and only confirmed selections create tasks',async()=>{
  await page.evaluate(()=>{const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const key=module.exports.dateKeyFromTimestamp(yesterday.getTime());fixture.tempo.getCompletedOn=async date=>({date,tasks:date===key?[{id:'done',title:'整理积压收件箱：item-0',completedAt:yesterday.getTime()}]:[]});});
  await page.locator('.launchpad-tab').filter({hasText:'复盘'}).click();await page.getByRole('button',{name:'预览下一批行动'}).click();await page.locator('.launchpad-review-preview-modal input[type=checkbox]').first().waitFor();assert.equal(await page.evaluate(()=>fixture.tasks.size),0);assert.equal(await page.locator('.launchpad-review-preview-modal').getByText('整理积压收件箱：item-0',{exact:true}).count(),0);
  const boxes=page.locator('.launchpad-review-preview-modal input[type=checkbox]');for(let i=1;i<await boxes.count();i++)await boxes.nth(i).uncheck();await page.getByRole('button',{name:'生成选中行动'}).click();await page.waitForFunction(()=>fixture.tasks.size===1);assert.ok(await page.evaluate(()=>[...fixture.tasks.values()][0].notePath));
 });
 await check('review stops when the current task overview fails',async()=>{
  const stopped=await page.evaluate(async()=>{const original=fixture.tempo.getActionOverview;fixture.tempo.getActionOverview=async()=>{throw Error('unreadable current tasks');};try{await fixture.plugin.readReviewTasks();return false;}catch(_){return true;}finally{fixture.tempo.getActionOverview=original;}});assert.equal(stopped,true);
 });
 await check('review distinguishes same-title sources and cools down only the completed source',async()=>{
  const result=await page.evaluate(async()=>{
   const P=module.exports;const first='Topics/a/raw/inbox/材料.md',second='Topics/b/raw/inbox/材料.md';
   const context={health:{findings:[{code:'STALE_INBOX',path:first},{code:'STALE_INBOX',path:second}]}};
   const initial=P.suggestReviewActions(context).filter(s=>s.project==='收件箱');
   const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const day=P.dateKeyFromTimestamp(yesterday.getTime());
   const sourceId=P.launchpadActionSourceId('收件箱:'+first,day);
   const task={id:'same-title-history',sourceId,title:'整理积压收件箱：材料',status:'done',completedAt:yesterday.getTime()};
   fixture.tasks.set(task.id,task);const original=fixture.tempo.getCompletedOn;
   fixture.tempo.getCompletedOn=async date=>({date,tasks:date===day?[{id:task.id,title:task.title,completedAt:task.completedAt}]:[]});
   try{const tasks=await fixture.plugin.readReviewTasks(new Date(),context);return{initial:initial.map(s=>s.link),remaining:P.suggestReviewActions({...context,tasks}).filter(s=>s.project==='收件箱').map(s=>s.link)};}finally{fixture.tasks.delete(task.id);fixture.tempo.getCompletedOn=original;}
  });assert.deepEqual(result,{initial:['Topics/a/raw/inbox/材料.md','Topics/b/raw/inbox/材料.md'],remaining:['Topics/b/raw/inbox/材料.md']});
 });
 if(process.env.LAUNCHPAD_TEMPO_SOURCE)await check('real Tempo preserves source identity for an old task completed yesterday',async()=>{
  const result=await page.evaluate(async()=>{
   const P=module.exports,first='Topics/a/raw/inbox/材料.md',second='Topics/b/raw/inbox/材料.md';
   const today=new Date(),yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const old=new Date();old.setDate(old.getDate()-40);
   const todayKey=P.dateKeyFromTimestamp(today.getTime());
   const task={id:'old-source',sourceId:P.launchpadActionSourceId('收件箱:'+first,P.dateKeyFromTimestamp(old.getTime())),title:'整理积压收件箱：材料',status:'done',completedAt:yesterday.getTime(),triage:'processed',availability:'anytime',priority:'none',createdAt:old.getTime(),updatedAt:yesterday.getTime(),order:'a'};
   const db={tasks:{[task.id]:task},projects:{}};const context={health:{findings:[{code:'STALE_INBOX',path:first},{code:'STALE_INBOX',path:second}]}};
   const oldOverview=fixture.tempo.getActionOverview,oldHistory=fixture.tempo.getCompletedOn;
   fixture.tasks.set(task.id,task);
   fixture.tempo.getActionOverview=async()=>({apiVersion:1,licensed:true,...tempoSelectors.getActionOverview(db,todayKey)});
   fixture.tempo.getCompletedOn=async date=>({date,tasks:tempoSelectors.getCompletedOn(db,date)});
   try{const tasks=await fixture.plugin.readReviewTasks(today,context);return P.suggestReviewActions({...context,tasks}).filter(s=>s.project==='收件箱').map(s=>s.link);}finally{fixture.tempo.getActionOverview=oldOverview;fixture.tempo.getCompletedOn=oldHistory;fixture.tasks.delete(task.id);}
  });assert.deepEqual(result,['Topics/b/raw/inbox/材料.md']);
 });
 await check('all tabs fit a narrow pane in both themes',async()=>{for(const dark of [false,true]){await page.evaluate(d=>{document.body.classList.toggle('theme-dark',d);document.body.classList.toggle('theme-light',!d);fixture.main.contentEl.style.width='390px';fixture.main.contentEl.style.boxSizing='border-box';},dark);for(const name of ['今天','创作','知识','复盘','系统']){await page.locator('.launchpad-tab').filter({hasText:name}).click();const overflow=await page.evaluate(()=>fixture.main.contentEl.scrollWidth-fixture.main.contentEl.clientWidth);assert.ok(overflow<=1,`${name} overflow ${overflow}`);}await page.screenshot({path:path.join(out,dark?'narrow-dark.png':'narrow-light.png')});}});
 await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({time:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
