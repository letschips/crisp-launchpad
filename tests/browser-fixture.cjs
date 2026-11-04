// Host-only boundary fixture: real browser DOM, real plugin views, in-memory vault/Tempo.
module.exports = function installHostFixture() {
  const opts = (el, o = {}) => { if(typeof o==='string')o={cls:o}; if(o.cls)el.className=o.cls;if(o.text!==undefined)el.textContent=o.text;for(const[k,v]of Object.entries(o.attr||{}))el.setAttribute(k,v);return el; };
  for(const [method,tag]of Object.entries({createDiv:'div',createSpan:'span'}))HTMLElement.prototype[method]=function(o){return this.appendChild(opts(document.createElement(tag),o));};
  HTMLElement.prototype.createEl=function(tag,o){return this.appendChild(opts(document.createElement(tag),o));};
  HTMLElement.prototype.empty=function(){this.replaceChildren();};
  HTMLElement.prototype.addClass=function(c){this.classList.add(...c.split(' '));};
  HTMLElement.prototype.removeClass=function(c){this.classList.remove(c);};
  HTMLElement.prototype.toggleClass=function(c,on){this.classList.toggle(c,on);};
  HTMLElement.prototype.setText=function(t){this.textContent=t;};
  window.createDiv=o=>opts(document.createElement('div'),o);
  class TFile {constructor(path,content='',fm={}){this.path=path;this.content=content;this.fm=fm;this.basename=path.split('/').pop().replace(/\.md$/,'');this.name=path.split('/').pop();this.parent={path:path.split('/').slice(0,-1).join('/')};this.stat={mtime:Date.now()};}}
  class TFolder {constructor(path){this.path=path;this.name=path.split('/').pop();this.children=[];}}
  const files=new Map(),raw=new Map(),tasks=new Map(),notices=[];
  const topic=new TFolder('Topics/demo');const topics=new TFolder('Topics');topics.children=[topic];
  for(let i=0;i<27;i++){const p=`Topics/demo/raw/inbox/item-${i}.md`;files.set(p,new TFile(p,'---\ntype: raw\n---\nfixture',{type:'raw',title:`材料 ${i}`}));}
  for(let i=0;i<6;i++){const p=`Topics/demo/content-projects/P-${i}/article.md`;files.set(p,new TFile(p,'',{content_role:'article',type:'output',title:`内容 ${i}`,stage:'drafting',status:'draft'}));}
  files.set('Topics/demo/knowledge/k.md',new TFile('Topics/demo/knowledge/k.md','',{type:'knowledge'}));
  const findings=Array.from({length:27},(_,i)=>({code:'STALE_INBOX',severity:'operational',path:`Topics/demo/raw/inbox/item-${i}.md`,message:`检查材料 ${i}`}));
  raw.set('.runtime/snapshot/health.json',JSON.stringify({generated_at:new Date().toISOString(),data:{status:'warning',counts:{blocking:0,operational:27,informational:0},findings}}));
  for(const kind of ['content','index','actions'])raw.set(`.runtime/snapshot/${kind}.json`,JSON.stringify({data:kind==='content'?[]:{}}));
  raw.set('Sidecar/bin/anks','fixture');
  const overview=()=>({apiVersion:1,licensed:true,tasks:[...tasks.values()].filter(t=>t.status!=='done'||new Date(t.completedAt).toDateString()===new Date().toDateString()).map(t=>({...t,bucket:t.status==='done'?'done':'inbox'}))});
  const tempo={actionsApiVersion:1,getActionOverview:async()=>overview(),getCompletedOn:async date=>({date,tasks:[]}),createTaskFromSource:async input=>{let task=[...tasks.values()].find(t=>t.sourceId===input.sourceId);if(!task){task={...input,id:`t-${tasks.size}`,status:'todo'};tasks.set(task.id,task);}return task;},getTasksBySource:async ids=>Object.fromEntries([...tasks.values()].filter(t=>ids.includes(t.sourceId)).map(t=>[t.sourceId,t])),revealTask:async()=>{}};
  class Plugin {async loadData(){return{openOnStartup:false,hasCompletedOnboarding:true};}async saveData(){}registerView(id,f){this.views.set(id,f);}registerEvent(){}addRibbonIcon(){}addCommand(){}addSettingTab(){}constructor(){this.views=new Map();}}
  class ItemView {constructor(leaf){this.leaf=leaf;this.app=app;this.contentEl=document.body.createDiv();}}
  class Modal {constructor(app){this.app=app;this.contentEl=document.createElement('div');}open(){this.host=document.body.createDiv({cls:'modal-container'});this.host.append(this.contentEl);this.onOpen?.();}close(){this.onClose?.();this.host?.remove();}}
  class Notice {constructor(text){notices.push(text);}}
  class Setting {constructor(parent){this.settingEl=parent.createDiv();}setName(t){this.settingEl.createSpan({text:t});return this;}setDesc(){return this;}addTextArea(fn){const inputEl=this.settingEl.createEl('textarea');const c={inputEl,setValue(v){inputEl.value=v;return this;},setPlaceholder(v){inputEl.placeholder=v;return this;},onChange(f){inputEl.addEventListener('input',()=>f(inputEl.value));return this;}};fn(c);return this;}addDropdown(fn){const select=this.settingEl.createEl('select');const c={addOption(v,t){select.createEl('option',{text:t,attr:{value:v}});return this;},setValue(v){select.value=v;return this;},onChange(f){select.addEventListener('change',()=>f(select.value));return this;}};fn(c);return this;}}
  const app={vault:{getMarkdownFiles:()=>[...files.values()].filter(f=>f.path.endsWith('.md')),getFiles:()=>[...files.values()],getAbstractFileByPath:p=>p==='Topics'?topics:p==='Topics/demo'?topic:files.get(p),read:async f=>f.content,create:async(p,c)=>{if(files.has(p))throw Error('exists');const f=new TFile(p,c,{type:'raw'});files.set(p,f);return f;},createFolder:async()=>{},process:async(f,fn)=>{f.content=fn(f.content);return f.content;},modify:async(f,s)=>{f.content=s;},on:()=>({}),adapter:{exists:async p=>raw.has(p)||files.has(p)||p==='Topics/demo/raw/inbox/scratch',read:async p=>raw.get(p)??files.get(p)?.content,write:async(p,s)=>raw.set(p,s)}},metadataCache:{getFileCache:f=>({frontmatter:f.fm}),on:()=>({}),getFirstLinkpathDest:()=>null},workspace:{on:()=>({}),onLayoutReady:()=>{},getActiveFile:()=>null,getLeavesOfType:()=>[],getLeaf:()=>({openFile:async f=>{window.lastOpened=f.path;}})},plugins:{enabledPlugins:new Set(['crisp-tempo','crisp-pulse']),plugins:{'crisp-tempo':tempo,'crisp-pulse':{pulseStateApiVersion:1,async getTodaySnapshot(){return{apiVersion:1,score:37.5,streak:4,active:true,memos:{today:3,pending:2}};}}}},commands:{findCommand:()=>null,executeCommandById:()=>true},internalPlugins:{getEnabledPluginById:()=>null}};
  const obsidian={Plugin,ItemView,Modal,Notice,Setting,TFile,TFolder,PluginSettingTab:class{},Platform:{isMobile:false},setIcon(){},addIcon(){}};
  window.require=id=>{if(id==='obsidian')return obsidian;throw Error('no host module');};window.module={exports:{}};
  window.fixture={app,files,raw,tasks,tempo,notices};
};
