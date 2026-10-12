/* ============================================================ STATE & LOADING ============================================================ */
const state={model:null,selected:null,knownTables:new Set(),mermaidOK:false,
  measureIndex:new Map(),columnIndex:new Map(),lastModelMmd:'',lastLinMmd:'',
  trail:[],trailPos:-1,daxFmt:false,
  linGraph:null,linKeyToMid:new Map(),linMidToKey:{},modelMidToName:{},
  isolate:false,pz:{},linRoot:null,report:null,tableTrail:[],tablePos:-1};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const $=s=>document.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

/* ============================================================ VS CODE DEEP LINKS ============================================================ */
// Browsers only ever give us paths *relative* to the folder the user picked — never the absolute
// disk path. So we ask once for the absolute project root, remember it, and join the two.
function vsRoot(){try{return localStorage.getItem('pbiviz.vsroot')||'';}catch(e){return '';}}
function setVsRoot(v){try{if(v)localStorage.setItem('pbiviz.vsroot',v);else localStorage.removeItem('pbiviz.vsroot');}catch(e){}updateVsBtn();}
function updateVsBtn(){const b=$('#vsBtn');if(!b)return;const r=vsRoot();b.classList.toggle('vs-on',!!r);b.title=r?('VS Code links enabled · root: '+r+'\nClick to change or clear.'):'Set the absolute path of your PBIP project folder on disk to enable "Open in VS Code" deep links';}
function promptVsRoot(){
  const cur=vsRoot();
  const v=prompt('Absolute path of the folder you open in this tool\n(e.g. C:\\Repos\\Finance.pbip  or  /Users/me/repos/finance)\n\nLeave empty to disable VS Code links.',cur);
  if(v===null)return false;            // cancelled
  setVsRoot(v.trim());
  return !!v.trim();
}
function codeURL(file,line){
  let root=vsRoot();if(!root||!file)return null;
  root=root.replace(/\\/g,'/').replace(/\/+$/,'');
  let rel=String(file).replace(/\\/g,'/').replace(/^\/+/,'');
  // folder pickers sometimes include the picked folder's own name in the relative path —
  // if the first segment of the file path matches the last segment of the root, drop it.
  const last=(root.split('/').pop()||'').toLowerCase();
  const first=(rel.split('/')[0]||'').toLowerCase();
  if(last&&first===last)rel=rel.split('/').slice(1).join('/');
  let p=root+'/'+rel;
  if(!/^[a-zA-Z]:/.test(p)&&!p.startsWith('/'))p='/'+p;
  return 'vscode://file/'+encodeURI(p)+(line?(':'+line):'');
}
function openInVSCode(file,line){
  if(!vsRoot()&&!promptVsRoot())return;
  const url=codeURL(file,line);
  if(!url){$('#status').textContent='No file path recorded for this item';return;}
  const a=document.createElement('a');a.href=url;document.body.appendChild(a);a.click();a.remove();
  const s=$('#status');const o=s.textContent;s.textContent='Opening in VS Code… ⌁';setTimeout(()=>s.textContent=o,1500);
}
document.addEventListener('DOMContentLoaded',updateVsBtn);
setTimeout(updateVsBtn,0);
$('#vsBtn').onclick=promptVsRoot;

function loadDemo(){
  if(!window.PBIP_DEMO){$('#status').textContent='Demo model unavailable';return;}
  loadFiles(window.PBIP_DEMO.map(f=>({path:f.path,text:f.text})));
  $('#status').textContent='Demo · Northwind Coffee (synthetic)';
}
$('#demoBtn').onclick=loadDemo;
document.querySelectorAll('[data-welcome]').forEach(b=>b.onclick=()=>b.dataset.welcome==='demo'?loadDemo():$('#openBtn').click());
$('#openBtn').onclick=async()=>{
  if(window.showDirectoryPicker&&window.isSecureContext){
    try{const dir=await window.showDirectoryPicker();const files=[];await walkFSA(dir,dir.name,files);loadFiles(files);return;}
    catch(e){if(e&&e.name==='AbortError')return;}
  }
  $('#dirInput').click();
};
$('#dirInput').onchange=e=>{
  const list=[...e.target.files].filter(f=>{const n=f.name.toLowerCase();const p=(f.webkitRelativePath||'').toLowerCase();
    return n.endsWith('.tmdl')||(n.endsWith('.json')&&p.includes('.report/'));});
  Promise.all(list.map(f=>f.text().then(text=>({path:f.webkitRelativePath||f.name,text}))))
    .then(loadFiles).catch(e=>{$('#status').textContent='Unable to read folder: '+e.message;});
};
async function walkFSA(dir,prefix,out){
  for await(const[name,handle]of dir.entries()){
    const p=prefix?prefix+'/'+name:name;
    if(handle.kind==='file'){
      const n=name.toLowerCase();
      if(n.endsWith('.tmdl')||(n.endsWith('.json')&&p.toLowerCase().includes('.report/'))){
        const f=await handle.getFile();out.push({path:p,text:await f.text()});
      }
    }
    else if(handle.kind==='directory'){await walkFSA(handle,p,out);}
  }
}
function loadFiles(allFiles){
  const roots=new Set(allFiles.map(f=>f.path.match(/^(.*?\.SemanticModel)\//i)?.[1]).filter(Boolean));
  const reports=new Set(allFiles.map(f=>f.path.match(/^(.*?\.Report)\//i)?.[1]).filter(Boolean));
  if(roots.size>1||reports.size>1){$('#status').textContent='Choose one PBIP project at a time; multiple models or reports were found.';return;}
  const files=allFiles.filter(f=>f.path.toLowerCase().endsWith('.tmdl'));
  const reportFiles=allFiles.filter(f=>{const p=f.path.toLowerCase();return p.endsWith('.json')&&p.includes('.report/');});
  if(!files.length){$('#status').textContent='No .tmdl files found — point the picker at the .pbip project folder';return;}
  const model=parseModel(files);
  state.model=model;state.selected=null;state.linRoot=null;state.trail=[];state.trailPos=-1;state._audit=null;state.pz={};state.lastLinMmd='';
  $('#search').value='';state._roles=null;state._colUse=null;state.tableTrail=[];state.tablePos=-1;$('#detailToolbar').style.display='none';$('#detailBody').innerHTML='<div class=empty>Select an item to inspect its source.</div>';$('#lineageDiagram').innerHTML='<div class=empty>Select a measure or column to trace.</div>';
  state.knownTables=new Set(Object.keys(model.tables));
  // DAX is case-insensitive; the model keys may differ in case/whitespace from how the DAX
  // references them. Build a normalised lookup so table/column resolution matches DAX behaviour.
  state.tableByNorm=new Map();
  Object.values(model.tables).forEach(t=>state.tableByNorm.set(normName(t.name),t));
  state.measureIndex=new Map();model.measures.forEach(m=>{if(!state.measureIndex.has(m.name))state.measureIndex.set(m.name,[]);state.measureIndex.get(m.name).push(m);});
  state.columnIndex=new Map();model.columns.forEach(c=>{if(!state.columnIndex.has(c.name))state.columnIndex.set(c.name,[]);state.columnIndex.get(c.name).push(c);});
  // report layer (PBIR) — optional; present only if a .Report folder was included
  state.report=reportFiles.length?parseReport(reportFiles):null;
  const name=files[0].path.split('/').find(p=>/\.SemanticModel$/i.test(p))||model.modelInfo.name||'model';
  $('#status').textContent=name+'  ·  '+files.length+' model files'+(state.report?'  ·  '+state.report.pages.length+' report pages':'');
  $('#sT').textContent=Object.keys(model.tables).length;
  $('#sM').textContent=model.measures.length;
  $('#sC').textContent=model.columns.length;
  $('#sR').textContent=model.relationships.length;
  $('#stats').style.display='flex';
  // show/hide the Report tab depending on whether report files were found
  const rt=$('#reportTab');if(rt)rt.style.display=state.report&&state.report.pages.length?'':'none';
  buildTreeUI();populateFocus();populateReportPages();showView('model');
}

/* ============================================================ REPORT LAYER (PBIR) ============================================================ */
function parseReport(reportFiles){
  // group files by page folder:  .../pages/<pageId>/page.json  and  .../pages/<pageId>/visuals/<id>/visual.json
  const pageMap=new Map();
  function pageKey(path){const m=path.match(/pages\/([^/]+)\//i);return m?m[1]:null;}
  // first pass: page.json
  for(const f of reportFiles){
    if(!/\/page\.json$/i.test(f.path))continue;
    const key=pageKey(f.path);if(!key)continue;
    let pj;try{pj=JSON.parse(f.text);}catch(e){continue;}
    pageMap.set(key,{id:pj.name||key,name:pj.displayName||pj.name||key,width:pj.width||1280,height:pj.height||720,ordinal:pj.ordinal,file:f.path,visuals:[]});
  }
  // second pass: visual.json
  for(const f of reportFiles){
    if(!/\/visual\.json$/i.test(f.path))continue;
    const key=pageKey(f.path);if(!key)continue;
    let vj;try{vj=JSON.parse(f.text);}catch(e){continue;}
    let page=pageMap.get(key);
    if(!page){page={id:key,name:key,width:1280,height:720,visuals:[]};pageMap.set(key,page);}
    page.visuals.push(parseVisual(vj,f.path));
  }
  let order=[];for(const f of reportFiles)if(/\/pages\.json$/i.test(f.path)){try{order=JSON.parse(f.text).pageOrder||[];}catch(e){}}
  const pages=[...pageMap.values()];
  pages.forEach(p=>p.visuals.sort((a,b)=>a.z-b.z));
  pages.sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?999:ai)-(bi<0?999:bi)||(a.ordinal??999)-(b.ordinal??999)||a.name.localeCompare(b.name);});
  return {pages};
}
function parseVisual(vj,file){
  const v=vj.visual||{};const pos=vj.position||{};
  return {
    id:vj.name,type:v.visualType||(vj.visualGroup?'group':'visual'),
    x:pos.x||0,y:pos.y||0,z:pos.z||0,w:pos.width||0,h:pos.height||0,
    file:file||null,
    title:reportVisualTitle(v),fields:extractVisualFields(v)
  };
}
function reportVisualTitle(v){
  try{const t=v.objects.title[0].properties.text.expr.Literal.Value;if(t)return String(t).replace(/^'|'$/g,'');}catch(e){}
  return null;
}
function extractVisualFields(v){
  const out=[];const qs=v.query&&v.query.queryState;if(!qs)return out;
  for(const role of Object.keys(qs)){
    const projs=(qs[role]&&qs[role].projections)||[];
    for(const p of projs){
      const f=p.field||{};let kind=null,entity=null,prop=null;
      if(f.Measure){kind='measure';entity=srcRef(f.Measure);prop=f.Measure.Property;}
      else if(f.Column){kind='column';entity=srcRef(f.Column);prop=f.Column.Property;}
      else if(f.Aggregation&&f.Aggregation.Expression&&f.Aggregation.Expression.Column){const c=f.Aggregation.Expression.Column;kind='column';entity=srcRef(c);prop=c.Property;}
      else if(f.HierarchyLevel){kind='hierarchy';prop=p.nativeQueryRef||(p.queryRef||'');}
      else {kind='other';prop=p.nativeQueryRef||p.queryRef||'(dynamic)';}
      out.push({role,kind,table:entity,name:prop,queryRef:p.queryRef||null});
    }
  }
  return out;
}
function srcRef(o){try{return o.Expression.SourceRef.Entity;}catch(e){return null;}}

/* ---- report rendering ---- */
function populateReportPages(){
  const sel=$('#reportPageSel');if(!sel)return;
  if(!state.report||!state.report.pages.length){sel.innerHTML='';return;}
  sel.innerHTML=state.report.pages.map((p,i)=>`<option value="${i}">${esc(p.name)} · ${p.visuals.length} visuals</option>`).join('');
  sel.onchange=()=>renderReport(+sel.value);
  const xb=$('#reportExport');if(xb)xb.onclick=()=>openExportMenu(xb);
  const pvs=$('#reportPageVs');
  if(pvs)pvs.onclick=()=>{const i=sel.value?+sel.value:0;const p=state.report.pages[i];if(p&&p.file)openInVSCode(p.file,1);else $('#status').textContent='No page.json path recorded';};
  $('#reportLegend').innerHTML=`<span><i class="swatch" style="background:#7bbf6a"></i>measure</span><span><i class="swatch" style="background:#54c7d6"></i>column</span><span><i class="swatch" style="background:#5a6573"></i>no fields</span>`;
}
const RPT_TYPE_LABEL={card:'Card',multiRowCard:'Multi-row card',barChart:'Bar',clusteredBarChart:'Bar',columnChart:'Column',clusteredColumnChart:'Column',lineChart:'Line',lineClusteredColumnComboChart:'Combo',pieChart:'Pie',donutChart:'Donut',tableEx:'Table',pivotTable:'Matrix',matrix:'Matrix',slicer:'Slicer',map:'Map',gauge:'Gauge',kpi:'KPI',scatterChart:'Scatter',textbox:'Text',image:'Image',shape:'Shape',actionButton:'Button'};
function renderReport(idx){
  const host=$('#reportCanvas');if(!host)return;host.innerHTML='';
  if(!state.report||!state.report.pages.length){host.innerHTML='<div class="rpt-empty-page">No report pages found.</div>';return;}
  idx=idx||0;const page=state.report.pages[idx];if(!page)return;
  const hb=host.getBoundingClientRect();
  const availW=Math.max(400,(hb.width||900)-48),availH=Math.max(300,(hb.height||560)-48);
  const k=Math.min(availW/page.width,availH/page.height);
  const stage=document.createElement('div');stage.className='rpt-stage';
  stage.style.width=Math.round(page.width*k)+'px';stage.style.height=Math.round(page.height*k)+'px';
  stage.style.marginTop='24px';
  for(const v of page.visuals){
    const el=document.createElement('div');
    el.className='rpt-vis type-'+v.type+(v.fields.some(f=>f.kind==='measure')?' has-measure':'');
    el.style.left=Math.round(v.x*k)+'px';el.style.top=Math.round(v.y*k)+'px';
    el.style.width=Math.max(8,Math.round(v.w*k))+'px';el.style.height=Math.max(8,Math.round(v.h*k))+'px';
    const label=(RPT_TYPE_LABEL[v.type]||v.type)+(v.title?' · '+v.title:'');
    const head=document.createElement('div');head.className='rv-head';
    head.innerHTML=`<span class="rv-label">${esc(label)}</span>`;
    if(v.file){
      const vs=document.createElement('span');vs.className='rv-vs';vs.textContent='⌁';
      vs.title='Open this visual.json in VS Code';
      vs.onclick=ev=>{ev.stopPropagation();openInVSCode(v.file,1);};
      head.appendChild(vs);
    }
    el.appendChild(head);
    if(v.h*k>34){
      const body=document.createElement('div');body.className='rv-body';
      const shown=v.fields.slice(0,6);
      shown.forEach(f=>{
        const cls=f.kind==='measure'?'rv-m':(f.kind==='column'?'rv-c':'rv-x');
        const sym=f.kind==='measure'?'ƒ ':(f.kind==='column'?'▦ ':'• ');
        const fr=document.createElement('div');fr.className=cls;fr.innerHTML=sym+esc(f.name||'(dynamic)');
        // resolve the binding back to its model object so the pill can deep-link to TMDL
        let tgt=null;
        if(f.kind==='measure'){const r=resolveName(f.name);if(r&&r.type==='measure')tgt=r.node;}
        else if(f.kind==='column'){tgt=findColumn(f.table,f.name);}
        if(tgt&&tgt.file){
          fr.classList.add('rv-link');
          fr.title='Open '+(f.name)+' in VS Code ('+tgt.file.split('/').pop()+(tgt.line?':'+tgt.line:'')+')';
          fr.onclick=ev=>{ev.stopPropagation();openInVSCode(tgt.file,tgt.line);};
        }
        body.appendChild(fr);
      });
      if(v.fields.length>6){const x=document.createElement('div');x.className='rv-x';x.textContent=`+${v.fields.length-6} more…`;body.appendChild(x);}
      if(!v.fields.length){const x=document.createElement('div');x.className='rv-x';x.textContent='no field bindings';body.appendChild(x);}
      el.appendChild(body);
    }
    el.title=label+'\n'+(v.fields.map(f=>`[${f.role}] ${f.name}`).join('\n')||'no fields')+(v.file?'\n\nclick: trace measure · ⌁ or right-click: open in VS Code':'');
    el.onclick=()=>traceVisual(v);
    el.oncontextmenu=ev=>{if(v.file){ev.preventDefault();openInVSCode(v.file,1);}};
    stage.appendChild(el);
  }
  host.appendChild(stage);
}
/* ---- component inventory export ---- */
// Walk the visuals on a page (or the whole report) and collect every field binding, folding
// duplicates so a measure used in eight visuals shows once with a count. We also reconcile
// each binding against the model so the export carries the real source table + health, not
// just whatever the report author happened to type.
function collectComponents(scope){
  if(!state.report||!state.report.pages.length)return[];
  const pages=scope==='all'?state.report.pages:[state.report.pages[scope]||state.report.pages[0]];
  const map=new Map();   // key -> row
  for(const p of pages){
    for(const v of p.visuals){
      const vlabel=(RPT_TYPE_LABEL[v.type]||v.type)+(v.title?' · '+v.title:'');
      for(const f of v.fields){
        if(f.kind!=='measure'&&f.kind!=='column')continue;   // skip hierarchy/dynamic/other
        const key=f.kind+'|'+normName(f.table||'')+'|'+normName(f.name||'');
        let r=map.get(key);
        if(!r){
          // resolve against the model to recover the true home table + broken state
          let home=f.table||'',broken='';
          if(f.kind==='measure'){const res=resolveName(f.name);if(res&&res.type==='measure')home=res.node.table;}
          else {const col=findColumn(f.table,f.name);if(col)home=col.table;}
          r={kind:f.kind,name:f.name||'(dynamic)',table:home,roles:new Set(),pages:new Set(),visuals:0};
          map.set(key,r);
        }
        if(f.role)r.roles.add(f.role);
        r.pages.add(p.name);r.visuals++;
      }
    }
  }
  return [...map.values()].sort((a,b)=>
    (a.kind===b.kind?0:(a.kind==='measure'?-1:1))||
    a.table.localeCompare(b.table)||a.name.localeCompare(b.name));
}
function exportComponents(scope,fmt){
  const rows=collectComponents(scope);
  const pageName=scope==='all'?'all-pages':(state.report.pages[scope]?slug(state.report.pages[scope].name):'page');
  if(!rows.length){$('#status').textContent='No measure/column bindings found to export';return;}
  if(fmt==='md'){
    let md=`# Report components — ${scope==='all'?'all pages':state.report.pages[scope].name}\n\n`;
    const ms=rows.filter(r=>r.kind==='measure'),cs=rows.filter(r=>r.kind==='column');
    const tbl=arr=>{let o='| Name | Table | Used in | Roles |\n|---|---|---|---|\n';
      arr.forEach(r=>o+=`| ${r.name} | ${r.table||'—'} | ${r.visuals} visual${r.visuals===1?'':'s'} | ${[...r.roles].join(', ')} |\n`);return o+'\n';};
    if(ms.length)md+=`## Measures (${ms.length})\n\n`+tbl(ms);
    if(cs.length)md+=`## Columns (${cs.length})\n\n`+tbl(cs);
    downloadText(`components-${pageName}.md`,md);
  } else {
    const q=s=>'"'+String(s==null?'':s).replace(/"/g,'""')+'"';
    const lines=['kind,name,table,used_in_visuals,roles'+(scope==='all'?',pages':'')];
    rows.forEach(r=>lines.push([r.kind,q(r.name),q(r.table),r.visuals,q([...r.roles].join('; '))]
      .concat(scope==='all'?[q([...r.pages].join('; '))]:[]).join(',')));
    downloadText(`components-${pageName}.csv`,lines.join('\n'));
  }
  const ms=rows.filter(r=>r.kind==='measure').length,cs=rows.length-ms;
  $('#status').textContent=`Exported ${ms} measure${ms===1?'':'s'} · ${cs} column${cs===1?'':'s'}`;
}
function slug(s){return String(s||'page').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'page';}
// small popover offering page/all × csv/markdown
function openExportMenu(btn){
  document.querySelectorAll('.exp-menu').forEach(m=>m.remove());
  const idx=(()=>{const s=$('#reportPageSel');return s&&s.value?+s.value:0;})();
  const pname=state.report&&state.report.pages[idx]?state.report.pages[idx].name:'this page';
  const m=document.createElement('div');m.className='exp-menu';
  m.innerHTML=
    `<div class="exp-grp">This page <span class="exp-sub">${esc(pname)}</span></div>`+
    `<div class="exp-item" data-s="${idx}" data-f="csv">⤓ CSV</div>`+
    `<div class="exp-item" data-s="${idx}" data-f="md">⤓ Markdown table</div>`+
    `<div class="exp-grp">Whole report <span class="exp-sub">${state.report.pages.length} pages</span></div>`+
    `<div class="exp-item" data-s="all" data-f="csv">⤓ CSV</div>`+
    `<div class="exp-item" data-s="all" data-f="md">⤓ Markdown table</div>`;
  document.body.appendChild(m);
  const r=btn.getBoundingClientRect();
  m.style.top=(r.bottom+6)+'px';
  m.style.left=Math.max(8,Math.min(r.left,window.innerWidth-m.offsetWidth-8))+'px';
  m.querySelectorAll('.exp-item').forEach(it=>it.onclick=()=>{
    exportComponents(it.dataset.s==='all'?'all':+it.dataset.s,it.dataset.f);m.remove();
  });
  setTimeout(()=>{const close=e=>{if(!m.contains(e.target)&&e.target!==btn){m.remove();document.removeEventListener('mousedown',close);}};document.addEventListener('mousedown',close);},0);
}

function traceVisual(v){
  const measures=v.fields.filter(f=>f.kind==='measure');
  if(!measures.length){$('#status').textContent=`"${RPT_TYPE_LABEL[v.type]||v.type}" has no explicit measure to trace`;return;}
  const target=measures[0];let node=null;
  if(state.measureIndex.has(target.name)){
    const cands=state.measureIndex.get(target.name);
    node=cands.find(m=>normName(m.table)===normName(target.table))||cands[0];
  }
  if(!node){for(const arr of state.measureIndex.values()){const hit=arr.find(m=>normName(m.name)===normName(target.name));if(hit){node=hit;break;}}}
  if(!node){$('#status').textContent=`Measure "${target.name}" not found in the model`;return;}
  state.selected={type:'measure',ref:node};
  state.linRoot={type:'measure',ref:node};
  state.trail=[{type:'measure',ref:node}];state.trailPos=0;
  highlightSidebar(node.name);
  showView('lineage');
}
/* ============================================================ MEASURE AUDIT (usage + health) ============================================================ */
// A measure counts as "used" if it is bound to a report visual, or sits anywhere upstream
// of one that is (transitive). Health has two tiers, mirroring how Power BI actually fails:
//   root      — this expression itself has unresolved references / structural problems
//   inherited — every reference resolves, but something it depends on (measure OR
//               calculated column, transitively) is broken, so it errors in the report too
// Heuristic, static, client-side — it catches dangling references after renames/deletes,
// not type errors or invalid function usage.
let _auditFilter='all';
function exprMissingRefs(expr){
  const out=[];
  if(!expr||!String(expr).trim()){out.push('(empty expression)');return out;}
  const d=analyzeDax(expr,state.knownTables);
  const locals=new Set(d.locals||[]);
  new Set(d.names).forEach(n=>{
    if(locals.has(n))return;
    if(!resolveName(n))out.push('['+n+']');
  });
  dedup(d.columns).forEach(c=>{
    if(!findColumn(c.table,c.column)&&!findMeasure(c.table,c.column))out.push((getTable(c.table)?c.table:('⁇'+c.table))+'['+c.column+']');
  });
  // structural smells: count brackets on string/comment-masked text
  const e=String(expr).replace(/'(?:[^']|'')*'/g,' ').replace(/\[(?:[^\]]|\]\])*\]/g,' ').replace(/"(?:[^"\\]|\\.)*"/g,'""')
    .replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\n]*/g,' ').replace(/--[^\n]*/g,' ');
  let p=0,b=0;for(const ch of e){if(ch==='(')p++;else if(ch===')')p--;else if(ch==='[')b++;else if(ch===']')b--;}
  if(p!==0)out.push('(unbalanced parentheses)');
  if(b!==0)out.push('(unbalanced brackets)');
  return out;
}
function computeAudit(){
  const ms=state.model.measures;
  const calcCols=state.model.columns.filter(c=>c.isCalculated);
  const hasReport=!!(state.report&&state.report.pages.length);
  const mKey=m=>'m|'+normName(m.name);
  const cKey=c=>'c|'+normName(c.table)+'|'+normName(c.name);
  // ---- one dependency graph across measures AND calculated columns ----
  const nodes=new Map();   // key -> {kind,ref,missing,deps:[keys]}
  const resolveDeps=expr=>{
    const d=analyzeDax(expr,state.knownTables);
    const locals=new Set(d.locals||[]);
    const deps=[];
    new Set(d.names).forEach(n=>{
      if(locals.has(n))return;
      const r=resolveName(n);
      if(r&&r.type==='measure')deps.push(mKey(r.node));
      else if(r&&r.type==='column'&&r.node.isCalculated)deps.push(cKey(r.node));
    });
    dedup(d.columns).forEach(c=>{
      const qm=findMeasure(c.table,c.column);if(qm)deps.push(mKey(qm));
      const col=findColumn(c.table,c.column);
      if(col&&col.isCalculated)deps.push(cKey(col));
    });
    return deps;
  };
  for(const m of ms)nodes.set(mKey(m),{kind:'measure',ref:m,missing:exprMissingRefs(m.expression),deps:resolveDeps(m.expression)});
  for(const c of calcCols)nodes.set(cKey(c),{kind:'column',ref:c,missing:exprMissingRefs(c.expression),deps:resolveDeps(c.expression)});
  // ---- propagate brokenness downstream to a fixpoint ----
  const broken=new Map();  // key -> {root:bool, via:key|null}
  nodes.forEach((n,k)=>{if(n.missing.length)broken.set(k,{root:true,via:null});});
  let changed=true;
  while(changed){
    changed=false;
    nodes.forEach((n,k)=>{
      if(broken.has(k))return;
      const bad=n.deps.find(d=>broken.has(d));
      if(bad){broken.set(k,{root:false,via:bad});changed=true;}
    });
  }
  const nodeLabel=k=>{const n=nodes.get(k);if(!n)return k;
    return n.kind==='measure'?('ƒ '+n.ref.name):(n.ref.table+'['+n.ref.name+']');};
  // ---- usage (measures only) ----
  const visUse=new Map();
  if(hasReport)for(const p of state.report.pages)for(const v of p.visuals)for(const f of v.fields)
    if(f.kind==='measure'&&f.name)visUse.set(normName(f.name),(visUse.get(normName(f.name))||0)+1);
  const refBy=new Map();
  nodes.forEach(n=>n.deps.forEach(d=>refBy.set(d,(refBy.get(d)||0)+1)));
  const used=new Set([...visUse.keys()].map(k=>'m|'+k));
  const stack=[...used];
  while(stack.length){const k=stack.pop();const n=nodes.get(k);if(!n)continue;
    for(const d of n.deps)if(!used.has(d)){used.add(d);stack.push(d);}}
  // ---- measure rows ----
  const rows=ms.map(m=>{
    const k=mKey(m);
    const b=broken.get(k)||null;
    const direct=visUse.get(normName(m.name))||0;
    let status;
    if(!hasReport)status=(refBy.get(k)||0)>0?'feeds':'unknown';
    else if(direct>0)status='inrep';
    else if(used.has(k))status='feeds';
    else if((refBy.get(k)||0)>0)status='refonly';
    else status='unused';
    return {m,direct,refBy:refBy.get(k)||0,
      missing:b&&b.root?nodes.get(k).missing:[],
      inherit:b&&!b.root?nodeLabel(b.via):null,
      broken:!!b,status,unused:hasReport?!used.has(k):false};
  });
  // ---- broken calculated columns (root causes that live outside the measure list) ----
  const brokenCols=calcCols.map(c=>{
    const b=broken.get(cKey(c));if(!b)return null;
    return {c,missing:b.root?nodes.get(cKey(c)).missing:[],inherit:b.root?null:nodeLabel(b.via)};
  }).filter(Boolean);
  const nRoot=rows.filter(r=>r.missing.length).length+brokenCols.filter(r=>r.missing.length).length;
  const nInherit=rows.filter(r=>r.inherit).length+brokenCols.filter(r=>r.inherit).length;
  return {rows,brokenCols,hasReport,
    counts:{total:rows.length,unused:rows.filter(r=>r.unused).length,
      broken:rows.filter(r=>r.broken).length,root:nRoot,inherited:nInherit}};
}
const AUDIT_STATUS_LABEL={inrep:v=>`in report · ${v} visual${v===1?'':'s'}`,feeds:()=>'referenced upstream',
  refonly:()=>'referenced; no report usage observed',unused:()=>'not observed in bindings',unknown:()=>'usage unknown'};
function renderAudit(){
  const host=$('#auditBody');if(!host)return;
  if(!state.model){host.innerHTML='<div class="empty"><div class="big">Load a model to audit its measures</div></div>';$('#auditSummary').textContent='';return;}
  const a=computeAudit();state._audit=a;
  $('#auditSummary').textContent=`${a.counts.total} measures · ${a.hasReport?a.counts.unused+' not observed · ':''}${a.counts.broken+a.brokenCols.length} flagged (${a.counts.root} root · ${a.counts.inherited} inherited)`;
  let rows=a.rows;
  if(_auditFilter==='unused')rows=rows.filter(r=>a.hasReport?r.unused:r.refBy===0);
  if(_auditFilter==='broken')rows=rows.filter(r=>r.broken);
  // roots first, then inherited, then unused, then alphabetical
  rows=[...rows].sort((x,y)=>(y.missing.length?1:0)-(x.missing.length?1:0)||(y.inherit?1:0)-(x.inherit?1:0)||(y.unused?1:0)-(x.unused?1:0)||x.m.name.localeCompare(y.m.name));
  let html='<div class="audit-note">Static review of the loaded files, not a DAX engine validation. “Not observed” means no usage found in the scanned visual bindings. Filters, conditional formatting, field parameters, calculation groups and other reports may still use these measures. Do not use this list alone to delete objects.</div>';
  if(!a.hasReport)html+=`<div class="audit-note">No report layer loaded. Usage is unknown. The Not observed filter shows measures with no detected calculation dependents; include the .Report folder to also scan visual bindings.</div>`;
  // broken calculated columns: often the root cause of a cascade, so surface them first
  if(a.brokenCols.length&&_auditFilter!=='unused'){
    html+=`<div class="audit-sec">Broken calculated columns · ${a.brokenCols.length}</div>`;
    a.brokenCols.forEach((r,i)=>{
      html+=`<div class="audit-row" data-ci="${i}">`+
        `<span class="aw warn">⚠</span>`+
        `<span class="an" style="color:var(--violet)">∑ ${esc(r.c.table)}[${esc(r.c.name)}]</span>`+
        `<span class="as"><span class="astat unused">${r.missing.length?'root cause':'inherited'}</span></span></div>`;
      if(r.missing.length)html+=`<div class="audit-miss">unresolved: ${r.missing.slice(0,4).map(x=>`<code>${esc(x)}</code>`).join('')}${r.missing.length>4?` +${r.missing.length-4} more`:''}</div>`;
      else html+=`<div class="audit-miss">inherits error from <code>${esc(r.inherit)}</code></div>`;
    });
    html+=`<div class="audit-sec">Measures · ${rows.length}</div>`;
  }
  if(!rows.length&&!a.brokenCols.length)html+='<div class="empty" style="height:auto;padding:40px"><div class="big">Nothing matches this filter 🎉</div></div>';
  rows.forEach((r,i)=>{
    html+=`<div class="audit-row" data-ai="${i}">`+
      `<span class="aw ${r.broken?'warn':'ok'}" title="${r.broken?(r.missing.length?esc(r.missing.length+' unresolved reference(s)'):'inherits an upstream error'):'all references resolve'}">${r.broken?'⚠':'✓'}</span>`+
      `<span class="an">ƒ ${esc(r.m.name)}</span>`+
      `<span class="at">${esc(r.m.table)}</span>`+
      `<span class="as">`+
        (r.refBy?`<span class="at" title="referenced by ${r.refBy} other measure(s)/column(s)">↩ ${r.refBy}</span>`:'')+
        `<span class="astat ${r.status}">${AUDIT_STATUS_LABEL[r.status](r.direct)}</span>`+
      `</span></div>`;
    if(r.missing.length){
      html+=`<div class="audit-miss">unresolved: ${r.missing.slice(0,4).map(x=>`<code>${esc(x)}</code>`).join('')}${r.missing.length>4?` +${r.missing.length-4} more`:''}</div>`;
    } else if(r.inherit){
      html+=`<div class="audit-miss">inherits error from <code>${esc(r.inherit)}</code></div>`;
    }
  });
  host.innerHTML=html;
  state._auditRows=rows;state._auditCols=a.brokenCols;
  host.querySelectorAll('.audit-row[data-ai]').forEach(el=>el.onclick=()=>{
    const r=state._auditRows[+el.dataset.ai];if(r)select({type:'measure',ref:r.m});
  });
  host.querySelectorAll('.audit-row[data-ci]').forEach(el=>el.onclick=()=>{
    const r=state._auditCols[+el.dataset.ci];if(r)select({type:'column',ref:r.c});
  });
}
document.querySelectorAll('#auditFilter .seg-btn').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#auditFilter .seg-btn').forEach(x=>x.classList.toggle('active',x===b));
  _auditFilter=b.dataset.f;renderAudit();
});
$('#auditCsv').onclick=()=>{
  if(!state.model)return;const a=state._audit||computeAudit();if(!a)return;
  const esc2=s=>'"'+String(s==null?'':s).replace(/"/g,'""')+'"';
  const lines=['object,kind,table,status,visuals,referenced_by,health,detail'];
  a.rows.forEach(r=>lines.push([esc2(r.m.name),'measure',esc2(r.m.table),r.status,r.direct,r.refBy,
    r.missing.length?'broken-root':(r.inherit?'broken-inherited':'ok'),
    esc2(r.missing.length?r.missing.join('; '):(r.inherit?'inherits from '+r.inherit:''))].join(',')));
  a.brokenCols.forEach(r=>lines.push([esc2(r.c.name),'calc column',esc2(r.c.table),'',' ','',
    r.missing.length?'broken-root':'broken-inherited',
    esc2(r.missing.length?r.missing.join('; '):('inherits from '+r.inherit))].join(',')));
  downloadText('measure-audit.csv',lines.join('\n'));
};

function buildTreeUI(){
  const tree=$('#tree');tree.innerHTML='';const m=state.model;
  const q=($('#search').value||'').toLowerCase();
  const match=s=>!q||(s||'').toLowerCase().includes(q);

  // TABLES section (each expandable -> columns + measures)
  const tSec=section('Tables',Object.keys(m.tables).length);
  for(const t of Object.values(m.tables).sort((a,b)=>a.name.localeCompare(b.name))){
    const cols=t.columns.filter(c=>match(c.name));
    const meas=t.measures.filter(x=>match(x.name));
    if(!match(t.name)&&!cols.length&&!meas.length)continue;
    const tn=el('div','tnode');
    const head=el('div','node');
    head.innerHTML=`<span class="twist">▶</span><span class="ic ${t.isCalculated?'cal':'tbl'}">▦</span><span>${esc(t.name)}</span><span class="sub">${t.columns.length}c · ${t.measures.length}m</span>`;
    head.onclick=ev=>{if(ev.target.classList.contains('twist')||!ev.shiftKey){tn.classList.toggle('open');} select({type:'table',ref:t});};
    tn.appendChild(head);
    const kids=el('div','tchildren');
    meas.forEach(x=>kids.appendChild(leaf('mea','ƒ',x.name,'',()=>select({type:'measure',ref:x}))));
    cols.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>kids.appendChild(leaf(c.isCalculated?'cal':'col',c.isCalculated?'∑':'▪',c.name,c.dataType||'',()=>select({type:'column',ref:c}))));
    tn.appendChild(kids);
    if(q&&(cols.length||meas.length))tn.classList.add('open');
    tSec.body.appendChild(tn);
  }
  tree.appendChild(tSec.wrap);

  // MEASURES flat
  const allM=m.measures.filter(x=>match(x.name)).sort((a,b)=>a.name.localeCompare(b.name));
  const mSec=section('Measures',allM.length);
  allM.forEach(x=>mSec.body.appendChild(leaf('mea','ƒ',x.name,x.table,()=>select({type:'measure',ref:x}))));
  tree.appendChild(mSec.wrap);

  // RELATIONSHIPS
  const rSec=section('Relationships',m.relationships.length);
  m.relationships.filter(r=>match(r.fromColumn)||match(r.toColumn)).forEach(r=>{
    const lbl=`${r.fromColumn} → ${r.toColumn}`;
    mSecLeaf(rSec,'rel','⇿',lbl,r.isActive?'':'inactive',()=>openTable(r.fromTable));
  });
  tree.appendChild(rSec.wrap);

  // SOURCES (shared expressions / parameters)
  const eSec=section('Sources & Expressions',m.expressions.length);
  m.expressions.filter(x=>match(x.name)).forEach(x=>eSec.body.appendChild(leaf('src','◇',x.name,x.kind||'',()=>select({type:'expression',ref:x}))));
  tree.appendChild(eSec.wrap);

  if(m.fileErrors.length){const w=el('div','',`<div class="err" style="padding:10px">${m.fileErrors.length} file(s) failed to parse</div>`);tree.appendChild(w);}
}
function section(title,count){
  const wrap=el('div','sec');const h=el('div','sec-h',`<span class="chev">▾</span>${title}<span class="count">${count}</span>`);
  const body=el('div','sec-body');h.onclick=()=>wrap.classList.toggle('collapsed');wrap.appendChild(h);wrap.appendChild(body);return{wrap,body};
}
function leaf(icCls,ic,label,sub,onclick){
  const n=el('div','node');n.innerHTML=`<span class="ic ${icCls}">${ic}</span><span>${esc(label)}</span>`+(sub?`<span class="sub">${esc(sub)}</span>`:'');
  n.onclick=onclick;n._label=label;return n;
}
function mSecLeaf(sec,c,ic,label,sub,onclick){sec.body.appendChild(leaf(c,ic,label,sub,onclick));}

function select(sel){
  state.selected=sel;
  if(sel.type==='measure'||sel.type==='column'){
    // start a fresh drill trail rooted at this item
    state.trail=[{type:sel.type,ref:sel.ref}];
    state.trailPos=0;
    state.linRoot={type:sel.type,ref:sel.ref};   // lineage diagram roots here until a new sidebar pick
    renderLineage();renderDetail();highlightSidebar(sel.ref.name);
    showView('detail');
  } else {
    state.trail=[];state.trailPos=-1;
    document.querySelectorAll('.node.active').forEach(n=>n.classList.remove('active'));
    renderDetail();
    if(sel.type==='table')openTable(sel.ref.name);
  }
}
// Drill into a dependency: push onto the trail (browser-style history).
function focusItem(item){
  // truncate forward history, then push
  state.trail=state.trail.slice(0,state.trailPos+1);
  state.trail.push(item);state.trailPos=state.trail.length-1;
  syncFocus();
}
function setTrailPos(i){ if(i<0||i>=state.trail.length)return; state.trailPos=i; syncFocus(); }
function syncFocus(){
  const cur=state.trail[state.trailPos];
  state.selected={type:cur.type,ref:cur.ref};
  highlightSidebar(cur.ref.name);
  renderDetail();
  if($('#view-lineage').classList.contains('active'))renderLineage();
}
function highlightSidebar(name){
  document.querySelectorAll('.node.active').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll('#tree .node').forEach(n=>{if(n._label===name)n.classList.add('active');});
}
$('#search').oninput=()=>{if(state.model)buildTreeUI();};

function getTable(name){ // case-insensitive table lookup (DAX semantics)
  const m=state.model.tables;
  if(m[name])return m[name];
  return (state.tableByNorm&&state.tableByNorm.get(normName(name)))||null;
}
function resolveName(name){ // [X] -> measure (preferred) or column
  if(state.measureIndex.has(name))return{type:'measure',node:state.measureIndex.get(name)[0]};
  if(state.columnIndex.has(name))return{type:'column',node:state.columnIndex.get(name)[0]};
  // DAX is case-insensitive — fall back to a normalised scan
  const nn=normName(name);
  for(const [k,v] of state.measureIndex)if(normName(k)===nn)return{type:'measure',node:v[0]};
  for(const [k,v] of state.columnIndex)if(normName(k)===nn)return{type:'column',node:v[0]};
  return null;
}
function findMeasure(table,name){const t=getTable(table);return t?.measures.find(m=>normName(m.name)===normName(name))||null;}
function findColumn(table,col){
  const t=getTable(table);
  if(t){const c=t.columns.find(c=>normName(c.name)===normName(col));if(c)return c;}
  if(state.columnIndex.has(col))return state.columnIndex.get(col).find(c=>normName(c.table)===normName(table))||null;
  return null;
}
// Build a lineage graph for a measure/column.
function buildLineage(root){
  const nodes=new Map(),edges=[];
  const id=o=>o.type+'::'+(o.type==='column'?o.ref.table+'|'+o.ref.name:(o.ref.name||o.ref));
  function addNode(o){const k=id(o);if(!nodes.has(k))nodes.set(k,{key:k,...o});return k;}
  function addNodeKeyed(k,o){if(!nodes.has(k))nodes.set(k,{key:k,...o});return k;}
  function addEdge(a,b,lbl,style){edges.push({a,b,lbl,style});}
  const visited=new Set();

  function walkMeasure(meas){
    const mk=addNode({type:'measure',ref:meas});
    if(visited.has(mk))return mk;visited.add(mk);
    const dax=analyzeDax(meas.expression,state.knownTables);
    const localSet=new Set(dax.locals||[]);
    // dependent named refs
    for(const nm of new Set(dax.names)){
      if(nm===meas.name)continue;
      if(localSet.has(nm))continue;          // SUMMARIZE/ADDCOLUMNS extension column — not a model object
      const r=resolveName(nm);if(!r)continue;
      if(r.type==='measure'){const ck=walkMeasure(r.node);addEdge(ck,mk,'feeds','dep');}
      else {const ck=walkColumn(r.node);addEdge(ck,mk,'uses','use');}
    }
    // explicit table[col]
    for(const c of dedup(dax.columns)){
      const qm=findMeasure(c.table,c.column);if(qm){addEdge(walkMeasure(qm),mk,'feeds','dep');continue;}
      const col=findColumn(c.table,c.column);
      if(col){const ck=walkColumn(col);addEdge(ck,mk,'uses','use');}
      else{const tk=walkTable(c.table);if(tk)addEdge(tk,mk,`uses [${esc(c.column)}]`,'use');}
    }
    for(const tn of dax.tables){if(dax.columns.some(c=>normName(c.table)===normName(tn)))continue;const tk=walkTable(tn);if(tk)addEdge(tk,mk,'uses table','use');}
    return mk;
  }
  function walkColumn(col){
    const ck=addNode({type:'column',ref:col});
    if(visited.has(ck))return ck;visited.add(ck);
    if(col.isCalculated&&col.expression){
      const dax=analyzeDax(col.expression,state.knownTables);
      const localSet=new Set(dax.locals||[]);
      for(const c of dedup(dax.columns)){const qm=findMeasure(c.table,c.column);if(qm)addEdge(walkMeasure(qm),ck,'calc','use');const sc=findColumn(c.table,c.column);if(sc&&sc!==col){const k=walkColumn(sc);addEdge(k,ck,'calc','use');}}
      for(const nm of new Set(dax.names)){if(localSet.has(nm))continue;const r=resolveName(nm);if(r&&r.node!==col){const k=r.type==='measure'?walkMeasure(r.node):walkColumn(r.node);addEdge(k,ck,'calc','use');}}
    }
    const tk=walkTable(col.table);if(tk)addEdge(tk,ck,'column of','own');
    return ck;
  }
  function walkTable(tname){
    const t=getTable(tname);if(!t)return null;
    const tk=addNode({type:'table',ref:t});
    if(visited.has(tk))return tk;visited.add(tk);
    for(const p of t.partitions){
      // partition names are often identical across tables ("p", or the table name),
      // so the node key must include the owning table to stay unique.
      const pk=addNodeKeyed('partition::'+t.name+'|'+(p.name||''),{type:'partition',ref:p});
      addEdge(pk,tk,p.type||'load','load');
      walkSource(p.source,pk,p);
    }
    return tk;
  }
  function walkSource(src,pk,p){
    if(p&&p.type==='entity'){const ek=addNode({type:'source',ref:{name:(p.schemaName?p.schemaName+'.':'')+(p.entityName||'(DirectLake entity)'),kind:'DirectLake'}});addEdge(ek,pk,'entity','src');return;}
    if(p&&p.type==='calculated'){const ek=addNode({type:'source',ref:{name:'DAX calculated table',kind:'calculated'}});addEdge(ek,pk,'DAX','src');return;}
    const a=analyzeM(src);
    // referenced shared expressions / other queries.
    // NOTE: #"..." also matches internal let-step names (e.g. #"Filtered Rows"); only follow
    // refs that actually resolve to a known shared expression or table — ignore local steps.
    for(const ref of a.refs){
      const sx=state.model.expressions.find(e=>normName(e.name)===normName(ref));
      const ot=getTable(ref);
      if(sx){const ek=addNode({type:'expression',ref:sx});addEdge(ek,pk,'query ref','ref');if(!visited.has(ek)){visited.add(ek);walkSource(sx.expression,ek,null);}}
      else if(ot){const tk=walkTable(ot.name);if(tk)addEdge(tk,pk,'table ref','ref');}
      // else: internal Power Query step name — not a model object, skip it
    }
    // one node per distinct source (a partition may pull from several)
    const srcList=(a.sources&&a.sources.length)?a.sources:(a.kind?[{kind:a.kind,details:a.details}]:[]);
    const emitted=new Set();
    for(const s of srcList){
      const d=s.details||{};
      const sub=[d.server&&'srv: '+d.server,d.database&&'db: '+d.database,(d.schema&&d.item)&&d.schema+'.'+d.item,d.url&&d.url].filter(Boolean);
      // unique key per source identity so two servers don't merge
      const skey=s.kind+'|'+(d.server||'')+'|'+(d.database||'')+'|'+(d.schema||'')+'|'+(d.item||'')+'|'+(d.url||'');
      if(emitted.has(skey))continue;emitted.add(skey);
      const ek=addNodeKeyed('source::'+skey,{type:'source',ref:{name:s.kind,kind:s.kind,details:sub,nativeQuery:(s.kind==='Value.NativeQuery'?a.nativeQuery:null),dbName:d.database,server:d.server,schema:d.schema,item:d.item}});
      addEdge(ek,pk,'from','src');
    }
  }
  if(root.type==='measure')walkMeasure(root.ref);else walkColumn(root.ref);
  return{nodes:[...nodes.values()],edges,rootKey:(root.type+'::'+(root.type==='column'?root.ref.table+'|'+root.ref.name:root.ref.name))};
}
function dedup(cols){const s=new Set(),o=[];for(const c of cols){const k=c.table+'|'+c.column;if(!s.has(k)){s.add(k);o.push(c);}}return o;}

/* ============================================================ MARKDOWN LINEAGE DOC ============================================================ */
// Walk the lineage graph from a root measure/column and emit a flat, reference-style Markdown spec:
// root + DAX, then every upstream measure once (DAX + direct deps), then the columns/tables/sources
// the closure bottoms out in. Exhaustive to source, deduped, cycle-safe (buildLineage handles that).
function lineageMarkdown(root){
  const g=buildLineage(root);
  const byKey=new Map(g.nodes.map(n=>[n.key,n]));
  // edges go upstream(a) -> downstream(b); for a given node, its direct deps are the a's of edges where b===node
  const depsOf=new Map();
  for(const n of g.nodes)depsOf.set(n.key,[]);
  for(const e of g.edges){if(depsOf.has(e.b))depsOf.get(e.b).push({key:e.a,lbl:e.lbl});}
  const rootNode=byKey.get(g.rootKey);

  const measures=g.nodes.filter(n=>n.type==='measure');
  const columns=g.nodes.filter(n=>n.type==='column');
  const tables=g.nodes.filter(n=>n.type==='table');
  const sources=g.nodes.filter(n=>n.type==='source');
  const exprs=g.nodes.filter(n=>n.type==='expression');

  const nm=n=>n.type==='measure'?n.ref.name
    :n.type==='column'?`${n.ref.table}[${n.ref.name}]`
    :n.type==='table'?n.ref.name
    :n.type==='source'?(n.ref.name||'source')
    :n.type==='partition'?(n.ref.name||'partition')
    :n.type==='expression'?n.ref.name:n.key;
  const icon=t=>({measure:'ƒ',column:'▦',table:'▦',source:'⛃',partition:'⛁',expression:'◇'}[t]||'•');
  const depLabel=n=>`${icon(n.type)} ${nm(n)}`;

  const L=[];
  const rootName=nm(rootNode);
  L.push(`# ${icon(rootNode.type)} ${rootName}`);
  L.push('');
  // context: breadcrumb trail (how you got here), if any
  const trail=state.trail&&state.trailPos>=0?state.trail.slice(0,state.trailPos+1):[];
  if(trail.length>1){
    const path=trail.map(it=>it.type==='measure'?it.ref.name:`${it.ref.table}[${it.ref.name}]`).join(' → ');
    L.push(`*Path:* ${path}`);L.push('');
  }
  if(rootNode.type==='measure'){
    const m=rootNode.ref;
    L.push(`- **Type:** measure`);
    L.push(`- **Home table:** \`${m.table}\``);
    if(m.displayFolder)L.push(`- **Display folder:** ${m.displayFolder}`);
    if(m.formatString)L.push(`- **Format:** \`${m.formatString}\``);
    if(m.description)L.push(`- **Description:** ${m.description}`);
  } else if(rootNode.type==='column'){
    const c=rootNode.ref;
    L.push(`- **Type:** ${c.isCalculated?'calculated column':'column'}`);
    L.push(`- **Table:** \`${c.table}\``);
    L.push(`- **Data type:** ${c.dataType||'?'}`);
  }
  L.push('');
  // root DAX
  if(rootNode.ref.expression){
    L.push('### DAX');L.push('```dax');L.push(formatDax(rootNode.ref.expression).trim());L.push('```');L.push('');
  }
  // direct dependencies of the root
  const rootDeps=depsOf.get(rootNode.key)||[];
  if(rootDeps.length){
    L.push('### Direct dependencies');
    for(const d of rootDeps){const dn=byKey.get(d.key);if(dn)L.push(`- ${depLabel(dn)}`);}
    L.push('');
  }

  // upstream measures (excluding root), each once
  const upMeasures=measures.filter(n=>n.key!==rootNode.key);
  if(upMeasures.length){
    L.push('---');L.push('');L.push(`## Upstream measures (${upMeasures.length})`);L.push('');
    upMeasures.sort((a,b)=>a.ref.name.localeCompare(b.ref.name));
    for(const mn of upMeasures){
      const m=mn.ref;
      L.push(`### ƒ ${m.name}`);
      L.push(`*table* \`${m.table}\`${m.formatString?` · *fmt* \`${m.formatString}\``:''}`);
      if(m.description)L.push(`> ${m.description}`);
      L.push('');
      if(m.expression){L.push('```dax');L.push(formatDax(m.expression).trim());L.push('```');}
      const deps=(depsOf.get(mn.key)||[]).map(d=>byKey.get(d.key)).filter(Boolean);
      if(deps.length){L.push('');L.push('*Depends on:* '+deps.map(d=>`${icon(d.type)} ${nm(d)}`).join(', '));}
      L.push('');
    }
  }

  // calculated columns in the closure (have their own DAX)
  const calcCols=columns.filter(n=>n.ref.isCalculated&&n.ref.expression);
  if(calcCols.length){
    L.push('---');L.push('');L.push(`## Calculated columns (${calcCols.length})`);L.push('');
    for(const cn of calcCols){
      L.push(`### ∑ ${cn.ref.table}[${cn.ref.name}]`);L.push('');
      L.push('```dax');L.push(formatDax(cn.ref.expression).trim());L.push('```');L.push('');
    }
  }

  // tables, with the columns used and their source
  if(tables.length){
    L.push('---');L.push('');L.push(`## Tables & columns (${tables.length})`);L.push('');
    tables.sort((a,b)=>a.ref.name.localeCompare(b.ref.name));
    for(const tn of tables){
      const t=tn.ref;
      const usedCols=columns.filter(c=>normName(c.ref.table)===normName(t.name)).map(c=>c.ref.name);
      L.push(`### ▦ ${t.name}`);
      L.push(`*${t.isCalculated?'calculated table':'table'}*`);
      if(usedCols.length)L.push(`- **Columns used here:** ${usedCols.map(c=>`\`${c}\``).join(', ')}`);
      // partitions/sources for this table
      for(const p of (t.partitions||[])){
        const a=analyzeM(p.source);
        const srcs=(a.sources&&a.sources.length)?a.sources:(a.kind?[{kind:a.kind,details:a.details}]:[]);
        const parts=srcs.map(s=>{const d=s.details||{};return [s.kind,d.server&&`srv ${d.server}`,d.database&&`db ${d.database}`,(d.schema&&d.item)&&`${d.schema}.${d.item}`,d.url].filter(Boolean).join(' · ');});
        if(parts.length)L.push(`- **Source** (${esc(p.name||'partition')}): ${parts.join('  |  ')}`);
        else if(p.type==='entity')L.push(`- **Source** (${esc(p.name||'partition')}): DirectLake entity ${(p.schemaName?p.schemaName+'.':'')+(p.entityName||'')}`);
        else if(p.type==='calculated')L.push(`- **Source** (${esc(p.name||'partition')}): DAX calculated table`);
      }
      L.push('');
    }
  }

  // distinct data sources summary
  if(sources.length){
    const uniq=new Map();
    for(const s of sources){const key=(s.ref.details||[]).join(' · ')||s.ref.name;if(!uniq.has(key))uniq.set(key,s.ref);}
    L.push('---');L.push('');L.push(`## Data sources (${uniq.size})`);L.push('');
    for(const [key,ref] of uniq){
      L.push(`- **${ref.kind||'source'}**${key&&key!==ref.name?` — ${key}`:''}`);
      if(ref.nativeQuery){L.push('');L.push('  ```sql');ref.nativeQuery.split('\n').forEach(ln=>L.push('  '+ln));L.push('  ```');}
    }
    L.push('');
  }
  if(exprs.length){
    L.push(`## Shared expressions (${exprs.length})`);L.push('');
    exprs.forEach(e=>L.push(`- ◇ ${e.ref.name}`));L.push('');
  }

  L.push('---');
  L.push(`*Generated by Power BI Model Visualizer · ${measures.length} measure(s), ${columns.length} column(s), ${tables.length} table(s), ${sources.length} source ref(s) in the dependency closure.*`);
  return L.join('\n');
}

// Whole-model variant: every measure's closure as one reference document. Can be large.
function modelMarkdown(){
  const L=['# Model lineage — all measures','',`*${state.model.measures.length} measures across ${Object.keys(state.model.tables).length} tables.*`,'',];
  const sorted=state.model.measures.slice().sort((a,b)=>(a.table+a.name).localeCompare(b.table+b.name));
  for(const m of sorted){
    L.push('\n\n---\n');
    L.push(lineageMarkdown({type:'measure',ref:m}));
  }
  return L.join('\n');
}

/* ============================================================ MERMAID GENERATION ============================================================ */
let _idc=0;const _idmap=new Map();
function mid(key){if(!_idmap.has(key))_idmap.set(key,'n'+(_idc++));return _idmap.get(key);}
function mlabel(s){return '"'+String(s).replace(/"/g,'#quot;').replace(/\n/g,' ')+'"';}

function mmdIsLight(){return document.documentElement.getAttribute('data-theme')==='light';}
function mmdInactiveStroke(){return mmdIsLight()?'#8fb3bd':'#3a6470';}
function mmdClassDefs(){
  const P = mmdIsLight() ? {
    measure:['#e9f6e4','#3f8a34','#2c5c24'], column:['#eef0f3','#8a929c','#2a3742'],
    calc:['#f3ecfb','#7b4fb0','#4a2f70'],    table:['#fdf4dd','#b07d16','#6a4e0e'],
    partition:['#e4f4f7','#1f8a99','#14545f'], source:['#e4f4f7','#1f8a99','#14545f'],
    expr:['#e4f4f7','#1f8a99','#14545f'],     root:['#f6e6b8','#c8912a','#5a4410']
  } : {
    measure:['#1d2a18','#7bbf6a','#cfe9c4'], column:['#1a1d22','#6b7480','#cdd4dc'],
    calc:['#241c30','#b48ce0','#e2d2f3'],    table:['#2a2210','#d9a441','#f0dca6'],
    partition:['#16222a','#54c7d6','#bdeef4'], source:['#102028','#54c7d6','#bdeef4'],
    expr:['#102028','#54c7d6','#bdeef4'],     root:['#3a3112','#e9b659','#ffffff']
  };
  const cd=k=>`classDef ${k} fill:${P[k][0]},stroke:${P[k][1]},color:${P[k][2]};`;
  const out={};Object.keys(P).forEach(k=>out[k]=cd(k));
  out.root=`classDef root fill:${P.root[0]},stroke:${P.root[1]},color:${P.root[2]},stroke-width:2px;`;
  out.focus=`classDef focus fill:${P.root[0]},stroke:${P.root[1]},color:${P.root[2]},stroke-width:2px;`;
  return out;
}
function lineageMermaid(g){
  _idc=0;_idmap.clear();
  const L=['graph LR'];
  const cls=mmdClassDefs();
  Object.values(cls).forEach(c=>L.push(c));
  for(const n of g.nodes){
    const id=mid(n.key);let shape,clazz,label;
    if(n.type==='measure'){label='ƒ '+n.ref.name;shape=[`${id}(${mlabel(label)})`];clazz=n.key===g.rootKey?'root':'measure';}
    else if(n.type==='column'){label=n.ref.table+'['+n.ref.name+']';shape=[`${id}[${mlabel(label)}]`];clazz=n.ref.isCalculated?'calc':'column';}
    else if(n.type==='table'){label='▦ '+n.ref.name;shape=[`${id}[${mlabel(label)}]`];clazz='table';}
    else if(n.type==='partition'){label='⛁ '+(n.ref.name||'partition');shape=[`${id}[/${mlabel(label)}/]`];clazz='partition';}
    else if(n.type==='expression'){label='◇ '+n.ref.name;shape=[`${id}{{${mlabel(label)}}}`];clazz='expr';}
    else {const d=(n.ref.details&&n.ref.details.length)?' · '+n.ref.details.join(' · '):'';label=n.ref.name+d;shape=[`${id}[(${mlabel(label)})]`];clazz='source';}
    L.push(shape[0]);L.push(`class ${id} ${clazz}`);
  }
  for(const e of g.edges){
    const ar=e.style==='dep'?'==>':'-->';
    L.push(`${mid(e.a)} ${ar}|${mlabel(e.lbl)}| ${mid(e.b)}`);
  }
  return L.join('\n');
}

// Graph extraction used by the Mermaid export (and role inference). Inactive links are kept and drawn dashed.
function getModelGraph(focus,hops){
  const m=state.model;const tables=Object.values(m.tables);
  let visible=new Set(tables.map(t=>t.name));
  if(focus){
    visible=new Set([focus]);let frontier=new Set([focus]);
    const adj=new Map();
    for(const r of m.relationships){const a=r.fromTable,b=r.toTable;if(!a||!b)continue;(adj.get(a)||adj.set(a,[]).get(a)).push(b);(adj.get(b)||adj.set(b,[]).get(b)).push(a);}
    for(let h=0;h<hops;h++){const nf=new Set();for(const t of frontier)for(const nb of(adj.get(t)||[]))if(!visible.has(nb)){visible.add(nb);nf.add(nb);}frontier=nf;if(!nf.size)break;}
  }
  const nodes=tables.filter(t=>visible.has(t.name)).map(t=>({name:t.name,calc:t.isCalculated,focus:t.name===focus,cols:t.columns.length,meas:t.measures.length}));
  const links=[];
  for(const r of m.relationships){
    if(!visible.has(r.fromTable)||!visible.has(r.toTable)||r.fromTable===r.toTable)continue;
    links.push({source:r.fromTable,target:r.toTable,fromCardinality:r.fromCardinality,toCardinality:r.toCardinality,active:r.isActive,both:r.crossFilteringBehavior==='bothDirections',col:r.fromCol,fromCol:r.fromCol,toCol:r.toCol});
  }
  return{nodes,links};
}

function modelMermaid(focus,hops){
  _idc=0;_idmap.clear();
  const {nodes,links}=getModelGraph(focus,hops);
  const L=['graph LR'];
  {const cd=mmdClassDefs();L.push(cd.table);L.push(cd.calc);L.push(cd.focus);}
  for(const t of nodes){const id=mid(t.name);L.push(`${id}[${mlabel(t.name)}]`);L.push(`class ${id} ${t.focus?'focus':(t.calc?'calc':'table')}`);}
  let li=0;
  for(const r of links){
    const lbl=(r.fromCardinality==='one'?'1':'*')+' : '+(r.toCardinality==='one'?'1':'*')+(r.col?' · '+r.col:'');
    const arrow=r.active?'---':'-.-';
    L.push(`${mid(r.source)} ${arrow}|${mlabel(lbl)}| ${mid(r.target)}`);
    if(!r.active)L.push(`linkStyle ${li} stroke:${mmdInactiveStroke()},stroke-dasharray:4 3;`);
    li++;
  }
  return L.join('\n');
}

/* ============================================================ TABLE PROFILE (model explorer drill) ============================================================ */
// Cached, model-wide facts the profile page leans on. Cleared in loadFiles.
function modelRoles(){
  if(!state._roles){const g=getModelGraph(null,0);state._roles=inferRoles(g.nodes,g.links).role;}
  return state._roles;
}
// How many measures / calculated columns reference each column, keyed table|column (normalised).
function columnUsage(){
  if(state._colUse)return state._colUse;
  const use=new Map();
  const bump=(c,who)=>{const k=normName(c.table)+'|'+normName(c.name);if(!use.has(k))use.set(k,new Set());use.get(k).add(who);};
  const scan=(expr,who)=>{
    const d=analyzeDax(expr,state.knownTables);const locals=new Set(d.locals||[]);
    for(const n of new Set(d.names)){if(locals.has(n))continue;const r=resolveName(n);if(r&&r.type==='column')bump(r.node,who);}
    for(const c of dedup(d.columns)){if(findMeasure(c.table,c.column))continue;const col=findColumn(c.table,c.column);if(col)bump(col,who);}
  };
  state.model.measures.forEach(m=>scan(m.expression,'m|'+m.table+'|'+m.name));
  state.model.columns.filter(c=>c.isCalculated).forEach(c=>scan(c.expression,'c|'+c.table+'|'+c.name));
  state._colUse=use;return use;
}
function measureHealth(){
  if(!state._audit)state._audit=computeAudit();
  const map=new Map();state._audit.rows.forEach(r=>map.set(r.m,r));return map;
}
// Every relationship touching a table, oriented from that table's point of view.
//   lane 'up'   — the other table is on the one side: it filters this table (a lookup)
//   lane 'down' — this table is on the one side: it filters the other table
//   lane 'peer' — 1:1 or many-to-many
function tableRelations(name){
  const nn=normName(name),out=[];
  for(const r of state.model.relationships){
    const isFrom=normName(r.fromTable)===nn,isTo=normName(r.toTable)===nn;
    if(!isFrom&&!isTo||(isFrom&&isTo))continue;
    const me=isFrom?{t:r.fromTable,c:r.fromCol,card:r.fromCardinality}:{t:r.toTable,c:r.toCol,card:r.toCardinality};
    const other=isFrom?{t:r.toTable,c:r.toCol,card:r.toCardinality}:{t:r.fromTable,c:r.fromCol,card:r.fromCardinality};
    const lane=(other.card==='one'&&me.card==='many')?'up':(me.card==='one'&&other.card==='many')?'down':'peer';
    out.push({r,me,other,lane,active:r.isActive,both:r.crossFilteringBehavior==='bothDirections'});
  }
  return out;
}
// Measures that switch an inactive relationship on via USERELATIONSHIP.
function activatingMeasures(r){
  const want=[r.fromTable+'|'+r.fromCol,r.toTable+'|'+r.toCol].map(s=>normName(s));
  return state.model.measures.filter(m=>{
    if(!/USERELATIONSHIP\s*\(/i.test(m.expression||''))return false;
    const cols=analyzeDax(m.expression,state.knownTables).columns.map(c=>normName(c.table+'|'+c.column));
    return want.some(w=>cols.includes(w));
  });
}
function tableSourceSummary(t){
  const out=[];
  for(const p of t.partitions){
    if(p.type==='calculated'){out.push({kind:'DAX calculated table',obj:''});continue;}
    if(p.type==='entity'){out.push({kind:'DirectLake',obj:(p.schemaName?p.schemaName+'.':'')+(p.entityName||'')});continue;}
    const a=analyzeM(p.source);
    const srcs=(a.sources&&a.sources.length)?a.sources:(a.kind?[{kind:a.kind,details:a.details}]:[]);
    if(!srcs.length&&a.refs.length)out.push({kind:'Query reference',obj:a.refs.join(', ')});
    srcs.forEach(s=>{const d=s.details||{};out.push({kind:s.kind,obj:(d.schema&&d.item)?d.schema+'.'+d.item:(d.item||d.url||d.server||'')});});
  }
  return out;
}
function reportVisualsFor(name){
  if(!state.report)return null;
  const nn=normName(name);let n=0;
  for(const p of state.report.pages)for(const v of p.visuals){
    if(v.fields.some(f=>{
      if(f.kind==='measure'){const r=resolveName(f.name);return r&&r.type==='measure'&&normName(r.node.table)===nn;}
      return normName(f.table)===nn;
    }))n++;
  }
  return n;
}
const ROLE_GLYPH={fact:'▦',bridge:'⧉',dim:'◇',calc:'∑',disconnected:'○'};
const ROLE_LABEL={fact:'fact',bridge:'bridge',dim:'dimension',calc:'calculated',disconnected:'disconnected'};

function openTable(name,opts){
  opts=opts||{};
  const t=getTable(name);if(!t)return;
  if(!opts.fromTrail){
    state.tableTrail=(state.tableTrail||[]).slice(0,(state.tablePos??-1)+1);
    if(state.tableTrail[state.tableTrail.length-1]!==t.name)state.tableTrail.push(t.name);
    state.tablePos=state.tableTrail.length-1;
  }
  $('#focusSel').value=t.name;
  if(!$('#view-model').classList.contains('active'))showView('model');else renderModel();
}
function goOverview(){$('#focusSel').value='';state.tableTrail=[];state.tablePos=-1;renderModel();}

function renderTablePage(name){
  const t=getTable(name);const host=$('#modelDiagram');
  if(!t){goOverview();return;}
  state.lastModelMmd=modelMermaid(t.name,1);
  const roles=modelRoles(),role=roles[t.name]||'dim';
  const rels=tableRelations(t.name);
  const up=rels.filter(x=>x.lane==='up'),down=rels.filter(x=>x.lane==='down'),peer=rels.filter(x=>x.lane==='peer');
  const src=tableSourceSummary(t);
  const vis=reportVisualsFor(t.name);
  const use=columnUsage();const health=measureHealth();
  const keyCols=new Map();   // column -> [{other, lane}]
  rels.forEach(x=>{const k=normName(x.me.c);if(!keyCols.has(k))keyCols.set(k,[]);keyCols.get(k).push(x);});

  // ---- breadcrumb ----
  const trail=state.tableTrail||[],pos=state.tablePos??-1;
  let html=`<div class="tp"><nav class="tp-crumbs" aria-label="Table trail">`+
    `<button class="tp-crumb" data-tp-home>Overview</button>`+
    trail.slice(0,pos+1).map((n,i)=>`<span class="crumbsep">›</span><button class="tp-crumb${i===pos?' here':''}" data-tp-trail="${i}">${esc(n)}</button>`).join('')+
    `</nav>`;

  // ---- header ----
  html+=`<div class="tp-head"><div class="tp-titlerow">`+
    `<span class="tp-glyph role-${role}">${ROLE_GLYPH[role]||'◇'}</span>`+
    `<h2>${esc(t.name)}</h2><span class="fc-badge ${role}">${ROLE_LABEL[role]||role}</span>`+
    (t.isHidden?`<span class="fc-badge disconnected">hidden</span>`:'')+
    `<span class="tp-actions"><button class="btn" data-tp-detail title="Partition source and M code">≡ Source detail</button>${vsPill(t)}</span></div>`;
  if(t.description)html+=`<p class="tp-desc">${esc(t.description)}</p>`;
  html+=`<div class="tp-facts">`+
    `<span><b>${t.columns.length}</b> columns</span><span><b>${t.measures.length}</b> measures</span>`+
    `<span><b>${rels.length}</b> relationships</span>`+
    (vis!=null?`<span><b>${vis}</b> report visuals</span>`:'')+
    (src.length?`<span class="tp-src">${src.map(s=>`<span class="pill cyan">${esc(s.kind)}</span>${s.obj?`<code>${esc(s.obj)}</code>`:''}`).join(' ')}</span>`:'')+
    `</div></div>`;

  // ---- relationships ----
  const relRow=x=>{
    const o=getTable(x.other.t);const orole=roles[x.other.t]||'dim';
    const card=(x.me.card==='one'?'1':'*')+' : '+(x.other.card==='one'?'1':'*');
    const dir=x.both?`<span class="rb warn" title="Filters flow both ways. Can cause ambiguity and slower queries.">⇄ both directions</span>`
      :`<span class="rb">${x.lane==='up'?'filters '+esc(t.name):x.lane==='down'?'filtered by '+esc(t.name):'one-way'}</span>`;
    let extra='';
    if(!x.active){
      const am=activatingMeasures(x.r);
      extra=`<div class="rr-note">Inactive. ${am.length?'Switched on by '+am.map(m=>`<button class="link-btn" data-tp-measure="${esc(m.table)}|${esc(m.name)}">ƒ ${esc(m.name)}</button>`).join(', '):'No measure activates it with USERELATIONSHIP.'}</div>`;
    }
    // second level: what else the related table connects to
    const nb=o?tableRelations(o.name).filter(y=>normName(y.other.t)!==normName(t.name)):[];
    const uniq=[...new Map(nb.map(y=>[normName(y.other.t),y])).values()];
    const second=uniq.length?`<div class="rr-next"><span class="rr-next-l">${esc(x.other.t)} also connects to</span>`+
      uniq.map(y=>`<button class="chip" data-tp-open="${esc(y.other.t)}" title="${y.lane==='up'?esc(y.other.t)+' filters '+esc(x.other.t):esc(x.other.t)+' filters '+esc(y.other.t)}">${y.lane==='up'?'↑':y.lane==='down'?'↓':'↔'} ${esc(y.other.t)}</button>`).join('')+`</div>`:'';
    return `<div class="rr${x.active?'':' inactive'}">`+
      `<button class="rr-main" data-tp-open="${esc(x.other.t)}">`+
        `<span class="rr-name"><span class="tp-glyph role-${orole}">${ROLE_GLYPH[orole]||'◇'}</span>${esc(x.other.t)}</span>`+
        `<span class="rr-go" aria-hidden="true">›</span></button>`+
      `<div class="rr-key"><code>${esc(t.name)}[${esc(x.me.c)}]</code><span class="rr-card">${card}</span><code>${esc(x.other.t)}[${esc(x.other.c)}]</code></div>`+
      `<div class="rr-meta">${dir}${x.active?'':'<span class="rb off">inactive</span>'}</div>`+
      extra+second+`</div>`;
  };
  const lane=(title,sub,list,empty)=>`<section class="lane"><h3>${title} <span class="cnt">${list.length}</span></h3><p class="lane-sub">${sub}</p>`+
    (list.length?list.map(relRow).join(''):`<div class="lane-empty">${empty}</div>`)+`</section>`;
  html+=`<div class="tp-sec"><div class="tp-sec-h"><h3>Relationships</h3></div>`;
  if(!rels.length){
    html+=`<div class="lane-empty wide">${esc(t.name)} has no relationships. Measure tables, parameter tables and disconnected slicer tables are often deliberately standalone.</div>`;
  } else {
    const upLane=lane('Lookups',`Tables that filter ${esc(t.name)}. ${esc(t.name)} sits on the many side.`,up,`No lookups. Nothing filters ${esc(t.name)} through a relationship.`);
    const downLane=lane('Dependants',`Tables ${esc(t.name)} filters. ${esc(t.name)} sits on the one side.`,down,`No dependants. ${esc(t.name)} doesn't filter any other table.`);
    // When one side is empty (typical for a fact or a top-level dimension), give the full width to the side that has content.
    if(up.length&&down.length)html+=`<div class="lanes">${upLane}${downLane}</div>`;
    else if(up.length||down.length){
      html+=`<div class="lanes single">${up.length?upLane:downLane}</div>`;
      html+=`<p class="lane-none">${up.length?`No dependants: ${esc(t.name)} doesn't filter any other table.`:`No lookups: nothing filters ${esc(t.name)} through a relationship.`}</p>`;
    }
    if(peer.length)html+=`<div class="lanes single">`+lane('One-to-one and many-to-many','Filter direction depends on the relationship settings.',peer,'')+`</div>`;
  }
  html+=`</div>`;

  // ---- columns ----
  const cols=[...t.columns].sort((a,b)=>{
    const ka=keyCols.has(normName(a.name))?0:1,kb=keyCols.has(normName(b.name))?0:1;
    return ka-kb||a.name.localeCompare(b.name);});
  html+=`<div class="tp-sec"><div class="tp-sec-h"><h3>Columns <span class="cnt">${cols.length}</span></h3>`+
    (cols.length>8?`<input class="tp-filter" data-tp-filter="cols" placeholder="Filter columns…" aria-label="Filter columns">`:'')+`</div>`;
  if(cols.length){
    html+=`<div class="dt" data-tp-list="cols"><div class="dt-h"><span>Column</span><span>Type</span><span>Used by</span><span>Notes</span></div>`;
    cols.forEach((c,i)=>{
      const n=(use.get(normName(c.table)+'|'+normName(c.name))||new Set()).size;
      const keys=keyCols.get(normName(c.name))||[];
      const notes=[
        ...keys.map(x=>`<span class="rb key" title="Relationship key">key ${x.lane==='up'?'→':x.lane==='down'?'←':'↔'} ${esc(x.other.t)}</span>`),
        c.isCalculated?'<span class="rb calc">∑ calculated</span>':'',
        c.isHidden?'<span class="rb off">hidden</span>':''].join('');
      html+=`<button class="dt-r" data-tp-col="${i}" data-name="${esc(normName(c.name))}">`+
        `<span class="dt-n">${c.isCalculated?'∑':'▪'} ${esc(c.name)}</span>`+
        `<span class="dt-t">${esc(c.dataType||'—')}</span>`+
        `<span class="dt-u">${n?n+(n===1?' expression':' expressions'):'<span class="faint">—</span>'}</span>`+
        `<span class="dt-x">${notes}</span></button>`;
    });
    html+=`</div>`;
  } else html+=`<div class="lane-empty wide">No columns.</div>`;
  html+=`</div>`;

  // ---- measures, grouped by display folder ----
  if(t.measures.length){
    const groups=new Map();
    t.measures.forEach(m=>{const f=m.displayFolder||'';if(!groups.has(f))groups.set(f,[]);groups.get(f).push(m);});
    const folders=[...groups.keys()].sort((a,b)=>(a===''?1:0)-(b===''?1:0)||a.localeCompare(b));
    html+=`<div class="tp-sec"><div class="tp-sec-h"><h3>Measures <span class="cnt">${t.measures.length}</span></h3>`+
      (t.measures.length>8?`<input class="tp-filter" data-tp-filter="meas" placeholder="Filter measures…" aria-label="Filter measures">`:'')+`</div>`;
    html+=`<div class="dt meas" data-tp-list="meas"><div class="dt-h"><span>Measure</span><span>Format</span><span>Usage</span><span>Health</span></div>`;
    folders.forEach(f=>{
      if(folders.length>1||f)html+=`<div class="dt-g" data-folder>${esc(f||'No folder')}</div>`;
      groups.get(f).sort((a,b)=>a.name.localeCompare(b.name)).forEach(m=>{
        const h=health.get(m);
        const st=h?`<span class="astat ${h.status}">${AUDIT_STATUS_LABEL[h.status](h.direct)}</span>`:'';
        const hl=!h?'':h.missing.length?`<span class="rb warn" title="${esc(h.missing.join(', '))}">⚠ broken</span>`:h.inherit?`<span class="rb warn" title="inherits from ${esc(h.inherit)}">⚠ inherits</span>`:'<span class="faint">✓</span>';
        html+=`<button class="dt-r" data-tp-measure="${esc(m.table)}|${esc(m.name)}" data-name="${esc(normName(m.name))}">`+
          `<span class="dt-n m">ƒ ${esc(m.name)}</span><span class="dt-t">${esc(m.formatString||'—')}</span>`+
          `<span class="dt-u">${st}</span><span class="dt-x">${hl}</span></button>`;
      });
    });
    html+=`</div></div>`;
  }

  // ---- hierarchies ----
  if(t.hierarchies.length){
    html+=`<div class="tp-sec"><div class="tp-sec-h"><h3>Hierarchies <span class="cnt">${t.hierarchies.length}</span></h3></div>`+
      t.hierarchies.map(h=>`<div class="hier"><b>${esc(h.name)}</b> ${h.levels.map(l=>`<span class="pill">${esc(l)}</span>`).join('<span class="crumbsep">›</span>')}</div>`).join('')+`</div>`;
  }
  html+=`</div>`;
  host.innerHTML=html;
  host.scrollTop=0;const sc=host.closest('.scroll');if(sc)sc.scrollTop=0;

  // ---- wiring ----
  host.querySelector('[data-tp-home]').onclick=goOverview;
  host.querySelectorAll('[data-tp-trail]').forEach(b=>b.onclick=()=>{state.tablePos=+b.dataset.tpTrail;openTable(state.tableTrail[state.tablePos],{fromTrail:true});});
  host.querySelectorAll('[data-tp-open]').forEach(b=>b.onclick=()=>openTable(b.dataset.tpOpen));
  host.querySelector('[data-tp-detail]').onclick=()=>{state.selected={type:'table',ref:t};state.trail=[];state.trailPos=-1;renderDetail();showView('detail');};
  host.querySelectorAll('[data-tp-col]').forEach(b=>b.onclick=()=>select({type:'column',ref:cols[+b.dataset.tpCol]}));
  host.querySelectorAll('[data-tp-measure]').forEach(b=>b.onclick=()=>{const [tb,...rest]=b.dataset.tpMeasure.split('|');const m=findMeasure(tb,rest.join('|'));if(m)select({type:'measure',ref:m});});
  host.querySelectorAll('[data-tp-filter]').forEach(inp=>inp.oninput=()=>{
    const q=normName(inp.value);const list=host.querySelector(`[data-tp-list="${inp.dataset.tpFilter}"]`);
    list.querySelectorAll('.dt-r').forEach(r=>r.hidden=!!q&&!r.dataset.name.includes(q));
    // hide folder headings with no visible rows
    list.querySelectorAll('.dt-g').forEach(g=>{let n=g.nextElementSibling,any=false;while(n&&!n.classList.contains('dt-g')){if(!n.hidden)any=true;n=n.nextElementSibling;}g.hidden=!any;});
  });
}

/* ============================================================ RENDER ============================================================ */

/* Overview is an index of starting points; diagrams are always deliberately scoped. */
function renderOverview(){
  state.lastModelMmd='';
  const host=$('#modelDiagram');
  const tables=Object.values(state.model.tables),rels=state.model.relationships;
  const connected=new Set(rels.flatMap(r=>[r.fromTable,r.toTable]));
  const hidden=tables.filter(t=>t.isHidden).length;
  host.innerHTML=`<div class="explorer"><div class="explorer-note">MODEL OVERVIEW</div><h2>Where do you want to explore?</h2><p>Choose a table to open its profile: what filters it, what it filters, its keys, columns and measures. Use the sidebar to jump straight to a measure or column.</p><div class="overview-metrics"><span><b>${tables.length}</b> tables</span><span><b>${state.model.measures.length}</b> measures</span><span><b>${rels.length}</b> relationships</span><span><b>${state.report?.pages.length||0}</b> report pages</span></div><div class="explorer-note">${hidden} hidden tables · ${tables.filter(t=>!connected.has(t.name)).length} disconnected tables. Disconnected tables can be intentional, including measure tables and parameters.</div><div class="explorer-controls"><input id="overviewSearch" aria-label="Search table starting points" placeholder="Find a table or a measure it contains…"><select id="overviewKind" aria-label="Table category"><option value="visible">Visible tables</option><option value="measures">With measures</option><option value="connected">Connected tables</option><option value="disconnected">Disconnected tables</option><option value="hidden">Hidden tables</option><option value="all">All table names</option></select></div><p id="overviewCount" class="explorer-note"></p><div class="table-grid" id="tableGrid"></div><p class="explorer-note">Reads TMDL models and PBIR report definitions locally. This is metadata exploration, not a rendering of live report data. Table roles (fact, dimension, bridge) are inferred from relationship cardinality and naming.</p></div>`;
  function draw(){const q=normName($('#overviewSearch').value),kind=$('#overviewKind').value;
    const rows=tables.filter(t=>(kind!=='visible'||!t.isHidden)&&(kind!=='hidden'||t.isHidden)&&(kind!=='measures'||t.measures.length)&&(kind!=='connected'||connected.has(t.name))&&(kind!=='disconnected'||!connected.has(t.name))&&(!q||normName(t.name).includes(q)||t.measures.some(m=>normName(m.name).includes(q)))).sort((a,b)=>a.name.localeCompare(b.name));
    $('#overviewCount').textContent=rows.length+' matching tables · select one to open its profile';
    const grid=$('#tableGrid');grid.innerHTML='';for(const t of rows){const count=rels.filter(r=>r.fromTable===t.name||r.toTable===t.name).length;
      const card=el('button','table-card',`<small>${t.isCalculated?'CALCULATED':t.isHidden?'HIDDEN':!count?'DISCONNECTED':'TABLE'}</small><strong>${esc(t.name)}</strong><small>${t.columns.length} columns · ${t.measures.length} measures<br>${count} relationships</small>`);
      card.onclick=()=>openTable(t.name);grid.appendChild(card);}
    if(!rows.length)grid.textContent='No tables match. Try another category or search.';
  }
  $('#overviewSearch').oninput=draw;$('#overviewKind').onchange=draw;draw();
}
function downstreamImpact(sel){
  const key=(type,ref)=>type+'|'+normName(ref.table)+'|'+normName(ref.name);
  const target=key(sel.type,sel.ref), affected=new Set([target]);
  const objects=[...state.model.measures.map(ref=>({type:'measure',ref})),...state.model.columns.filter(c=>c.isCalculated).map(ref=>({type:'column',ref}))];
  const deps=o=>{const d=analyzeDax(o.ref.expression,state.knownTables),out=[];for(const n of d.names){if(d.locals.includes(n))continue;const r=resolveName(n);if(r)out.push(key(r.type,r.node));}for(const c of d.columns){const m=findMeasure(c.table,c.column),col=findColumn(c.table,c.column);if(m)out.push(key('measure',m));else if(col)out.push(key('column',col));}return out;};
  const edges=objects.map(o=>({o,deps:deps(o)}));let changed=true;while(changed){changed=false;for(const {o,deps:d} of edges){const k=key(o.type,o.ref);if(!affected.has(k)&&d.some(x=>affected.has(x))){affected.add(k);changed=true;}}}
  const dependents=objects.filter(o=>key(o.type,o.ref)!==target&&affected.has(key(o.type,o.ref)));
  const visuals=[];for(const page of state.report?.pages||[])for(const v of page.visuals)if(v.fields.some(f=>affected.has(key(f.kind,{table:f.table,name:f.name}))))visuals.push({page,v});
  return {dependents,visuals};
}
function renderImpact(sel,body){const impact=downstreamImpact(sel);const box=el('div','impact-list');box.innerHTML=`<h3>Change impact</h3><div class="mini">${impact.dependents.length} downstream measures / calculated columns · ${impact.visuals.length} bound visuals in the loaded report. Static references only; dynamic dependencies may be missing.</div>`;
  for(const o of impact.dependents){const b=el('button','btn',esc(o.ref.name));b.onclick=()=>focusItem(o);box.appendChild(b);}
  for(const {page,v} of impact.visuals){const b=el('button','btn',esc(page.name+' · '+(v.title||RPT_TYPE_LABEL[v.type]||v.type)));b.onclick=()=>{$('#reportPageSel').value=state.report.pages.indexOf(page);showView('report');};box.appendChild(b);}body.appendChild(box);
}

function renderModel(){
  if(!state.model)return;
  const focus=$('#focusSel').value||null;
  $('#copyModelMmd').style.display=focus?'':'none';
  if(!focus){renderOverview();return;}
  renderTablePage(focus);
}
function renderLineage(){
  const sel=state.linRoot||state.selected;if(!sel||(sel.type!=='measure'&&sel.type!=='column')){return;}
  const g=buildLineage(sel);const code=lineageMermaid(g);state.lastLinMmd=code;
  state.linGraph=g;
  state.linKeyToMid=new Map(_idmap);
  state.linMidToKey={};_idmap.forEach((v,k)=>state.linMidToKey[v]=k);
  const label=sel.type==='measure'?('ƒ '+sel.ref.name):(sel.ref.table+'['+sel.ref.name+']');
  $('#lineageTitle').textContent='Lineage · '+label+'  ('+g.nodes.length+' nodes)';
  // if the Detail pane is currently on a different item, offer to re-root here
  updateRerootBtn(sel);
  renderMermaid('lineageDiagram',code,'lineage');
}
function sameRef(a,b){return a&&b&&a.type===b.type&&a.ref===b.ref;}
function updateRerootBtn(linSel){
  const btn=$('#rerootBtn');if(!btn)return;
  const s=state.selected;
  if(s&&(s.type==='measure'||s.type==='column')&&!sameRef(s,linSel)){
    const lbl=s.type==='measure'?s.ref.name:(s.ref.table+'['+s.ref.name+']');
    btn.style.display='';btn.textContent='⟲ Re-root on '+lbl;
    btn.title='The diagram is rooted elsewhere — click to rebuild it around what you last opened in Detail';
  } else btn.style.display='none';
}
function renderMermaid(elId,code,kind){
  const host=$('#'+elId);
  if(!state.mermaidOK||!window.mermaid){
    host.innerHTML=`<div style="width:100%"><div class="mini" style="margin-bottom:8px">Mermaid not rendering inline — copy the source below into <code>mermaid.live</code>:</div><pre class="code">${esc(code)}</pre></div>`;
    return;
  }
  const gid='mmd-'+kind+'-'+Date.now();
  try{
    window.mermaid.render(gid,code).then(({svg})=>{host.innerHTML=svg;postRender(elId,kind);}).catch(err=>{
      host.innerHTML=`<div style="width:100%"><div class="err">Diagram render error: ${esc(String(err.message||err))}</div><pre class="code">${esc(code)}</pre></div>`;
    });
  }catch(err){host.innerHTML=`<pre class="code">${esc(code)}</pre>`;}
}

/* ============================================================ INTERACTION: pan/zoom, highlight, lineage drill ============================================================ */
function postRender(hostId,kind){
  const host=$('#'+hostId);const svg=host.querySelector('svg');if(!svg)return;
  // capture natural size from viewBox
  let baseW=0,baseH=0;const vb=(svg.getAttribute('viewBox')||'').split(/\s+/).map(Number);
  if(vb.length===4){baseW=vb[2];baseH=vb[3];}
  if(!baseW){const r=svg.getBoundingClientRect();baseW=r.width||800;baseH=r.height||500;}
  svg.removeAttribute('width');svg.removeAttribute('height');
  svg.style.maxWidth='none';svg.style.display='block';svg.style.margin='0 auto';
  state.pz[hostId]={scale:1,baseW,baseH,svg};
  applyZoom(hostId);
  attachPan(hostId);
  if(kind==='lineage'){
    state.isolate=false;$('#isolateToggle')&&$('#isolateToggle').classList.remove('on');
    svg.querySelectorAll('.node').forEach(n=>{
      const id=n.getAttribute('data-id');if(!id)return;
      let t=null;
      n.addEventListener('click',e=>{e.stopPropagation();clearTimeout(t);t=setTimeout(()=>highlightUpstream(id),210);});
      n.addEventListener('dblclick',e=>{e.stopPropagation();clearTimeout(t);drillFromLineage(id);});
    });
  }
}
function applyZoom(hostId){
  const z=state.pz[hostId];if(!z||!z.svg)return;
  z.svg.style.width=(z.baseW*z.scale)+'px';
  z.svg.style.height=(z.baseH*z.scale)+'px';
  const lvl=document.querySelector(`.zoom[data-host="${hostId}"] .zlvl`);
  if(lvl)lvl.textContent=Math.round(z.scale*100)+'%';
}
function zoomBy(hostId,f){const z=state.pz[hostId];if(!z)return;z.scale=clamp(z.scale*f,0.1,6);applyZoom(hostId);}
function zoomReset(hostId){const z=state.pz[hostId];if(!z)return;z.scale=1;applyZoom(hostId);const s=$('#'+hostId).closest('.scroll');if(s){s.scrollLeft=0;s.scrollTop=0;}}
function zoomFit(hostId){const z=state.pz[hostId];if(!z)return;const s=$('#'+hostId).closest('.scroll');if(!s)return;z.scale=clamp((s.clientWidth-40)/z.baseW,0.1,6);applyZoom(hostId);s.scrollLeft=0;s.scrollTop=0;}
function attachPan(hostId){
  const host=$('#'+hostId);const scroll=host.closest('.scroll');if(!scroll||scroll._pan)return;scroll._pan=true;
  let dragging=false,sx,sy,sl,st_;
  scroll.addEventListener('mousedown',e=>{
    if(e.target.closest('.node'))return;
    dragging=true;sx=e.clientX;sy=e.clientY;sl=scroll.scrollLeft;st_=scroll.scrollTop;scroll.style.cursor='grabbing';e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{if(!dragging)return;scroll.scrollLeft=sl-(e.clientX-sx);scroll.scrollTop=st_-(e.clientY-sy);});
  window.addEventListener('mouseup',()=>{if(dragging){dragging=false;scroll.style.cursor='';}});
  scroll.addEventListener('wheel',e=>{
    const hid=host.id;if(!state.pz[hid])return;
    e.preventDefault();
    const z=state.pz[hid];const prev=z.scale;
    const ns=clamp(prev*(e.deltaY<0?1.12:1/1.12),0.1,6);
    if(ns===prev)return;
    // keep the point under the cursor fixed while scaling
    const r=scroll.getBoundingClientRect();
    const cx=e.clientX-r.left+scroll.scrollLeft;
    const cy=e.clientY-r.top+scroll.scrollTop;
    z.scale=ns;applyZoom(hid);
    const ratio=ns/prev;
    scroll.scrollLeft=cx*ratio-(e.clientX-r.left);
    scroll.scrollTop=cy*ratio-(e.clientY-r.top);
  },{passive:false});
  scroll.addEventListener('click',e=>{if(host.id==='lineageDiagram'&&!e.target.closest('.node'))clearHighlight('lineageDiagram');});
}
/* upstream highlight */
function highlightUpstream(clickedMid){
  const g=state.linGraph;if(!g)return;
  const key=state.linMidToKey[clickedMid];if(!key)return;
  const incoming=new Map();
  g.edges.forEach(e=>{if(!incoming.has(e.b))incoming.set(e.b,[]);incoming.get(e.b).push(e.a);});
  const nodes=new Set([key]),stack=[key];
  while(stack.length){const n=stack.pop();(incoming.get(n)||[]).forEach(a=>{if(!nodes.has(a)){nodes.add(a);stack.push(a);}});}
  const edgePairs=new Set();
  g.edges.forEach(e=>{if(nodes.has(e.a)&&nodes.has(e.b))edgePairs.add(e.a+'>'+e.b);});
  applyHighlight('lineageDiagram',nodes,edgePairs,key);
}
function applyHighlight(hostId,keySet,edgePairs,rootKey){
  const svg=$('#'+hostId).querySelector('svg');if(!svg)return;
  const iso=state.isolate;
  const mids=new Set([...keySet].map(k=>state.linKeyToMid.get(k)));
  const rootMid=state.linKeyToMid.get(rootKey);
  svg.querySelectorAll('.node').forEach(n=>{
    const id=n.getAttribute('data-id');
    n.classList.remove('lin-hl','lin-hl-root','lin-dim','lin-hidden');
    if(mids.has(id)){n.classList.add('lin-hl');if(id===rootMid)n.classList.add('lin-hl-root');}
    else n.classList.add(iso?'lin-hidden':'lin-dim');
  });
  svg.querySelectorAll('path.flowchart-link,.flowchart-link').forEach(p=>{
    const cls=p.getAttribute('class')||'';
    const ms=cls.match(/LS-([A-Za-z0-9_]+)/),me=cls.match(/LE-([A-Za-z0-9_]+)/);
    p.classList.remove('lin-edge-hl','lin-dim','lin-hidden');
    let on=false;
    if(ms&&me){const a=state.linMidToKey[ms[1]],b=state.linMidToKey[me[1]];if(a&&b&&edgePairs.has(a+'>'+b))on=true;}
    if(on)p.classList.add('lin-edge-hl');else p.classList.add(iso?'lin-hidden':'lin-dim');
  });
  svg.classList.remove('lab-dim','lab-hide');
  svg.classList.add(iso?'lab-hide':'lab-dim');
}
function clearHighlight(hostId){
  const svg=$('#'+hostId).querySelector('svg');if(!svg)return;
  svg.querySelectorAll('.lin-hl,.lin-hl-root,.lin-dim,.lin-hidden').forEach(e=>e.classList.remove('lin-hl','lin-hl-root','lin-dim','lin-hidden'));
  svg.querySelectorAll('.lin-edge-hl').forEach(e=>e.classList.remove('lin-edge-hl'));
  svg.classList.remove('lab-dim','lab-hide');
}
function drillFromLineage(mid){
  const key=state.linMidToKey[mid];const node=(state.linGraph.nodes||[]).find(n=>n.key===key);if(!node)return;
  // Open in Detail but DO NOT re-root the lineage diagram — so returning to Lineage
  // still shows the full graph the user was exploring.
  if(node.type==='measure'||node.type==='column'){
    state.selected={type:node.type,ref:node.ref};
    state.trail=[{type:node.type,ref:node.ref}];state.trailPos=0;
    highlightSidebar(node.ref.name);renderDetail();showView('detail');
  } else {
    state.selected={type:node.type,ref:node.ref};state.trail=[];state.trailPos=-1;
    renderDetail();showView('detail');
  }
}

function inferRoles(nodes,links){
  const role={},oneC={},manyC={},deg={};
  nodes.forEach(n=>{role[n.name]='';oneC[n.name]=0;manyC[n.name]=0;deg[n.name]=0;});
  for(const l of links){deg[l.source]++;deg[l.target]++;const from=l.fromCardinality==='one'?oneC:manyC,to=l.toCardinality==='many'?manyC:oneC;from[l.source]=(from[l.source]||0)+1;to[l.target]=(to[l.target]||0)+1;}
  for(const n of nodes){
    const name=n.name;const namedDim=/(^|[^a-z])(dim|lkp|lookup|ref)\b/i.test(name)||/dim$/i.test(name);
    const namedFact=/(^|[^a-z])(fact|fct)\b/i.test(name);
    let r;
    if(n.calc)r='calc';
    else if(deg[name]===0)r='disconnected';
    else if(namedFact)r='fact';
    else if(namedDim)r='dim';
    else if(oneC[name]>0&&manyC[name]===0)r='dim';
    else if(manyC[name]>0&&oneC[name]===0)r='fact';
    else if(manyC[name]>0&&oneC[name]>0)r='bridge';
    else r='dim';
    role[name]=r;
  }
  return {role,deg};
}
function renderDetail(){
  const sel=state.selected;const body=$('#detailBody');if(!sel){return;}
  const tb=$('#detailToolbar');if(tb)tb.style.display=(sel.type==='measure'||sel.type==='column')?'flex':'none';
  const drilling=(sel.type==='measure'||sel.type==='column')&&state.trail.length;
  let html=drilling?breadcrumbHTML():'';
  if(sel.type==='measure'){const m=sel.ref;
    html+=`<h3>ƒ ${esc(m.name)} ${vsPill(m)}</h3><div class="meta">measure · table ${esc(m.table)}${m.displayFolder?' · '+esc(m.displayFolder):''}${m.formatString?' · fmt '+esc(m.formatString):''}</div>`;
    if(m.description)html+=`<div class="mini">${esc(m.description)}</div>`;
    html+=daxBlock(m.expression);
    html+=depPills(m.expression);
  } else if(sel.type==='column'){const c=sel.ref;
    html+=`<h3>${c.isCalculated?'∑':'▪'} ${esc(c.table)}[${esc(c.name)}] ${vsPill(c)}</h3><div class="meta">${c.isCalculated?'calculated column':'column'} · ${esc(c.dataType||'?')}${c.sourceColumn?' · source '+esc(c.sourceColumn):''}</div>`;
    if(c.isCalculated)html+=daxBlock(c.expression)+depPills(c.expression);
    else{const p=(state.model.tables[c.table]||{}).partitions||[];const a=p[0]?analyzeM(p[0].source):null;
      html+=`<div class="mini">Stored column, loaded from the <b>${esc(c.table)}</b> partition source${a&&a.kind?` (<span style="color:var(--cyan)">${esc(a.kind)}</span>${a.details.item?' · '+esc((a.details.schema?a.details.schema+'.':'')+a.details.item):''})`:''}.</div>`;
      html+=`<div class="mini">Switch to the <b>Lineage</b> tab to trace it through to source.</div>`;}
  } else if(sel.type==='table'){const t=sel.ref;
    html+=`<h3>▦ ${esc(t.name)} ${vsPill(t)}</h3><div class="meta">${t.isCalculated?'calculated table':'table'} · ${t.columns.length} columns · ${t.measures.length} measures · ${t.partitions.length} partition(s)</div>`;
    if(t.description)html+=`<div class="mini">${esc(t.description)}</div>`;
    for(const p of t.partitions){
      html+=`<div class="lbl">Partition · ${esc(p.name||'')} (${esc(p.type||'?')})</div>`;
      const a=analyzeM(p.source);
      const srcs=(a.sources&&a.sources.length)?a.sources:(a.kind?[{kind:a.kind,details:a.details}]:[]);
      if(srcs.length||a.refs.length){
        html+='<div>';
        srcs.forEach((s,i)=>{const d=s.details||{};
          html+=`<span class="pill cyan">${esc(s.kind)}</span>`;
          if(d.server)html+=`<span class="pill">srv: ${esc(d.server)}</span>`;
          if(d.database)html+=`<span class="pill" style="border-color:var(--green);color:var(--green)">db: ${esc(d.database)}</span>`;
          if(d.schema&&d.item)html+=`<span class="pill">${esc(d.schema)}.${esc(d.item)}</span>`;
          if(d.url)html+=`<span class="pill">${esc(d.url)}</span>`;
          if(i<srcs.length-1)html+='<span style="color:var(--ink-faint);margin:0 4px">+</span>';
        });
        html+=a.refs.map(r=>`<span class="pill green">→ ${esc(r)}</span>`).join('');
        html+='</div>';
        if(srcs.length>1)html+=`<div class="mini">${srcs.length} sources detected in this partition.</div>`;
      }
      // extra schema.item pairs beyond the first (multi-table pull)
      if(a.items&&a.items.length>1){
        html+=`<div class="mini">Tables/views referenced: `+a.items.map(it=>`<code>${esc((it.schema?it.schema+'.':'')+it.item)}</code>`).join(', ')+`</div>`;
      }
      html+=`<pre class="code">${esc(p.source||(p.entityName?('entity: '+(p.schemaName?p.schemaName+'.':'')+p.entityName):'(no source)'))}</pre>`;
    }
  } else if(sel.type==='expression'){const e=sel.ref;
    html+=`<h3>◇ ${esc(e.name)} ${vsPill(e)}</h3><div class="meta">shared expression${e.kind?' · '+esc(e.kind):''}</div>`;
    html+=`<pre class="code">${esc(e.expression||'')}</pre>`;
  } else if(sel.type==='source'){const s=sel.ref;
    html+=`<h3>⛃ ${esc(s.name||s.kind||'Data source')}</h3><div class="meta">data source${s.kind?' · '+esc(s.kind):''}</div>`;
    const rows=[];
    if(s.server)rows.push(['Server',s.server]);
    if(s.dbName)rows.push(['Database',s.dbName]);
    if(s.schema&&s.item)rows.push(['Object',(s.schema?s.schema+'.':'')+s.item]);
    else if(s.item)rows.push(['Object',s.item]);
    if(s.url)rows.push(['URL',s.url]);
    if(rows.length){
      html+=`<div class="lbl">Connection</div><div>`+rows.map(([k,v])=>`<span class="pill"><b style="color:var(--ink-dim)">${esc(k)}:</b> ${esc(v)}</span>`).join('')+`</div>`;
    } else if(s.details&&s.details.length){
      html+=`<div class="lbl">Connection</div><div>`+s.details.map(d=>`<span class="pill">${esc(d)}</span>`).join('')+`</div>`;
    }
    if(s.nativeQuery){html+=`<div class="lbl">Native query</div><pre class="code">${esc(s.nativeQuery)}</pre>`;}
    if(!rows.length&&!(s.details&&s.details.length)&&!s.nativeQuery){
      html+=`<div class="mini">This is a <b>${esc(s.kind||'source')}</b> endpoint. No further connection metadata was found in the partition's M expression — open the owning table to see the full source query.</div>`;
    }
  } else if(sel.type==='partition'){const p=sel.ref;
    html+=`<h3>⛁ ${esc(p.name||'partition')}</h3><div class="meta">partition${p.table?' · table '+esc(p.table):''}${p.type?' · '+esc(p.type):''}${p.partitionMode?' · '+esc(p.partitionMode):''}</div>`;
    const a=analyzeM(p.source);
    const srcs=(a.sources&&a.sources.length)?a.sources:(a.kind?[{kind:a.kind,details:a.details}]:[]);
    if(srcs.length){
      html+='<div class="lbl">Sources</div><div>';
      srcs.forEach((s,i)=>{const d=s.details||{};
        html+=`<span class="pill cyan">${esc(s.kind)}</span>`;
        if(d.server)html+=`<span class="pill">srv: ${esc(d.server)}</span>`;
        if(d.database)html+=`<span class="pill" style="border-color:var(--green);color:var(--green)">db: ${esc(d.database)}</span>`;
        if(d.schema&&d.item)html+=`<span class="pill">${esc(d.schema)}.${esc(d.item)}</span>`;
        if(d.url)html+=`<span class="pill">${esc(d.url)}</span>`;
        if(i<srcs.length-1)html+='<span style="color:var(--ink-faint);margin:0 4px">+</span>';
      });
      html+='</div>';
    }
    if(p.entityName)html+=`<div class="lbl">Entity</div><div><span class="pill">${esc((p.schemaName?p.schemaName+'.':'')+p.entityName)}</span></div>`;
    html+=`<div class="lbl">Source expression</div><pre class="code">${esc(p.source||(p.entityName?('entity: '+(p.schemaName?p.schemaName+'.':'')+p.entityName):'(no source expression)'))}</pre>`;
    if(!srcs.length&&!p.source&&!p.entityName)html+=`<div class="mini">No source expression is recorded for this partition.</div>`;
  }
  body.innerHTML=html;
  wireDetail();if(sel.type==='measure'||sel.type==='column')renderImpact(sel,body);
}
function breadcrumbHTML(){
  const t=state.trail,p=state.trailPos;
  const crumbs=t.slice(0,p+1).map((it,i)=>{
    const lbl=it.type==='measure'?('ƒ '+it.ref.name):(it.ref.table+'['+it.ref.name+']');
    return (i?'<span class="crumbsep">›</span>':'')+`<span class="crumb${i===p?' here':''}" data-crumb="${i}"><span class="ck">${i===p?'':''}</span>${esc(lbl)}</span>`;
  }).join('');
  const back=`<span class="navbtn${p<=0?' disabled':''}" data-nav="back" title="Back">←</span>`;
  const fwd=`<span class="navbtn${p>=t.length-1?' disabled':''}" data-nav="fwd" title="Forward">→</span>`;
  return `<div class="crumbbar">${back}${fwd}<div class="crumbs">${crumbs}</div></div>`;
}
function daxBlock(expr){
  const shown=state.daxFmt?formatDax(expr):expr;
  const btn=`<span class="toggle${state.daxFmt?' on':''}" data-fmt="1">${state.daxFmt?'↩ original':'⤢ format'}</span>`;
  return `<div class="lbl daxhead">DAX ${btn}</div><pre class="code">${dax(shown)}</pre>`;
}
function depPills(expr){
  const d=analyzeDax(expr,state.knownTables);
  const localSet=new Set(d.locals||[]);
  const items=[];const seen=new Set();const localItems=[];
  new Set(d.names).forEach(n=>{
    if(localSet.has(n)){localItems.push(`<span class="pill" title="extension column defined inside this expression (SUMMARIZE/ADDCOLUMNS) — not a model column">⟨ ${esc(n)} ⟩</span>`);return;}
    const r=resolveName(n);
    if(r&&r.type==='measure'){const k='m|'+n;if(seen.has(k))return;seen.add(k);items.push(`<span class="pill green drill" data-k="m" data-name="${esc(n)}">ƒ ${esc(n)}</span>`);}
    else if(r){const c=r.node;const k='c|'+c.table+'|'+c.name;if(seen.has(k))return;seen.add(k);items.push(`<span class="pill drill" data-k="c" data-table="${esc(c.table)}" data-col="${esc(c.name)}">${esc(c.table)}[${esc(c.name)}]</span>`);}
    else items.push(`<span class="pill">[${esc(n)}]</span>`);
  });
  dedup(d.columns).forEach(c=>{
    const qm=findMeasure(c.table,c.column);if(qm){const mk='m|'+qm.name;if(!seen.has(mk)){seen.add(mk);items.push(`<span class="pill green drill" data-k="m" data-name="${esc(qm.name)}">ƒ ${esc(qm.name)}</span>`);}return;}
    const found=findColumn(c.table,c.column);const k='c|'+c.table+'|'+c.column;if(seen.has(k))return;seen.add(k);
    if(found)items.push(`<span class="pill drill" data-k="c" data-table="${esc(c.table)}" data-col="${esc(c.column)}">${esc(c.table)}[${esc(c.column)}]</span>`);
    else items.push(`<span class="pill">${esc(c.table)}[${esc(c.column)}]</span>`);
  });
  for(const tn of d.tables)if(!d.columns.some(c=>normName(c.table)===normName(tn)))items.push(`<span class="pill">▦ ${esc(tn)} · table reference</span>`);
  let out='';
  if(!items.length)out='<div class="lbl">Direct dependencies</div><div class="mini">No model measure or column references — leaf measure.</div>';
  else out=`<div class="lbl">Direct dependencies <span style="color:var(--ink-faint);text-transform:none;letter-spacing:0">· click to drill in</span></div><div>${items.join('')}</div>`;
  if(localItems.length)out+=`<div class="lbl">Extension columns <span style="color:var(--ink-faint);text-transform:none;letter-spacing:0">· local to this DAX, not model objects</span></div><div>${localItems.join('')}</div>`;
  return out;
}
function wireDetail(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{
    if(b.classList.contains('disabled'))return;
    setTrailPos(state.trailPos+(b.dataset.nav==='back'?-1:1));
  });
  document.querySelectorAll('[data-crumb]').forEach(c=>c.onclick=()=>setTrailPos(+c.dataset.crumb));
  document.querySelectorAll('[data-fmt]').forEach(b=>b.onclick=()=>{state.daxFmt=!state.daxFmt;renderDetail();});
  document.querySelectorAll('[data-vsfile]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();openInVSCode(b.dataset.vsfile,+b.dataset.vsline||null);});
  document.querySelectorAll('.pill.drill').forEach(p=>p.onclick=()=>{
    if(p.dataset.k==='m'){const r=resolveName(p.dataset.name);if(r&&r.type==='measure')focusItem({type:'measure',ref:r.node});}
    else{const c=findColumn(p.dataset.table,p.dataset.col);if(c)focusItem({type:'column',ref:c});}
  });
}
// small "open in VS Code" pill for detail headers — shown whenever we know the source file
function vsPill(ref){
  if(!ref||!ref.file)return '';
  return `<span class="vs-link" data-vsfile="${esc(ref.file)}" data-vsline="${ref.line||''}" title="Open ${esc(ref.file)}${ref.line?' at line '+ref.line:''} in VS Code">⌁ VS Code${ref.line?' :'+ref.line:''}</span>`;
}

/* ---- tabs / focus ---- */
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showView(t.dataset.view));
/* ---- light / dark theme toggle ---- */
function currentTheme(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}
function updateThemeBtn(){const b=$('#themeBtn');if(!b)return;const light=currentTheme()==='light';
  b.textContent=light?'🌙 Dark':'☀️ Light';
  b.title=light?'Switch to dark theme':'Switch to light theme';}
function setTheme(mode){
  if(mode==='light')document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  try{localStorage.setItem('pbiviz.theme',mode);}catch(e){}
  updateThemeBtn();
  // re-theme mermaid diagrams (initMermaid re-renders model + lineage when a model is loaded)
  if(window.mermaid&&state.mermaidOK){try{initMermaid();}catch(e){}}
}
$('#themeBtn').onclick=()=>setTheme(currentTheme()==='light'?'dark':'light');
updateThemeBtn();
function showView(v){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  $('#view-'+v).classList.add('active');
  if(v==='model'&&state.model)renderModel();
  if(v==='lineage')renderLineage();
  if(v==='report'){const sel=$('#reportPageSel');renderReport(sel&&sel.value?+sel.value:0);}
  if(v==='audit')renderAudit();
}
function populateFocus(){
  const sel=$('#focusSel');sel.innerHTML='<option value="">Jump to a table…</option>';
  Object.keys(state.model.tables).sort().forEach(t=>{const o=el('option');o.value=t;o.textContent=t;sel.appendChild(o);});
}
$('#overviewBtn').onclick=goOverview;
$('#focusSel').onchange=()=>{const v=$('#focusSel').value;if(v)openTable(v);else goOverview();};
$('#copyModelMmd').onclick=()=>copy(state.lastModelMmd,'Mermaid copied');
$('#copyLinMmd').onclick=()=>copy(state.lastLinMmd,'Mermaid copied');
/* ---- markdown export ---- */
function openMd(text,title){$('#mdText').value=text;$('#mdTitle').textContent=title;$('#mdModal').style.display='flex';state._mdName=title;}
$('#mdBtn').onclick=()=>{const s=state.selected;if(!s||(s.type!=='measure'&&s.type!=='column'))return;
  const md=lineageMarkdown({type:s.type,ref:s.ref});
  openMd(md,(s.type==='measure'?s.ref.name:s.ref.table+'['+s.ref.name+']'));};
$('#mdModelBtn').onclick=()=>{if(!state.model)return;
  const s=$('#status');s.textContent='Generating model documentation…';
  setTimeout(()=>{openMd(modelMarkdown(),'Whole model');s.textContent='';},20);};
$('#mdCopy').onclick=()=>copy($('#mdText').value,'Markdown copied');
$('#mdDownload').onclick=()=>{const name=(state._mdName||'lineage').replace(/[^\w.-]+/g,'_');downloadText(name+'.md',$('#mdText').value);};
$('#mdClose').onclick=()=>{$('#mdModal').style.display='none';};
$('#mdModal').addEventListener('click',e=>{if(e.target===$('#mdModal'))$('#mdModal').style.display='none';});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#mdModal').style.display==='flex')$('#mdModal').style.display='none';});
document.querySelectorAll('.zoom').forEach(z=>{
  const host=z.dataset.host;
  z.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    const a=b.dataset.z;
    if(a==='in')zoomBy(host,1.2);else if(a==='out')zoomBy(host,1/1.2);
    else if(a==='reset')zoomReset(host);else if(a==='fit')zoomFit(host);
  });
});
$('#isolateToggle').onclick=()=>{
  state.isolate=!state.isolate;
  $('#isolateToggle').classList.toggle('on',state.isolate);
  // re-apply current highlight if one exists
  const svg=$('#lineageDiagram').querySelector('svg');
  if(svg&&svg.querySelector('.lin-hl')){
    const rootEl=svg.querySelector('.lin-hl-root');
    if(rootEl)highlightUpstream(rootEl.getAttribute('data-id'));
  }
};
$('#clearHl').onclick=()=>clearHighlight('lineageDiagram');
$('#rerootBtn').onclick=()=>{const s=state.selected;if(s&&(s.type==='measure'||s.type==='column')){state.linRoot={type:s.type,ref:s.ref};renderLineage();}};

/* ---- sidebar resizer ---- */
(function(){
  const rz=$('#resizer');if(!rz)return;
  const DEF=320,MIN=200,MAX=720;
  const setW=w=>document.documentElement.style.setProperty('--aside-w',clamp(w,MIN,MAX)+'px');
  let dragging=false;
  rz.addEventListener('mousedown',e=>{dragging=true;rz.classList.add('dragging');document.body.classList.add('resizing');e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(!dragging)return;const main=document.querySelector('main');const left=main.getBoundingClientRect().left;setW(e.clientX-left);});
  window.addEventListener('mouseup',()=>{if(dragging){dragging=false;rz.classList.remove('dragging');document.body.classList.remove('resizing');}});
  rz.addEventListener('dblclick',()=>setW(DEF));
})();
async function copy(txt,msg){if(!txt)return;try{if(navigator.clipboard)await navigator.clipboard.writeText(txt);else{const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok)throw Error('Clipboard unavailable');}$('#status').textContent=(msg||'Copied')+' ✓';}catch(e){openMd(txt,'Copy text manually');$('#status').textContent='Clipboard blocked — select and copy the text.';}}

function downloadText(filename,text){
  const blob=new Blob([text],{type:'text/markdown'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},100);
}

/* ---- helpers ---- */
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function dax(expr){ // light syntax highlight
  if(!expr)return'';
  let s=esc(expr);
  s=s.replace(/(&quot;[^&]*?&quot;|"[^"]*")/g,'<span class="str">$1</span>');
  s=s.replace(/(\/\/[^\n]*|--[^\n]*)/g,'<span class="com">$1</span>');
  s=s.replace(/\b(VAR|RETURN|IF|SWITCH|TRUE|FALSE|NOT|AND|OR|IN|BLANK)\b/g,'<span class="kw">$1</span>');
  s=s.replace(/\b([A-Z][A-Z0-9]+)(\s*\()/g,'<span class="fn">$1</span>$2');
  s=s.replace(/(&#39;[^&]*?&#39;|'[^']*')(\s*\[)/g,'<span class="obj">$1</span>$2');
  return s;
}

/* ============================================================ MERMAID LOADER (local first, then CDN) ============================================================ */
function initMermaid(){
  try{window.mermaid.initialize({startOnLoad:false,theme:(mmdIsLight()?'default':'dark'),securityLevel:'strict',flowchart:{curve:'basis',htmlLabels:true,nodeSpacing:45,rankSpacing:70},themeVariables:{fontFamily:'JetBrains Mono, monospace',fontSize:'13px'}});state.mermaidOK=true;
    if(state.model){renderModel();if(state.selected)renderLineage();}}catch(e){}
}
function loadMermaid(){
  // Self-hosted only. The CSP allows scripts from this origin and nothing else.
  if(window.mermaid){initMermaid();return;}   // standalone build embeds it
  const sources=['vendor/mermaid.min.js'];
  let i=0;
  (function next(){
    if(i>=sources.length){$('#mermaidBanner').classList.add('show');return;}
    const s=document.createElement('script');s.src=sources[i++];
    s.onload=()=>{if(window.mermaid)initMermaid();else next();};
    s.onerror=next;document.head.appendChild(s);
  })();
}
loadMermaid();
