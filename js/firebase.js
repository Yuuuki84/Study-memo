import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
  import {
    getAuth, onAuthStateChanged, signInWithPopup, signOut,
    GoogleAuthProvider, setPersistence, browserLocalPersistence
  } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
  import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyC-rZ8Hrh67Wzo62g6Afu_CVUbC7yWLrqE",
    authDomain: "project-memo-5465f.firebaseapp.com",
    projectId: "project-memo-5465f"
  };

  const app  = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db   = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt:"select_account" });

  let cloudRef = null;
  const publicRef = doc(db, "publicLogs", "default"); // ゲスト公開データ


  $("loginBtn").addEventListener("click", ()=>{ $("loginOverlay").style.display="flex"; });
  $("googleLoginBtn").addEventListener("click", async()=>{
    try{ await signInWithPopup(auth, provider); }
    catch(e){ toast(`ログイン失敗: ${e?.code??e?.message}`,"error"); }
  });
  $("loginCancelBtn").addEventListener("click",()=>{ $("loginOverlay").style.display="none"; });
  $("logoutBtn").addEventListener("click", async()=>{ await signOut(auth); toast("ログアウトしました"); });

  async function syncToCloud(){
    if(!cloudRef){ toast("ログインしてください","warn"); return; }
    if(!isDirty()){ toast("同期する変更はありません","warn"); return; }
    $("syncBtn").disabled=true;
    try{
      autoBackup();
      const payload={ items:state.items, trash:state.trash, updatedAt:Date.now() };
      await setDoc(cloudRef, payload);
      localStorage.setItem(DIRTY_KEY,"false");
      localStorage.setItem(LASTSYNC_KEY, String(Date.now()));
      pushSyncLog(`クラウド同期完了 (${state.items.length}件)`);
      toast("クラウド同期完了","success");
      updateSyncStatus();
    }catch(e){
      pushSyncLog(`同期失敗: ${e?.code??e?.message}`);
      toast(`同期失敗: ${e?.code??e?.message}`,"error");
    }finally{ $("syncBtn").disabled=false; updateSyncStatus(); }
  }

  async function restoreFromCloud(){
    if(!cloudRef){ toast("ログインしてください","warn"); return; }
    if(!confirm("クラウドの内容でローカルを上書きします。よろしいですか？")) return;
    $("restoreBtn").disabled=true;
    try{
      autoBackup();
      const snap=await getDoc(cloudRef);
      if(!snap.exists()){ toast("クラウドにデータがありません","warn"); return; }
      const d=snap.data();
      const items=(d.items||[]).map(x=>{ if(!Array.isArray(x.urls)){ const u=(x.url||"").trim(); x.urls=u?[u]:[]; delete x.url; } if(x.starred===undefined) x.starred=false; return x; });
      const trash=(d.trash||[]).map(x=>{ if(!Array.isArray(x.urls)){ const u=(x.url||"").trim(); x.urls=u?[u]:[]; delete x.url; } if(x.starred===undefined) x.starred=false; return x; });
      localStorage.setItem(STORAGE_KEY,JSON.stringify(items));
      localStorage.setItem(TRASH_KEY,  JSON.stringify(trash));
      localStorage.setItem(DIRTY_KEY,"false");
      localStorage.setItem(LASTSYNC_KEY, String(Date.now()));
      state.items=items; state.trash=trash;
      state.selectedId=items[0]?.id??null;
      pushSyncLog(`クラウドから復元 (${items.length}件)`);
      render();
      toast("クラウドから復元しました","success");
    }catch(e){
      pushSyncLog(`復元失敗: ${e?.code??e?.message}`);
      toast(`復元失敗: ${e?.code??e?.message}`,"error");
    }finally{ $("restoreBtn").disabled=false; updateSyncStatus(); }
  }

  $("syncBtn").addEventListener("click",syncToCloud);
  $("restoreBtn").addEventListener("click",restoreFromCloud);

  /* ===== PUBLISH TO PUBLIC ===== */
  async function publishToPublic(){
    if(!cloudRef){ toast("ログインしてください","warn"); return; }
    if(state.items.length===0){ toast("公開するメモがありません","warn"); return; }
    if(!confirm(`現在のメモ ${state.items.length} 件を公開します。よろしいですか？`)) return;

    const user = auth.currentUser;
    const userPublicRef = doc(db, "publicLogs", user.uid);
    $("publishBtn").disabled = true;
    try{
      // 既存ドキュメントがあれば publishedAt を引き継ぐ
      const existing = await getDoc(userPublicRef);
      const publishedAt = existing.exists()
        ? existing.data().publishedAt
        : serverTimestamp();

      const payload = {
        ownerUid:    user.uid,
        items:       state.items,
        publishedAt: publishedAt,
        updatedAt:   serverTimestamp(),
        visibility:  "public"
      };

      await setDoc(userPublicRef, payload);
      pushSyncLog(`公開完了 (${state.items.length}件)`);
      toast(`公開しました！(${state.items.length}件)`, "success");
    }catch(e){
      pushSyncLog(`公開失敗: ${e?.code??e?.message}`);
      toast(`公開失敗: ${e?.code??e?.message}`, "error");
    }finally{
      $("publishBtn").disabled = false;
    }
  }

  $("publishBtn").addEventListener("click", publishToPublic);

  /* ===== GUEST PUBLIC VIEW ===== */
  let guestQuery = "";

  function escHtml(s){
    return String(s||"")
      .replaceAll("&","&amp;").replaceAll("<","&lt;")
      .replaceAll(">","&gt;").replaceAll('"',"&quot;");
  }

  function renderGuestPublicList(docs){
    const q = guestQuery.trim().toLowerCase();
    const container = $("guestPublicList");

    // 全 items を展開してフィルタ
    let allItems = [];
    docs.forEach(d => {
      const data = d.data();
      (data.items || []).forEach(item => {
        allItems.push({ ...item, _ownerUid: data.ownerUid });
      });
    });

    if(q){
      allItems = allItems.filter(item => {
        const hay = [
          item.title,
          (item.tags||[]).join(" "),
          item.summary||"",
          (item.urls||[]).join(" ")
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    if(allItems.length === 0){
      container.innerHTML = `<p class="muted">${q ? "該当するメモがありません" : "公開されているメモはありません"}</p>`;
      return;
    }

    container.innerHTML = allItems.map(item => `
      <div class="card" style="margin-bottom:0;">
        <div class="row" style="justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:6px;">
          <h3 style="margin:0; font-size:15px; word-break:break-all; flex:1;">${escHtml(item.title)}</h3>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            ${(item.tags||[]).map(t=>`<span class="tag">#${escHtml(t)}</span>`).join("")}
          </div>
        </div>
        ${item.summary ? `<div class="muted" style="margin-top:8px; white-space:pre-wrap; font-size:13px;">${escHtml(item.summary)}</div>` : ""}
        ${(item.urls||[]).length ? `
          <div style="margin-top:8px;">
            ${(item.urls).map(u=>`<div style="margin-bottom:4px;"><a href="${escHtml(u)}" target="_blank" rel="noopener noreferrer" style="font-size:12px;">${escHtml(u)}</a></div>`).join("")}
          </div>` : ""}
        <div class="muted" style="margin-top:8px; font-size:11px;">更新: ${item.updatedAt ? new Date(item.updatedAt).toLocaleString("ja-JP") : "—"}</div>
      </div>
    `).join("");
  }

  let cachedPublicDocs = [];

  async function loadGuestPublicView(){
    $("guestPublicList").innerHTML = `<p class="muted">読み込み中...</p>`;
    try{
      const snap = await getDocs(collection(db, "publicLogs"));
      cachedPublicDocs = snap.docs;
      renderGuestPublicList(cachedPublicDocs);
    }catch(e){
      $("guestPublicList").innerHTML = `<p class="muted" style="color:#ff5b5b;">読み込みに失敗しました: ${escHtml(e?.code ?? e?.message)}</p>`;
    }
  }

  $("guestSearchInput").addEventListener("input", (e)=>{
    guestQuery = e.target.value ?? "";
    renderGuestPublicList(cachedPublicDocs);
  });

  $("guestRefreshBtn").addEventListener("click", loadGuestPublicView);

  onAuthStateChanged(auth, async(user)=>{
    if(!user){
      $("userStatus").textContent="ゲスト（公開データ閲覧）";
      $("loginBtn").style.display="inline-block";
      $("logoutBtn").style.display="none";
      $("loginOverlay").style.display="none";
      cloudRef=null;
      $("syncBtn").disabled=true;
      $("restoreBtn").disabled=true;
      $("publishBtn").disabled=true;
      // ゲストビューに切り替え
      $("guestView").style.display = "block";
      $("appRoot").style.display   = "none";
      loadGuestPublicView();
      return;
    }
    $("loginBtn").style.display="none";
      $("userStatus").textContent=`ログイン中: ${user.email??user.uid}`;
    $("logoutBtn").style.display="inline-block";
    $("loginOverlay").style.display="none";
    // ログインビューに切り替え
    $("guestView").style.display = "none";
    $("appRoot").style.display   = "";
    cloudRef=doc(db,"learnLogs",user.uid);

    // ローカルが空ならクラウドから自動復元
    try{
      const local=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
      if(!Array.isArray(local)||local.length===0){
        const snap=await getDoc(cloudRef);
        if(snap.exists()){
          const d=snap.data();
          const items=(d.items||[]).map(x=>{ if(!Array.isArray(x.urls)){const u=(x.url||"").trim();x.urls=u?[u]:[]; delete x.url;} if(x.starred===undefined) x.starred=false; return x;});
          const trash=(d.trash||[]).map(x=>{ if(!Array.isArray(x.urls)){const u=(x.url||"").trim();x.urls=u?[u]:[]; delete x.url;} if(x.starred===undefined) x.starred=false; return x;});
          localStorage.setItem(STORAGE_KEY,JSON.stringify(items));
          localStorage.setItem(TRASH_KEY,  JSON.stringify(trash));
          localStorage.setItem(DIRTY_KEY,"false");
          localStorage.setItem(LASTSYNC_KEY,String(Date.now()));
          state.items=items; state.trash=trash;
          state.selectedId=items[0]?.id??null;
          render();
          pushSyncLog(`ログイン時自動復元 (${items.length}件)`);
        }
      }
    }catch(e){ console.error("Cloud check failed:",e); }

    $("syncBtn").disabled=false;
    $("restoreBtn").disabled=false;
    $("publishBtn").disabled=false;
    updateSyncStatus();
  });
