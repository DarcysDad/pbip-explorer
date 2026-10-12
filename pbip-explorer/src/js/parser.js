/* PBIP Explorer — parser core.
   Pure functions: no DOM access. Loaded as a classic script in the browser (globals)
   and via require() in the Node test suite. */
'use strict';
/* ============================================================ PARSER CORE ============================================================ */
const KNOWN_PROPS=new Set(['lineageTag','formatString','formatStringDefinition','displayFolder','description','isHidden','isPrivate','dataType','summarizeBy','sourceColumn','dataCategory','sortByColumn','kind','mode','queryGroup','isKey','isNullable','isDefaultLabel','isDefaultImage','isNameInferred','isDataTypeInferred','encoding','encodingHint','sourceProviderType','expressionSource','entityName','schemaName','dataAccessOptions','fromColumn','toColumn','fromCardinality','toCardinality','crossFilteringBehavior','isActive','relyOnReferentialIntegrity','securityFilteringBehavior','joinOnDateBehavior','state','compatibilityLevel','culture','defaultPowerBIDataSourceVersion','sourceQueryCulture','collation','dataSourceDefaultMaxConnections','contentType','level','column','ordinal','calculationGroupExpression','precedence','detailRowsDefinition','objectTranslation','refreshPolicy','isAvailableInMdx','displayOrdinal','alternateOf']);
const SUBDECL=new Set(['annotation','changedProperty','extendedProperty','relatedColumnDetails','variation','level','translation','member','role','tablePermission','columnPermission','linguisticMetadata']);
const BOOLP=new Set(['isHidden','isPrivate','isKey','isNullable','isActive','isDefaultLabel','isDefaultImage','isNameInferred','isDataTypeInferred','isAvailableInMdx','relyOnReferentialIntegrity']);
function indentOf(l){let n=0;for(const c of l){if(c==='\t')n+=4;else if(c===' ')n++;else break;}return n;}
function buildTree(text){
  const lines=text.replace(/\r\n/g,'\n').split('\n');
  const root={indent:-1,raw:'__root__',children:[],descLines:[],exprLines:[],line:0};
  const stack=[root];let pend=[],inBT=false,owner=null;
  for(let li=0;li<lines.length;li++){
    const line=lines[li];
    const t=line.trim();
    if(inBT){ if(t==='```'){inBT=false;owner=null;} else if(owner) owner.exprLines.push(line); continue; }
    if(t==='')continue;
    if(t.startsWith('///')){pend.push(t.replace(/^\/\/\/\s?/,''));continue;}
    const ind=indentOf(line);
    while(stack.length>1&&ind<=stack[stack.length-1].indent)stack.pop();
    const node={indent:ind,raw:t,children:[],descLines:pend,exprLines:[],line:li+1};pend=[];
    stack[stack.length-1].children.push(node);stack.push(node);
    const eq=t.indexOf('=');
    if(eq!==-1&&t.slice(eq+1).trim()==='```'){inBT=true;owner=node;}
  }
  return root;
}
function extractExpression(node,inlineRHS){
  if(node.exprLines&&node.exprLines.length)return dedent(node.exprLines).join('\n').trim();
  const out=[];collectExpr(node,out);const tail=dedentRaw(out).join('\n').trim();
  return [inlineRHS&&inlineRHS.trim()!=='```'?inlineRHS.trim():'',tail].filter(Boolean).join('\n');
}
function collectExpr(node,out){
  for(const c of node.children){
    const tok=c.raw.split(/[\s:=]/)[0];
    const isProp=(c.raw.includes(':')&&KNOWN_PROPS.has(c.raw.split(':')[0].trim()))||BOOLP.has(c.raw.trim())||SUBDECL.has(tok);
    if(isProp)continue;
    out.push({indent:c.indent,raw:c.raw});collectExpr(c,out);
  }
}
function dedent(lines){const ind=lines.filter(l=>l.trim()).map(indentOf);const min=ind.length?Math.min(...ind):0;return lines.map(l=>' '.repeat(Math.max(0,indentOf(l)-min))+l.trim());}
function dedentRaw(items){if(!items.length)return[];const min=Math.min(...items.map(i=>i.indent));return items.map(i=>' '.repeat(Math.max(0,i.indent-min))+i.raw);}
function getProp(node,key){for(const c of node.children){const i=c.raw.indexOf(':');if(i!==-1&&c.raw.slice(0,i).trim()===key)return c.raw.slice(i+1).trim();if(c.raw.trim()===key)return true;}return null;}
function boolProp(node,key){const v=getProp(node,key);return v===true||String(v).toLowerCase()==='true';}
function delimiterOutsideQuotes(s,delimiter){let quoted=false;for(let i=0;i<s.length;i++){if(s[i]==="'"){if(quoted&&s[i+1]==="'"){i++;continue;}quoted=!quoted;}else if(!quoted&&s[i]===delimiter)return i;}return -1;}
function parseHeader(raw){const m=raw.match(/^([A-Za-z_][\w]*)\b\s*(.*)$/);if(!m)return{keyword:raw,name:'',rhs:null};let rest=m[2],rhs=null;const i=delimiterOutsideQuotes(rest,'=');if(i!==-1){rhs=rest.slice(i+1);rest=rest.slice(0,i);}return{keyword:m[1],name:unquote(rest.trim()),rhs};}
function unquote(s){s=s.trim();return s.startsWith("'")&&s.endsWith("'")?s.slice(1,-1).replace(/''/g,"'"):s;}
function splitColumnRef(s){s=(s||'').trim();const i=delimiterOutsideQuotes(s,'.');return{table:unquote(i<0?s:s.slice(0,i)),column:i<0?'':unquote(s.slice(i+1))};}

function parseModel(files){
  const model={tables:Object.create(null),measures:[],columns:[],relationships:[],expressions:[],modelInfo:{},database:{},fileErrors:[]};
  for(const f of files){
    let root;try{root=buildTree(f.text);}catch(e){model.fileErrors.push({path:f.path,error:String(e)});continue;}
    for(const node of root.children){
      const h=parseHeader(node.raw);
      if(h.keyword==='table')ingestTable(model,node,h,f.path);
      else if(h.keyword==='relationship'){const rel=parseRel(node,h);rel.file=f.path;rel.line=node.line;model.relationships.push(rel);}
      else if(h.keyword==='expression')model.expressions.push({name:h.name,kind:getProp(node,'kind'),expression:extractExpression(node,h.rhs),file:f.path,line:node.line});
      else if(h.keyword==='model')model.modelInfo={name:h.name,culture:getProp(node,'culture')};
      else if(h.keyword==='database')model.database={name:h.name,compatibilityLevel:getProp(node,'compatibilityLevel')};
      else if(h.keyword==='createOrReplace'||h.keyword==='ref'){
        for(const inner of node.children){const ih=parseHeader(inner.raw);
          if(ih.keyword==='table')ingestTable(model,inner,ih,f.path);
          else if(ih.keyword==='relationship')model.relationships.push(parseRel(inner,ih));}
      }
    }
  }
  return model;
}
function ingestTable(model,node,h,path){
  const tn=h.name;let t=model.tables[tn];
  if(!t){t={name:tn,file:path,line:node.line||1,columns:[],measures:[],partitions:[],hierarchies:[],isHidden:boolProp(node,'isHidden'),description:node.descLines.join('\n'),isCalculated:false};model.tables[tn]=t;}
  for(const ch of node.children){
    const c=parseHeader(ch.raw);
    if(c.keyword==='measure'){const m={name:c.name,table:tn,file:path,line:ch.line,expression:extractExpression(ch,c.rhs),formatString:getProp(ch,'formatString'),displayFolder:getProp(ch,'displayFolder'),description:ch.descLines.join('\n')||getProp(ch,'description')||'',lineageTag:getProp(ch,'lineageTag')};t.measures.push(m);model.measures.push(m);}
    else if(c.keyword==='column'){const calc=c.rhs!=null;const col={name:c.name,table:tn,file:path,line:ch.line,dataType:getProp(ch,'dataType'),sourceColumn:getProp(ch,'sourceColumn'),isCalculated:calc,expression:calc?extractExpression(ch,c.rhs):null,isHidden:boolProp(ch,'isHidden'),description:ch.descLines.join('\n')||getProp(ch,'description')||''};t.columns.push(col);model.columns.push(col);}
    else if(c.keyword==='partition'){const mode=c.rhs?c.rhs.trim():null;const sn=ch.children.find(x=>parseHeader(x.raw).keyword==='source');let src='';if(sn){const inline=sn.raw.slice(sn.raw.indexOf('=')+1);src=extractExpression(sn,inline);}t.partitions.push({name:c.name,table:tn,file:path,line:ch.line,type:mode,partitionMode:getProp(ch,'mode'),sourceType:getProp(ch,'sourceProviderType'),entityName:getProp(ch,'entityName'),schemaName:getProp(ch,'schemaName'),expressionSource:getProp(ch,'expressionSource'),source:src});if(mode==='calculated')t.isCalculated=true;}
    else if(c.keyword==='hierarchy'){const lv=ch.children.filter(x=>parseHeader(x.raw).keyword==='level').map(x=>getProp(x,'column')||parseHeader(x.raw).name);t.hierarchies.push({name:c.name,levels:lv});}
  }
}
function parseRel(node,h){const a=getProp(node,'isActive');
  const fc=getProp(node,'fromColumn'),tc=getProp(node,'toColumn');
  const f=splitColumnRef(fc),t=splitColumnRef(tc);
  return{name:h.name,fromColumn:fc,toColumn:tc,fromTable:f.table,fromCol:f.column,toTable:t.table,toCol:t.column,fromCardinality:getProp(node,'fromCardinality')||'many',toCardinality:getProp(node,'toCardinality')||'one',crossFilteringBehavior:getProp(node,'crossFilteringBehavior'),isActive:a===null?true:(a!=='false')};}

function analyzeDax(expr,known){
  // Character scanner, not regex. DAX reference syntax has nested delimiters that regex
  // cannot parse: a table name may itself contain '[' and ']' (e.g. '[Sales] Daily Snapshot'),
  // single quotes escape as '' inside a quoted name, and ']' escapes as ']]' inside a column
  // bracket. The previous regex paired quotes greedily and, across a  '],  '[  boundary,
  // stitched the gap between two references into a phantom table name. A left-to-right scan
  // that knows the escaping rules resolves each reference exactly.
  if(!expr)return{columns:[],names:[],tables:[],locals:[]};
  const s=String(expr),n=s.length;
  const cols=[],names=[],tabs=new Set(),locals=[];
  // locals (extension columns) only exist inside functions that can declare them
  const isKnown=knownMatcher(known);
  const hasExtFn=/\b(ADDCOLUMNS|SELECTCOLUMNS|SUMMARIZE|SUMMARIZECOLUMNS|GROUPBY|ROW|DATATABLE)\s*\(/i.test(s);
  const nextNonSpace=k=>{while(k<n&&/\s/.test(s[k]))k++;return k;};
  let i=0,pendTable=null;  // a table token (quoted or bare) awaiting a following [column]
  while(i<n){
    const c=s[i];
    // --- comments: kill any pending table, skip to newline / close ---
    if(c==='/'&&s[i+1]==='/'){while(i<n&&s[i]!=='\n')i++;pendTable=null;continue;}
    if(c==='-'&&s[i+1]==='-'){while(i<n&&s[i]!=='\n')i++;pendTable=null;continue;}
    if(c==='/'&&s[i+1]==='*'){i+=2;while(i<n&&!(s[i]==='*'&&s[i+1]==='/'))i++;i+=2;pendTable=null;continue;}
    // --- string literal "..." ("" escapes a quote) ---
    if(c==='"'){
      let j=i+1,str='';
      while(j<n){if(s[j]==='"'){if(s[j+1]==='"'){str+='"';j+=2;continue;}break;}str+=s[j];j++;}
      i=j+1;
      // "name", <expr>  inside an extension-column function => a local column name
      if(hasExtFn&&s[nextNonSpace(i)]===',')locals.push(str);
      pendTable=null;continue;
    }
    // --- quoted table name '...' ('' escapes a quote) ---
    if(c==="'"){
      let j=i+1,name='';
      while(j<n){if(s[j]==="'"){if(s[j+1]==="'"){name+="'";j+=2;continue;}break;}name+=s[j];j++;}
      i=j+1;pendTable=name;
      if(isKnown(name))tabs.add(name);
      continue;
    }
    // --- bracket [...] (']]' escapes a close-bracket) ---
    if(c==='['){
      let j=i+1,name='';
      while(j<n){if(s[j]===']'){if(s[j+1]===']'){name+=']';j+=2;continue;}break;}name+=s[j];j++;}
      i=j+1;
      if(pendTable!==null){cols.push({table:pendTable,column:name});pendTable=null;}
      else names.push(name);            // bare [Measure] / [Column] reference
      continue;
    }
    // --- bare identifier: an unquoted table only if immediately followed by '[' ---
    if(/[A-Za-z_]/.test(c)){
      let j=i,id='';while(j<n&&/[A-Za-z0-9_]/.test(s[j])){id+=s[j];j++;}
      i=j;
      const k=nextNonSpace(i);
      if(s[k]==='['){pendTable=id;if(isKnown(id))tabs.add(id);}
      else {if(s[k]!=='('&&isKnown(id))tabs.add(id);pendTable=null;}
      continue;
    }
    // any other character (operator, comma, paren, whitespace): a non-space breaks a pending table
    if(!/\s/.test(c))pendTable=null;
    i++;
  }
  return{columns:cols,names,tables:[...tabs],locals:[...new Set(locals)]};
}
function analyzeM(mx){
  const out={kind:null,details:{},refs:[],nativeQuery:null,functions:[],sources:[],items:[]};
  if(!mx)return out;
  const push=(kind,details)=>{out.sources.push({kind,details:details||{}});if(!out.kind){out.kind=kind;out.details=details||{};}};
  let m;
  const reSqlDb=/Sql\.Database\s*\(\s*(#"[^"]*"|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w]*)\s*(?:,\s*(#"[^"]*"|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w]*)\s*)?/g;
  while((m=reSqlDb.exec(mx))!==null){const d={server:clean(m[1])};if(m[2])d.database=clean(m[2]);out.functions.push('Sql.Database');push('Sql.Database',d);}
  const reSqls=/Sql\.Databases\s*\(\s*(#"[^"]*"|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w]*)/g;
  while((m=reSqls.exec(mx))!==null){out.functions.push('Sql.Databases');push('Sql.Database',{server:clean(m[1])});}
  // DB from navigation {[Name="DB"]} when there's also Schema/Item navigation and no 2nd-arg db
  if(out.sources.length){const navDb=mx.match(/\{\s*\[\s*Name\s*=\s*"([^"]+)"\s*\]\s*\}/);
    if(navDb&&/\[\s*Schema\s*=/.test(mx)){out.sources.forEach(s=>{if(s.kind==='Sql.Database'&&!s.details.database)s.details.database=navDb[1];});if(out.kind==='Sql.Database'&&!out.details.database)out.details.database=navDb[1];}}
  const others=[['Synapse',/Synapse\w*\.\w+/],['AnalysisServices.Database',/AnalysisServices\.Database/],
    ['AzureStorage.Blobs',/AzureStorage\.Blobs/],['AzureStorage.DataLake',/AzureStorage\.DataLake/],
    ['Lakehouse.Contents',/Lakehouse\.Contents/],['Excel.Workbook',/Excel\.Workbook/],
    ['Csv.Document',/Csv\.Document/],['Web.Contents',/Web\.Contents\s*\(\s*("(?:[^"\\]|\\.)*"|[^,()]+)/],
    ['Json.Document',/Json\.Document/],['OData.Feed',/OData\.Feed\s*\(\s*("(?:[^"\\]|\\.)*"|[^,()]+)?/],
    ['Folder.Files',/Folder\.Files/],['SharePoint.Files',/SharePoint\w*\.\w+/],
    ['Oracle.Database',/Oracle\.Database\s*\(\s*(#"[^"]*"|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w]*)/],
    ['PostgreSQL.Database',/PostgreSQL\.Database\s*\(\s*(#"[^"]*"|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w]*)\s*(?:,\s*(#"[^"]*"|"(?:[^"\\]|\\.)*"|[A-Za-z_][\w]*))?/]];
  for(const[name,re]of others){const mm=mx.match(re);if(mm){out.functions.push(name);const d={};
    if(name==='Web.Contents'||name==='OData.Feed')d.url=clean(mm[1]);
    if(name==='Oracle.Database')d.server=clean(mm[1]);
    if(name==='PostgreSQL.Database'){d.server=clean(mm[1]);if(mm[2])d.database=clean(mm[2]);}
    push(name,d);}}
  const items=[...mx.matchAll(/\[\s*Schema\s*=\s*"([^"]+)"\s*,\s*Item\s*=\s*"([^"]+)"\s*\]/g)];
  if(items.length){out.details.schema=out.details.schema||items[0][1];out.details.item=out.details.item||items[0][2];
    out.items=items.map(i=>({schema:i[1],item:i[2]}));
    if(out.sources[0]){out.sources[0].details.schema=out.sources[0].details.schema||items[0][1];out.sources[0].details.item=out.sources[0].details.item||items[0][2];}}
  if(/Value\.NativeQuery\s*\(/.test(mx)){const q=mx.match(/"((?:[^"\\]|\\.){0,4000}?(?:select|SELECT)[\s\S]*?)"/);if(q)out.nativeQuery=q[1];push('Value.NativeQuery',{});}
  const reR=/#"([^"]+)"/g;let r;const seen=new Set();while((r=reR.exec(mx))!==null)if(!seen.has(r[1])){seen.add(r[1]);out.refs.push(r[1]);}
  return out;
}
// Strips string quotes; a #"Name" parameter reference comes back as its bare name.
function clean(s){return(s||'').trim().replace(/^#?"|"$/g,'');}
function normName(s){return String(s||'').trim().toLowerCase();}

function tokenizeDax(src){
  const toks=[];let i=0;const n=src.length;
  const isIdStart=c=>/[A-Za-z_]/.test(c), isId=c=>/[A-Za-z0-9_]/.test(c);
  while(i<n){const c=src[i];
    if(c===' '||c==='\t'||c==='\r'||c==='\n'){i++;continue;}
    if(c==='/'&&src[i+1]==='/'){let j=i;while(j<n&&src[j]!=='\n')j++;toks.push({k:'com',v:src.slice(i,j)});i=j;continue;}
    if(c==='-'&&src[i+1]==='-'){let j=i;while(j<n&&src[j]!=='\n')j++;toks.push({k:'com',v:src.slice(i,j)});i=j;continue;}
    if(c==='/'&&src[i+1]==='*'){let j=i+2;while(j<n&&!(src[j]==='*'&&src[j+1]==='/'))j++;j=Math.min(n,j+2);toks.push({k:'com',v:src.slice(i,j)});i=j;continue;}
    if(c==='"'){let j=i+1;while(j<n){if(src[j]==='"'){if(src[j+1]==='"'){j+=2;continue;}break;}j++;}j++;toks.push({k:'str',v:src.slice(i,j)});i=j;continue;}
    if(c==="'"){let j=i+1;while(j<n){if(src[j]==="'"){if(src[j+1]==="'"){j+=2;continue;}break;}j++;}j++;toks.push({k:'qid',v:src.slice(i,j)});i=j;continue;}
    if(c==='['){let j=i+1;while(j<n&&src[j]!==']')j++;j++;toks.push({k:'ref',v:src.slice(i,j)});i=j;continue;}
    if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(src[i+1]||''))){let j=i;while(j<n&&/[0-9.]/.test(src[j]))j++;toks.push({k:'num',v:src.slice(i,j)});i=j;continue;}
    if(isIdStart(c)){let j=i;while(j<n&&isId(src[j]))j++;const v=src.slice(i,j);toks.push({k:/^(VAR|RETURN)$/i.test(v)?'kw':'id',v});i=j;continue;}
    const two=src.substr(i,2);
    if(['<=','>=','<>','&&','||',':='].includes(two)){toks.push({k:'op',v:two});i+=2;continue;}
    toks.push({k:'punct',v:c});i++;
  }
  return toks;
}
function formatDax(src){
  if(!src||!src.trim())return src||'';
  const toks=tokenizeDax(src);let out='';let indent=0;
  const pad=()=>'    '.repeat(Math.max(0,indent));
  const newline=()=>{out=out.replace(/[ \t]+$/,'');out+='\n'+pad();};
  const opSet=new Set(['+','-','*','/','&','=','<','>']);
  function decide(o){let depth=0,comma=false,len=0,nested=0;
    for(let j=o;j<toks.length;j++){const v=toks[j].v;
      if(v==='('){depth++;if(depth>1)nested++;}
      else if(v===')'){depth--;if(depth===0)return (comma&&(len>48||nested>0))||len>72;}
      else if(v===','&&depth===1)comma=true;len+=v.length+1;}
    return comma;}
  const frames=[];
  for(let i=0;i<toks.length;i++){const t=toks[i],v=t.v,k=t.k,pv=toks[i-1];
    if(k==='kw'&&/^VAR$/i.test(v)){if(out.trim())newline();out+='VAR ';continue;}
    if(k==='kw'&&/^RETURN$/i.test(v)){if(out.trim())newline();out+='RETURN';indent++;newline();continue;}
    if(v==='('){const ml=decide(i);frames.push(ml);if(pv&&(pv.k==='id'||pv.k==='kw'))out+=' ';out+='(';if(ml){indent++;newline();}continue;}
    if(v===')'){const ml=frames.pop();if(ml){indent--;newline();}else{out=out.replace(/[ \t]+$/,'');}out+=')';continue;}
    if(v===','){out=out.replace(/[ \t]+$/,'');out+=',';if(frames[frames.length-1])newline();else out+=' ';continue;}
    if((v==='-'||v==='+')&&(!pv||pv.v==='('||pv.v===','||pv.k==='op'||pv.k==='kw')){if(out&&!/[\s(]$/.test(out))out+=' ';out+=v;continue;}
    if(k==='op'||(k==='punct'&&opSet.has(v))){if(out&&!/[\s(]$/.test(out))out+=' ';out+=v+' ';continue;}
    if(v==='{'||v==='}'){out+=v;continue;}
    if(k==='com'){if(out.trim())newline();out+=v;newline();continue;}
    if(k==='ref'){out+=v;continue;}
    if(out&&/[\w\])'"]$/.test(out)&&/^[\w'"]/.test(v))out+=' ';
    out+=v;
  }
  return out.replace(/[ \t]+$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}

// Normalised lookup of known table names, built once per Set rather than once per token.
const _knownCache=new WeakMap();
function knownMatcher(known){
  if(!known)return()=>false;
  let norm=_knownCache.get(known);
  if(!norm){norm=new Set([...known].map(normName));_knownCache.set(known,norm);}
  return name=>norm.has(normName(name));
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={buildTree,parseHeader,unquote,splitColumnRef,parseModel,analyzeDax,analyzeM,normName,tokenizeDax,formatDax,extractExpression,getProp};
}
