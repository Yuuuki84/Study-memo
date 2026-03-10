/* ============================================================
   学習記録ログ v7 — A〜H 全機能実装
   ============================================================ */

/* ===== CONSTANTS ===== */
const STORAGE_KEY    = "learning_log_v1";
const DIRTY_KEY      = "learning_log_dirty";
const LASTSYNC_KEY   = "learning_log_last_sync";
const TRASH_KEY      = "learning_log_trash";
const SYNCLOG_KEY    = "learning_log_synclog";
const BACKUP_KEY     = "learning_log_backup";
const $ = id => document.getElementById(id);

/* ===== STATE ===== */
let state = {
  items:      [],   // active items
  trash:      [],   // soft-deleted
  selectedId: null,
  query:      "",
  filter:     "active",  // active | star | trash | dup
  tagFilter:  null,
  sortBy:     "updatedAt"
};
let editingId    = null;
let undoStack    = [];   // { item, from: 'active'|'trash' }
let undoTimer    = null;
let editUrlList  = [];   // temp URL list in form
let cmdActiveIdx = -1;

/* ===== UTILS ===== */
const now = () => Date.now();
function uid(){
  return crypto?.randomUUID ? crypto.randomUUID() : `id_${now()}_${Math.random().toString(16).slice(2)}`;
}
function normalizeTags(str){
  if(!str) return [];
  return str.split(/[,、\s]+/).map(t=>t.trim()).filter(Boolean).slice(0,20);
}
function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
function formatDateTime(ms){
  if(!ms) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function isValidUrl(s){
  return /^https?:\/\/.+/i.test((s||"").trim());
}

/* ===== TOAST ===== */
function toast(msg, type="info", dur=3000){
  const el = document.createElement("div");
  el.className = `toast t-${type}`;
  el.textContent = msg;
  $("toastContainer").appendChild(el);
  setTimeout(()=>el.remove(), dur);
}

/* ===== SYNC LOG ===== */
function pushSyncLog(msg){
  const logs = getSyncLogs();
  logs.unshift({ msg, at: now() });
  localStorage.setItem(SYNCLOG_KEY, JSON.stringify(logs.slice(0,100)));
}
function getSyncLogs(){
  try{ return JSON.parse(localStorage.getItem(SYNCLOG_KEY)||"[]"); }catch{ return []; }
}
function renderSyncLog(){
  const logs = getSyncLogs();
  $("syncLogBox").innerHTML = logs.length
    ? logs.map(l=>`<p>${escapeHtml(formatDateTime(l.at))} — ${escapeHtml(l.msg)}</p>`).join("")
    : "<p>ログなし</p>";
}

/* ===== DIRTY / SYNC STATUS ===== */
function isDirty(){ return localStorage.getItem(DIRTY_KEY)==="true"; }
function markDirty(){
  localStorage.setItem(DIRTY_KEY,"true");
  updateSyncStatus();
}
function clearDirty(){
  localStorage.setItem(DIRTY_KEY,"false");
  updateSyncStatus();
}
function updateSyncStatus(){
  const dirty = isDirty();
  const last  = Number(localStorage.getItem(LASTSYNC_KEY)||"0");
  const unsync = dirty ? state.items.filter(x=>!x._synced).length : 0;
  $("syncStatus").textContent = `同期状態: ${dirty?"未同期":"同期済み"} ／ 最終: ${formatDateTime(last)}`;
  const badge = $("unsyncCount");
  if(dirty && unsync>0){ badge.textContent=unsync; badge.style.display="inline"; }
  else{ badge.style.display="none"; }
}

/* ===== STORAGE ===== */
function normalizeItem(x){
  if(!x) return x;
  if(!Array.isArray(x.urls)){
    const u = (x.url||"").trim();
    x.urls = u?[u]:[];
    delete x.url;
  }
  if(x.starred===undefined) x.starred=false;
  if(!x.notes) x.notes=[];
  return x;
}
function loadItems(){
  try{
    const r = localStorage.getItem(STORAGE_KEY);
    const a = r?JSON.parse(r):[];
    return (Array.isArray(a)?a:[]).map(normalizeItem);
  }catch{ return []; }
}
function loadTrash(){
  try{
    const r = localStorage.getItem(TRASH_KEY);
    const a = r?JSON.parse(r):[];
    return (Array.isArray(a)?a:[]).map(normalizeItem);
  }catch{ return []; }
}
function saveLocalOnly(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  localStorage.setItem(TRASH_KEY,   JSON.stringify(state.trash));
  markDirty();
}
function autoBackup(){
  /* 同期前バックアップ */
  localStorage.setItem(BACKUP_KEY, JSON.stringify({
    items: state.items, trash: state.trash, at: now()
  }));
  pushSyncLog("自動バックアップ作成");
}

/* ===== FIND ===== */
function findItem(id){ return state.items.find(x=>x.id===id)??null; }
function findTrash(id){ return state.trash.find(x=>x.id===id)??null; }
function findAny(id){ return findItem(id)||findTrash(id); }

/* ===== SOFT DELETE / RESTORE / PERM DELETE ===== */
function softDelete(id){
  const item = findItem(id);
  if(!item) return;
  undoStack.push({ item: JSON.parse(JSON.stringify(item)), from:"active" });
  state.items = state.items.filter(x=>x.id!==id);
  item.deletedAt = now();
  state.trash.unshift(item);
  if(state.selectedId===id) state.selectedId = state.items[0]?.id??null;
  saveLocalOnly();
  showUndoBar(`「${item.title}」をゴミ箱へ移動しました`);
  render();
}
function restoreFromTrash(id){
  const item = findTrash(id);
  if(!item) return;
  // 復元先に同名があれば警告
  const dup = state.items.find(x=>x.title===item.title);
  if(dup){
    if(!confirm(`アクティブに「${item.title}」が既に存在します。復元して上書きしますか？`)) return;
  }
  delete item.deletedAt;
  state.trash = state.trash.filter(x=>x.id!==id);
  state.items.unshift(item);
  state.selectedId = item.id;
  saveLocalOnly();
  toast("復元しました","success");
  render();
}
function permDelete(id){
  const item = findTrash(id);
  if(!item) return;
  // 「DELETE」入力確認
  const input = prompt(`完全削除します。確認のため「DELETE」と入力してください。\n（「${item.title}」）`);
  if(input!=="DELETE"){ toast("キャンセルしました"); return; }
  state.trash = state.trash.filter(x=>x.id!==id);
  if(state.selectedId===id) state.selectedId=null;
  saveLocalOnly();
  toast("完全削除しました","error");
  render();
}

/* ===== UNDO BAR ===== */
function showUndoBar(msg){
  $("undoMsg").textContent = msg;
  $("undoBar").classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoBar, 6000);
}
function hideUndoBar(){
  $("undoBar").classList.remove("show");
}
function doUndo(){
  const snap = undoStack.pop();
  if(!snap){ toast("元に戻せるものがありません","warn"); return; }
  const { item, from } = snap;
  if(from==="active"){
    // trashから削除してactiveへ戻す
    state.trash = state.trash.filter(x=>x.id!==item.id);
    delete item.deletedAt;
    state.items.unshift(item);
    state.selectedId = item.id;
  }
  saveLocalOnly();
  hideUndoBar();
  toast("元に戻しました","success");
  render();
}

/* ===== DUPLICATE DETECTION ===== */
function detectDups(){
  const titleMap = {};
  state.items.forEach(x=>{ titleMap[x.title.trim().toLowerCase()] = (titleMap[x.title.trim().toLowerCase()]||0)+1; });
  return new Set(state.items.filter(x=>titleMap[x.title.trim().toLowerCase()]>1).map(x=>x.id));
}

/* ===== FILTERED LIST ===== */
function filteredItems(){
  let list = state.filter==="trash" ? state.trash : state.items;
  const q = (state.query||"").trim().toLowerCase();
  const dupIds = state.filter==="dup" ? detectDups() : null;

  if(state.filter==="star")     list = list.filter(x=>x.starred);
  if(state.filter==="dup")      list = state.items.filter(x=>dupIds.has(x.id));

  if(state.tagFilter) list = list.filter(x=>(x.tags||[]).includes(state.tagFilter));

  if(q) list = list.filter(item=>{
    const hay = [item.title,(item.urls||[]).join(" "),item.summary,(item.tags||[]).join(" "),(item.notes||[]).map(n=>n.text).join(" ")].join(" ").toLowerCase();
    return hay.includes(q);
  });

  const sortBy = state.sortBy;
  list = [...list].sort((a,b)=>{
    if(sortBy==="title") return (a.title||"").localeCompare(b.title||"");
    return (b[sortBy]||0)-(a[sortBy]||0);
  });
  return list;
}

/* ===== ALL TAGS ===== */
function allTags(){
  const set = new Set();
  state.items.forEach(x=>(x.tags||[]).forEach(t=>set.add(t)));
  return [...set].sort();
}

/* ===== RENDER ===== */
function highlightText(text, q){
  if(!q) return escapeHtml(text);
  const parts = escapeHtml(text).split(new RegExp(`(${escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi"));
  return parts.map((p,i)=>i%2===1?`<span class="hl">${p}</span>`:p).join("");
}

function renderList(){
  const items = filteredItems();
  const q = (state.query||"").trim().toLowerCase();
  const dupIds = detectDups();

  $("listCount").textContent = `${items.length} 件`;

  const html = items.map(item=>{
    const isDup = dupIds.has(item.id);
    const cls = [
      "item",
      item.id===state.selectedId?"active":"",
      item.deletedAt?"trashed":"",
      isDup?"dup-item":""
    ].filter(Boolean).join(" ");
    return `
    <div class="${cls}" data-id="${escapeHtml(item.id)}">
      <h4>
        ${item.starred?'<span class="star-icon">⭐</span>':""}
        ${item.deletedAt?'<span class="trash-icon">🗑</span>':""}
        ${highlightText(item.title,q)}
        ${isDup?'<span class="dup-badge">重複</span>':""}
      </h4>
      <div class="muted">更新: ${formatDateTime(item.updatedAt)}
        ${(item.tags||[]).length?` ／ ${(item.tags).map(t=>`<span class="tag">#${escapeHtml(t)}</span>`).join("")}`:""}
      </div>
    </div>`;
  }).join("");
  $("itemsList").innerHTML = html || `<p class="muted">該当なし</p>`;
}

function renderTagFilterBar(){
  const tags = allTags();
  $("tagFilterBar").innerHTML = tags.map(t=>`<span class="tag ${state.tagFilter===t?"active-filter":""}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join("");
}

function renderDetail(){
  const item = findAny(state.selectedId);
  if(!item){
    $("detailTitle").textContent="（未選択）";
    $("detailTags").innerHTML="";
    $("detailSummary").textContent="";
    $("detailUrl").innerHTML="";
    $("notesList").innerHTML="";
    $("detailMeta").textContent="";
    $("addNoteBtn").disabled=true;
    $("openNoteModalBtn").disabled=true;
    $("softDeleteBtn").disabled=true;
    $("starBtn").disabled=true;
    $("restoreItemBtn").style.display="none";
    $("permDeleteBtn").style.display="none";
    $("softDeleteBtn").style.display="inline-block";
    return;
  }

  const inTrash = !!item.deletedAt;
  $("detailTitle").textContent=item.title||"";
  $("detailTags").innerHTML=(item.tags||[]).map(t=>`<span class="tag">#${escapeHtml(t)}</span>`).join("");
  $("detailSummary").textContent=item.summary||"";
  $("detailMeta").textContent=`作成: ${formatDateTime(item.createdAt)} ／ 更新: ${formatDateTime(item.updatedAt)}${item.deletedAt?` ／ 削除: ${formatDateTime(item.deletedAt)}`:""}`;

  /* URLs */
  const box = $("detailUrl");
  box.innerHTML="";
  const urls = Array.isArray(item.urls)?item.urls:[];
  if(urls.length===0){ box.textContent="（なし）"; }
  else{
    const ul = document.createElement("ul");
    ul.style.cssText="margin:6px 0 0;padding-left:18px;";
    urls.forEach(u=>{
      const li = document.createElement("li");
      li.style.marginBottom="4px";
      const raw=(u||"").trim();
      const wrap = document.createElement("span");
      wrap.style.display="flex";wrap.style.gap="6px";wrap.style.alignItems="center";
      if(isValidUrl(raw)){
        const a=document.createElement("a"); a.href=raw; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent=raw; a.style.fontSize="13px";
        const copyBtn=document.createElement("button"); copyBtn.textContent="コピー"; copyBtn.className="ghost mini"; copyBtn.style.fontSize="11px"; copyBtn.style.padding="2px 6px";
        copyBtn.onclick=(e)=>{ e.stopPropagation(); navigator.clipboard.writeText(raw).then(()=>toast("URLコピー","success")); };
        wrap.appendChild(a); wrap.appendChild(copyBtn);
      } else { wrap.textContent=raw; }
      li.appendChild(wrap); ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* buttons */
  $("addNoteBtn").disabled=inTrash;
  $("openNoteModalBtn").disabled=inTrash;
  $("starBtn").disabled=inTrash;
  $("starBtn").textContent=item.starred?"⭐ スター解除":"⭐ スター";
  $("softDeleteBtn").disabled=inTrash;
  $("softDeleteBtn").style.display=inTrash?"none":"inline-block";
  $("restoreItemBtn").style.display=inTrash?"inline-block":"none";
  $("restoreItemBtn").disabled=false;
  $("permDeleteBtn").style.display=inTrash?"inline-block":"none";
  $("permDeleteBtn").disabled=false;

  /* Notes */
  const q = (state.query||"").trim().toLowerCase();
  $("notesList").innerHTML=(item.notes||[]).map((n,i)=>`
    <div class="note">
      <div class="note-text">${highlightText(n.text,q)}</div>
      <div class="meta">
        <span class="muted">${formatDateTime(n.at)}</span>
        ${!inTrash?`<button class="ghost mini" style="font-size:11px;" onclick="deleteNote('${escapeHtml(item.id)}','${escapeHtml(n.id)}')">削除</button>`:""}
      </div>
    </div>`).join("");
}

function render(){ renderList(); renderDetail(); renderTagFilterBar(); updateSyncStatus(); }

/* ===== NOTE DELETE ===== */
function deleteNote(itemId, noteId){
  const item = findItem(itemId);
  if(!item) return;
  if(!confirm("このメモを削除しますか？")) return;
  item.notes = item.notes.filter(n=>n.id!==noteId);
  item.updatedAt=now();
  saveLocalOnly(); render();
}

/* ===== FORM ===== */
function loadItemToForm(item){
  if(!item) return;
  $("titleInput").value=item.title||"";
  $("tagsInput").value=(item.tags||[]).join(", ");
  $("summaryInput").value=item.summary||"";
  editUrlList=[...(item.urls||[])];
  editingId=item.id;
  renderUrlList();
}
function clearForm(){
  $("titleInput").value="";
  $("tagsInput").value="";
  $("summaryInput").value="";
  $("urlSingleInput").value="";
  editUrlList=[]; editingId=null;
  renderUrlList();
}
function renderUrlList(){
  $("urlList").innerHTML=editUrlList.map((u,i)=>`
    <div class="url-entry" data-idx="${i}">
      ${isValidUrl(u)?`<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" style="flex:1;font-size:12px;word-break:break-all;">${escapeHtml(u)}</a>`:`<span style="flex:1;font-size:12px;word-break:break-all;">${escapeHtml(u)}</span>`}
      <button class="ghost mini" style="font-size:11px;padding:2px 6px;" onclick="openUrlInTab(${i})">開く</button>
      <button class="ghost mini" style="font-size:11px;padding:2px 6px;" onclick="copyUrlEntry(${i})">コピー</button>
      <button class="danger mini" style="font-size:11px;padding:2px 6px;" onclick="removeUrlEntry(${i})">✕</button>
    </div>`).join("");
}
function addUrlEntry(){
  const v=($("urlSingleInput").value||"").trim();
  if(!v) return;
  // http(s) only check — warn but allow
  if(!/^https?:\/\//i.test(v)){
    if(!confirm("http(s)で始まらないURLです。追加しますか？")) return;
  }
  if(editUrlList.includes(v)){ toast("重複URLです","warn"); return; }
  if(editUrlList.length>=20){ toast("URLは最大20件です","warn"); return; }
  editUrlList.push(v);
  $("urlSingleInput").value="";
  renderUrlList();
}
function removeUrlEntry(i){ editUrlList.splice(i,1); renderUrlList(); }
function openUrlInTab(i){ if(isValidUrl(editUrlList[i])) window.open(editUrlList[i],"_blank","noopener"); }
function copyUrlEntry(i){ navigator.clipboard.writeText(editUrlList[i]).then(()=>toast("コピーしました","success")); }

/* ===== UPSERT ===== */
function upsertFromForm(){
  const title=($("titleInput").value||"").trim();
  if(!title){ toast("タイトルは必須です","error"); $("titleInput").focus(); return; }

  const payload={
    title,
    urls:[...editUrlList],
    tags:normalizeTags($("tagsInput").value||""),
    summary:($("summaryInput").value||"").replace(/\r\n/g,"\n")
  };

  if(editingId){
    const item=findItem(editingId);
    if(item){ Object.assign(item,payload); item.updatedAt=now(); }
    editingId=null;
    toast("更新しました","success");
  }else{
    const item={id:uid(),notes:[],createdAt:now(),updatedAt:now(),starred:false,...payload};
    state.items.unshift(item);
    state.selectedId=item.id;
    toast("追加しました","success");
  }
  saveLocalOnly(); render(); clearForm();
}

/* ===== ADD NOTE ===== */
function addNoteToSelected(){
  const item=findItem(state.selectedId);
  if(!item) return;
  const text=($("noteInput").value||"").replace(/\r\n/g,"\n").trim();
  if(!text){ toast("メモを入力してください","warn"); return; }
  item.notes.unshift({id:uid(),text,at:now()});
  item.updatedAt=now();
  $("noteInput").value="";
  saveLocalOnly(); render();
}

/* ===== STAR ===== */
function toggleStar(){
  const item=findItem(state.selectedId);
  if(!item) return;
  item.starred=!item.starred;
  item.updatedAt=now();
  saveLocalOnly(); render();
  toast(item.starred?"スターを付けました ⭐":"スターを外しました","success");
}

/* ===== CLEAR ALL ===== */
function clearAll(){
  if(state.items.length===0 && state.trash.length===0){ toast("データがありません","warn"); return; }
  // double confirm for all-delete protection
  if(!confirm(`全件削除します（Active: ${state.items.length}件、Trash: ${state.trash.length}件）。\nよろしいですか？`)) return;
  if(!confirm("本当に削除しますか？この操作は取り消せません。")) return;
  state.items=[]; state.trash=[]; state.selectedId=null; editingId=null;
  saveLocalOnly(); render(); toast("全削除しました","error");
}

/* ===== EXPORT ===== */
function exportJson(){
  const data={items:state.items,trash:state.trash,exportedAt:now()};
  download(JSON.stringify(data,null,2),"application/json",`learning-log-${isoDate()}.json`);
  toast("JSONエクスポート完了","success");
}
function exportCsv(){
  const rows=[["id","title","urls","tags","summary","createdAt","updatedAt"]];
  state.items.forEach(x=>rows.push([x.id,x.title,(x.urls||[]).join("|"),(x.tags||[]).join("|"),(x.summary||"").replace(/\n/g,"\\n"),formatDateTime(x.createdAt),formatDateTime(x.updatedAt)]));
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  download("\uFEFF"+csv,"text/csv;charset=utf-8",`learning-log-${isoDate()}.csv`);
  toast("CSVエクスポート完了","success");
}
function exportMarkdown(selOnly){
  const items = selOnly && state.selectedId ? [findItem(state.selectedId)].filter(Boolean) : state.items;
  const md=items.map(x=>`## ${x.title}\n\n**タグ:** ${(x.tags||[]).map(t=>`#${t}`).join(" ")||"なし"}\n\n**URL:**\n${(x.urls||[]).map(u=>`- ${u}`).join("\n")||"なし"}\n\n**要点:**\n${x.summary||"なし"}\n\n**追記メモ:**\n${(x.notes||[]).map(n=>`- ${n.text}`).join("\n")||"なし"}\n\n---`).join("\n\n");
  download(md,"text/markdown",`learning-log-${isoDate()}.md`);
  toast("Markdownエクスポート完了","success");
}
function exportHtml(){
  const items=state.items;
  const body=items.map(x=>`<h2>${escapeHtml(x.title)}</h2><p><b>タグ:</b> ${(x.tags||[]).map(t=>`#${escapeHtml(t)}`).join(" ")||"なし"}</p><p><b>URL:</b> ${(x.urls||[]).map(u=>`<a href="${escapeHtml(u)}">${escapeHtml(u)}</a>`).join("<br>")||"なし"}</p><p><b>要点:</b><br>${escapeHtml(x.summary||"なし").replace(/\n/g,"<br>")}</p><p><b>追記メモ:</b><br>${(x.notes||[]).map(n=>escapeHtml(n.text).replace(/\n/g,"<br>")).join("<hr>")||"なし"}</p><hr>`).join("");
  const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>学習記録</title><style>body{font-family:sans-serif;max-width:900px;margin:0 auto;padding:16px;}h2{color:#2244aa;}a{color:#4f7cff;}</style></head><body><h1>学習記録ログ</h1>${body}</body></html>`;
  const w=window.open("","_blank"); w.document.write(html); w.document.close(); w.print();
  toast("印刷プレビューを開きました","success");
}
function download(content,type,filename){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
function isoDate(){ return new Date().toISOString().slice(0,10); }

/* ===== IMPORT ===== */
function importJson(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const data=JSON.parse(reader.result);
      // support both old array format and new {items,trash} format
      const items=(Array.isArray(data)?data:(data.items||[])).map(normalizeItem);
      const trash=Array.isArray(data)?[]:(data.trash||[]).map(normalizeItem);
      state.items=items; state.trash=trash;
      state.selectedId=items[0]?.id??null;
      saveLocalOnly(); render();
      toast(`インポート完了（${items.length}件）`,"success");
    }catch(e){
      toast("インポート失敗（JSON形式を確認してください）","error");
    }
  };
  reader.readAsText(file);
}

/* ===== TAG SUGGEST ===== */
function renderTagSuggest(){
  const val=($("tagsInput").value||"");
  const parts=val.split(/[,、\s]+/);
  const cur=(parts[parts.length-1]||"").trim().toLowerCase();
  const box=$("tagSuggestBox");
  if(!cur){ box.style.display="none"; return; }
  const matches=allTags().filter(t=>t.toLowerCase().startsWith(cur)&&!parts.slice(0,-1).includes(t));
  if(!matches.length){ box.style.display="none"; return; }
  box.innerHTML=matches.slice(0,8).map(t=>`<div data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`).join("");
  box.style.display="block";
}
function pickTagSuggest(tag){
  const val=($("tagsInput").value||"");
  const parts=val.split(/[,、\s]+/);
  parts[parts.length-1]=tag;
  $("tagsInput").value=parts.join(", ")+", ";
  $("tagSuggestBox").style.display="none";
  $("tagsInput").focus();
}

/* ===== TEMPLATES ===== */
const TEMPLATES=[
  {label:"📋 基本まとめ",   text:"## 概要\n\n## 手順\n1. \n2. \n\n## ポイント\n- \n\n## 参考"},
  {label:"🐛 バグ/問題メモ",text:"## 問題\n\n## 原因\n\n## 解決策\n\n## 備考"},
  {label:"📚 読書メモ",     text:"## タイトル\n## 著者\n## 要約\n\n## 気になった点\n- \n\n## 行動に移すこと\n- "},
  {label:"🔬 調査メモ",     text:"## 調査目的\n\n## 調べたこと\n\n## 結論\n\n## 次のアクション"},
];
function buildTplHtml(targetId){
  return TEMPLATES.map(t=>`<button onclick="insertTemplate(${JSON.stringify(t.text)}, '${targetId}')">${escapeHtml(t.label)}</button>`).join("");
}
function insertTemplate(text, targetId){
  const el=$(targetId);
  const pos=el.selectionStart??el.value.length;
  el.value=el.value.slice(0,pos)+text+el.value.slice(pos);
  el.focus();
  $("summaryTplPicker").style.display="none";
  $("inlineTplPicker").style.display="none";
}

/* ===== SUMMARY MODAL ===== */
function openSummaryModal(){
  $("summaryModalText").value=$("summaryInput").value||"";
  $("summaryTplPicker").innerHTML=buildTplHtml("summaryModalText");
  $("summaryModal").style.display="flex";
  $("summaryModalText").focus();
}
function closeSummaryModal(){ $("summaryModal").style.display="none"; }
function saveSummaryFromModal(){ $("summaryInput").value=$("summaryModalText").value||""; closeSummaryModal(); }

/* ===== NOTE EXPAND MODAL ===== */
function openNoteModal(){
  $("notesModalText").value=$("noteInput").value||"";
  $("noteExpandModal").style.display="flex";
  $("notesModalText").focus();
}
function closeNoteModal(){ $("noteExpandModal").style.display="none"; }
function saveNoteFromModal(){ $("noteInput").value=$("notesModalText").value||""; closeNoteModal(); }

/* ===== COMMAND PALETTE ===== */
const COMMANDS=[
  { label:"新規記録フォームへ",       key:"Ctrl+K", action:()=>{ closeCmdPalette(); $("titleInput").focus(); } },
  { label:"追加/更新 (Ctrl+Enter)",   key:"",       action:()=>{ closeCmdPalette(); upsertFromForm(); } },
  { label:"編集解除",                  key:"Esc",    action:()=>{ closeCmdPalette(); clearForm(); } },
  { label:"要点を拡大編集",            key:"",       action:()=>{ closeCmdPalette(); openSummaryModal(); } },
  { label:"エクスポート画面を開く",    key:"",       action:()=>{ closeCmdPalette(); $("exportModal").style.display="flex"; } },
  { label:"同期ログを開く",            key:"",       action:()=>{ closeCmdPalette(); renderSyncLog(); $("syncLogModal").style.display="flex"; } },
  { label:"クラウド同期",              key:"",       action:()=>{ closeCmdPalette(); $("syncBtn").click(); } },
  { label:"公開 (publicLogs へ書き込み)", key:"",    action:()=>{ closeCmdPalette(); $("publishBtn").click(); } },
  { label:"Active フィルタ",           key:"",       action:()=>{ closeCmdPalette(); setFilter("active"); } },
  { label:"Star フィルタ",             key:"",       action:()=>{ closeCmdPalette(); setFilter("star"); } },
  { label:"Trash フィルタ",            key:"",       action:()=>{ closeCmdPalette(); setFilter("trash"); } },
  { label:"重複 フィルタ",             key:"",       action:()=>{ closeCmdPalette(); setFilter("dup"); } },
  { label:"スター切替（選択中）",      key:"",       action:()=>{ closeCmdPalette(); toggleStar(); } },
  { label:"ゴミ箱へ移動（選択中）",   key:"",       action:()=>{ closeCmdPalette(); if(state.selectedId) softDelete(state.selectedId); } },
  { label:"元に戻す（Undo）",          key:"",       action:doUndo },
  { label:"全削除",                    key:"",       action:()=>{ closeCmdPalette(); clearAll(); } },
];
let cmdFiltered=[];
function openCmdPalette(){
  $("cmdPalette").style.display="flex";
  $("cmdInput").value=""; cmdActiveIdx=-1;
  renderCmdResults("");
  $("cmdInput").focus();
}
function closeCmdPalette(){ $("cmdPalette").style.display="none"; }
function renderCmdResults(q){
  const lq=q.trim().toLowerCase();
  cmdFiltered=lq?COMMANDS.filter(c=>c.label.toLowerCase().includes(lq)):COMMANDS;
  $("cmdResults").innerHTML=cmdFiltered.map((c,i)=>`
    <div class="cmd-item ${i===cmdActiveIdx?"cmd-active":""}" data-idx="${i}">
      <span>${escapeHtml(c.label)}</span>
      ${c.key?`<span class="cmd-key">${escapeHtml(c.key)}</span>`:""}
    </div>`).join("");
}

/* ===== FILTER ===== */
function setFilter(f){
  state.filter=f;
  document.querySelectorAll(".filter-btn").forEach(b=>b.classList.toggle("on",b.dataset.filter===f));
  render();
}

/* ===== KEYBOARD SHORTCUTS ===== */
document.addEventListener("keydown",(e)=>{
  /* Ctrl+Shift+P: command palette */
  if(e.ctrlKey && e.shiftKey && e.key==="P"){ e.preventDefault(); openCmdPalette(); return; }
  /* Ctrl+K: focus search */
  if(e.ctrlKey && !e.shiftKey && e.key==="k"){ e.preventDefault(); $("searchInput").focus(); return; }
  /* Ctrl+Enter: add/update */
  if(e.ctrlKey && e.key==="Enter"){ e.preventDefault(); upsertFromForm(); return; }
  /* Esc: close modals / clear form */
  if(e.key==="Escape"){
    if($("cmdPalette").style.display==="flex"){ closeCmdPalette(); return; }
    if($("summaryModal").style.display==="flex"){ closeSummaryModal(); return; }
    if($("noteExpandModal").style.display==="flex"){ closeNoteModal(); return; }
    if($("exportModal").style.display==="flex"){ $("exportModal").style.display="none"; return; }
    if($("syncLogModal").style.display==="flex"){ $("syncLogModal").style.display="none"; return; }
    clearForm(); return;
  }
  /* cmd palette arrow keys */
  if($("cmdPalette").style.display==="flex"){
    if(e.key==="ArrowDown"){ e.preventDefault(); cmdActiveIdx=Math.min(cmdActiveIdx+1,cmdFiltered.length-1); renderCmdResults($("cmdInput").value); }
    if(e.key==="ArrowUp"){ e.preventDefault(); cmdActiveIdx=Math.max(cmdActiveIdx-1,0); renderCmdResults($("cmdInput").value); }
    if(e.key==="Enter" && cmdActiveIdx>=0){ e.preventDefault(); cmdFiltered[cmdActiveIdx]?.action(); }
  }
});

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded",()=>{
  state.items = loadItems();
  state.trash  = loadTrash();
  state.selectedId = state.items[0]?.id ?? null;
  if(localStorage.getItem(DIRTY_KEY)===null) localStorage.setItem(DIRTY_KEY,"true");
  updateSyncStatus();

  /* template pickers */
  $("inlineTplPicker").innerHTML=buildTplHtml("summaryInput");
  $("summaryTplPicker").innerHTML=buildTplHtml("summaryModalText");

  render();

  /* form */
  $("addBtn").addEventListener("click",upsertFromForm);
  $("cancelEditBtn").addEventListener("click",()=>clearForm());
  $("urlAddBtn").addEventListener("click",addUrlEntry);
  $("urlSingleInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); addUrlEntry(); } });

  /* item list click */
  $("itemsList").addEventListener("click",(e)=>{
    const row=e.target.closest(".item");
    if(!row) return;
    state.selectedId=row.dataset.id;
    const item=findAny(state.selectedId);
    if(item&&!item.deletedAt) loadItemToForm(item);
    render();
  });

  /* detail buttons */
  $("softDeleteBtn").addEventListener("click",()=>{ if(state.selectedId) softDelete(state.selectedId); });
  $("restoreItemBtn").addEventListener("click",()=>{ if(state.selectedId) restoreFromTrash(state.selectedId); });
  $("permDeleteBtn").addEventListener("click",()=>{ if(state.selectedId) permDelete(state.selectedId); });
  $("starBtn").addEventListener("click",toggleStar);
  $("addNoteBtn").addEventListener("click",addNoteToSelected);
  $("openNoteModalBtn").addEventListener("click",openNoteModal);

  /* search */
  $("searchInput").addEventListener("input",(e)=>{ state.query=e.target.value??""; renderList(); renderDetail(); });

  /* filter bar */
  document.querySelectorAll(".filter-btn").forEach(b=>{
    b.addEventListener("click",()=>setFilter(b.dataset.filter));
  });

  /* tag filter */
  $("tagFilterBar").addEventListener("click",(e)=>{
    const el=e.target.closest("[data-tag]");
    if(!el) return;
    const tag=el.dataset.tag;
    state.tagFilter=state.tagFilter===tag?null:tag;
    render();
  });

  /* sort */
  $("sortSel").addEventListener("change",(e)=>{ state.sortBy=e.target.value; renderList(); });

  /* tag suggest */
  $("tagsInput").addEventListener("input",renderTagSuggest);
  $("tagsInput").addEventListener("blur",()=>setTimeout(()=>{ $("tagSuggestBox").style.display="none"; },200));
  $("tagSuggestBox").addEventListener("click",(e)=>{
    const el=e.target.closest("[data-tag]");
    if(el) pickTagSuggest(el.dataset.tag);
  });

  /* summary modal */
  $("openSummaryModalBtn").addEventListener("click",openSummaryModal);
  $("summaryModalCancel").addEventListener("click",closeSummaryModal);
  $("summaryModalSave").addEventListener("click",saveSummaryFromModal);
  $("summaryModal").addEventListener("click",(e)=>{ if(e.target.id==="summaryModal") closeSummaryModal(); });
  $("summaryModalText").addEventListener("keydown",(e)=>{ if(e.ctrlKey&&e.key==="Enter"){ e.preventDefault(); saveSummaryFromModal(); } });
  $("summaryTplBtn").addEventListener("click",()=>{
    const p=$("summaryTplPicker");
    p.style.display=p.style.display==="none"?"block":"none";
  });
  $("summaryTplInlineBtn").addEventListener("click",()=>{
    const p=$("inlineTplPicker");
    p.style.display=p.style.display==="none"?"block":"none";
  });

  /* note modal */
  $("noteModalCancel").addEventListener("click",closeNoteModal);
  $("noteModalSave").addEventListener("click",saveNoteFromModal);
  $("noteExpandModal").addEventListener("click",(e)=>{ if(e.target.id==="noteExpandModal") closeNoteModal(); });

  /* export modal */
  $("exportBtnOpen").addEventListener("click",()=>{ $("exportModal").style.display="flex"; });
  $("exportModalClose").addEventListener("click",()=>{ $("exportModal").style.display="none"; });
  $("expJson").addEventListener("click",exportJson);
  $("expCsv").addEventListener("click",exportCsv);
  $("expMd").addEventListener("click",()=>exportMarkdown($("expSelOnly").checked));
  $("expHtml").addEventListener("click",exportHtml);

  /* import */
  $("importBtn").addEventListener("click",()=>$("importFileInput").click());
  $("importFileInput").addEventListener("change",(e)=>{ const f=e.target.files?.[0]; if(f){ importJson(f); e.target.value=""; } });

  /* sync log */
  $("syncLogBtn").addEventListener("click",()=>{ renderSyncLog(); $("syncLogModal").style.display="flex"; });
  $("syncLogClose").addEventListener("click",()=>{ $("syncLogModal").style.display="none"; });
  $("syncLogClear").addEventListener("click",()=>{ localStorage.removeItem(SYNCLOG_KEY); renderSyncLog(); toast("ログクリア","success"); });

  /* undo bar */
  $("undoBtn").addEventListener("click",doUndo);
  $("undoDismiss").addEventListener("click",hideUndoBar);

  /* clear all */
  $("clearBtn").addEventListener("click",clearAll);

  /* cmd palette */
  $("cmdPalette").addEventListener("click",(e)=>{ if(e.target.id==="cmdPalette") closeCmdPalette(); });
  $("cmdInput").addEventListener("input",(e)=>{ cmdActiveIdx=-1; renderCmdResults(e.target.value); });
  $("cmdResults").addEventListener("click",(e)=>{ const el=e.target.closest(".cmd-item"); if(el) cmdFiltered[+el.dataset.idx]?.action(); });
});
