/* =========================================================
   CONFIGURACION GENERAL
   ========================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy, getDoc, setDoc, increment, where, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwRb3jxSqHrQHzXsPaGrCNjnMrwnjCqCI",
  authDomain: "tareas-1da6b.firebaseapp.com",
  projectId: "tareas-1da6b",
  storageBucket: "tareas-1da6b.firebasestorage.app",
  messagingSenderId: "352867129861",
  appId: "1:352867129861:web:36ec1052ff04ff4ff25a6c"
};

const _G = ["gsk_PGBEBbnUWexSHH4S","nwe2WGdyb3FYVpMD7xll7eH9ENZOZQgbP3p8"].join("");
const ADMIN_PIN = "marlon@";
const CARD_COLORS = [
  { value: "#d8cff0", label: "Morado" }, { value: "#c8e6c9", label: "Verde" },
  { value: "#bbdefb", label: "Azul" }, { value: "#ffecb3", label: "Amarillo" },
  { value: "#ffcdd2", label: "Rojo" }, { value: "#f8bbd0", label: "Rosa" },
  { value: "#b2ebf2", label: "Cyan" }, { value: "#ffe0b2", label: "Naranja" },
  { value: "#d7ccc8", label: "Cafe" }
];

const fireApp = initializeApp(firebaseConfig);
const db = getFirestore(fireApp);

/* Estado global */
let tasks = [];
let adminUnlocked = false;
let rankingOpen = false;
let auditOpen = false;
let showArchive = false;
let rankingScores = [];
let rankingEvents = [];
let rankingActionsOpenFor = "";
let actionModalResolver = null;
let editingId = null;
let addOpen = false;
let loginOpen = false;
let aiOpen = false;
let aiTaskData = null;
let dotsOpen = false;
let selectedColor = CARD_COLORS[0].value;
let editSelectedColor = CARD_COLORS[0].value;
let currentUser = localStorage.getItem("userName") || "";
const NEAR_DUE_DAYS_LIMIT = 1;
const REMINDER_STORAGE_KEY = "nearDueReminderMeta";
const NEW_TASK_WINDOW_MS = 12 * 60 * 60 * 1000;
const SEEN_TASKS_STORAGE_KEY = "seenNewTasksByUser";
let reminderToastTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  if (!currentUser) {
    document.getElementById("loginModal").style.display = "flex";
    if (window.lucide) window.lucide.createIcons();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});

/* =========================================================
   FUNCIONES UTILITARIAS
   ========================================================= */
function getDaysLeft(due) {
  const now = new Date();
  const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  const today = new Date(todayStr + 'T00:00:00');
  const d = new Date(due + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}

function urgency(days) {
  if (days < 0)   return { label:"Vencida",    color:"#ff3b3b", bg:"#ffe5e5" };
  if (days === 0) return { label:"Hoy",        color:"#ff8c00", bg:"#fff3e0" };
  if (days <= 2)  return { label:"Urgente",    color:"#e07b00", bg:"#fff3e0" };
  if (days <= 5)  return { label:"Pronto",     color:"#2e7d32", bg:"#e8f5e9" };
  return               { label:"Con tiempo", color:"#7c4dcc", bg:"#ede7f6" };
}

function fmtDate(str) {
  if (!str) return "-";
  const parts = str.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

const esc = (str) => String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const escJsSingle = (str) => String(str || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function upsertRankingScore(name, delta) {
  const id = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const ref = doc(db, "ranking_scores", id);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { points: increment(delta), updatedAt: new Date().toISOString() });
  } else {
    await setDoc(ref, { name, points: Math.max(0, delta), firstConfirmedAt: new Date().toISOString() });
  }
}

async function addRankingEvent(name, delta, source, note, taskId = "ANTIGUO") {
  await addDoc(collection(db, "ranking_events"), { name, delta, source, note, taskId, createdAt: serverTimestamp(), createdBy: currentUser });
}

function getTaskCreatedAtMs(task) {
  if (!task || !task.createdAt) return 0;
  if (typeof task.createdAt.toMillis === "function") return task.createdAt.toMillis();
  if (task.createdAt.seconds) return task.createdAt.seconds * 1000;
  return new Date(task.createdAt).getTime() || 0;
}

function getRelativeCreatedText(task) {
  const createdAtMs = getTaskCreatedAtMs(task);
  if (!createdAtMs) return "";
  const diffMin = Math.max(1, Math.round((Date.now() - createdAtMs) / 60000));
  if (diffMin < 60) return "Agregada hace " + diffMin + " min";
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return "Agregada hace " + diffH + " h";
  const diffD = Math.round(diffH / 24);
  return "Agregada hace " + diffD + " d";
}

function showAppMessage(opts) {
  const toast = document.getElementById("reminderToast");
  const body = document.getElementById("reminderToastBody");
  const meta = document.getElementById("reminderToastMeta");
  const title = document.querySelector("#reminderToast .reminder-toast-title");
  if (!toast || !body || !meta || !title) return;
  toast.classList.remove("info", "success", "error");
  toast.classList.add(opts.type || "info");
  title.textContent = opts.title || "Mensaje";
  body.textContent = opts.body || "";
  meta.textContent = opts.meta || "";
  toast.classList.add("show");
  if (reminderToastTimer) clearTimeout(reminderToastTimer);
  reminderToastTimer = setTimeout(() => toast.classList.remove("show"), opts.duration || 4200);
}

/* =========================================================
   LOGICA DE INTERFAZ (UI)
   ========================================================= */
function render() {
  const modal = document.getElementById("loginModal");
  if (!currentUser) { if (modal) modal.style.display = "flex"; return; }
  if (modal) modal.style.display = "none";
  
  const todayStr = new Date().toISOString().split("T")[0];
  const activeTasks = tasks.filter(t => t.due >= todayStr).sort((a, b) => getDaysLeft(a.due) - getDaysLeft(b.due));
  const archivedTasks = tasks.filter(t => t.due < todayStr).sort((a, b) => getDaysLeft(b.due) - getDaysLeft(a.due));

  const urgent = activeTasks.filter(t => getDaysLeft(t.due) <= 2 && getDaysLeft(t.due) >= 0).length;
  const overdue = activeTasks.filter(t => getDaysLeft(t.due) < 0).length;

  function buildTaskCards(list, isArchive = false) {
    let html = "";
    list.forEach(function(t, i) {
      if (editingId === t.id) {
        editSelectedColor = t.cardColor || CARD_COLORS[0].value;
        html += `<div class="edit-card">
          <div class="edit-label">EDITANDO TAREA</div>
          <div class="form-grid">
            <div class="field"><label>Nombre</label><input id="eTitle" class="inp" value="${esc(t.title)}"></div>
            <div class="field"><label>Descripcion</label>${toolbarHTML("eDesc")}<div id="eDesc" class="rich-area" contenteditable="true">${t.desc||""}</div></div>
            <div class="form-row">
              <div class="field"><label>Fecha dejada</label><input id="eAssigned" type="date" class="inp" value="${t.assigned||""}"></div>
              <div class="field"><label>Fecha entrega</label><input id="eDue" type="date" class="inp" value="${t.due||""}"></div>
            </div>
            <div class="field"><label>Color de la tarjeta</label>${colorPickerHTML(editSelectedColor, "edit")}</div>
            <div class="btn-row">
              <button class="btn btn-warn" style="flex:1" onclick="doSaveEdit('${t.id}')"><i data-lucide="save"></i> Guardar</button>
              <button class="btn btn-secondary" onclick="doCancelEdit()">Cancelar</button>
            </div>
          </div>
        </div>`;
        return;
      }
      const days = getDaysLeft(t.due);
      const u = urgency(days);
      const daysText = days < 0 ? "Vencida" : days === 0 ? "Hoy" : days + "d restantes";
      const borderColor = t.cardColor || "#d8cff0";
      const isSeen = (JSON.parse(localStorage.getItem(SEEN_TASKS_STORAGE_KEY)||"{}")[currentUser.toLowerCase()]||[]).includes(t.id);
      const isRecent = !isArchive && (Date.now() - (t.createdAt?.seconds*1000 || 0) < 43200000) && !isSeen;
      const newTagHtml = isRecent ? '<span class="recent-chip">● Reciente</span>' : "";
      const recentText = isRecent ? `<span class="recent-hint">${getRelativeCreatedText(t)}</span><button class="recent-btn" onclick="event.stopPropagation();doMarkTaskSeen('${t.id}')">Entendido</button>` : "";
      
      html += `<div class="task-card ${isRecent ? "is-recent" : ""} ${isArchive ? "is-archived" : ""}" style="background:${borderColor};border-color:${borderColor}${isArchive ? ';opacity:0.8' : ''}">
        <div class="card-actions">
          ${adminUnlocked ? `<button class="icon-btn edit" onclick="doStartEdit('${t.id}')"><i data-lucide="edit-2"></i></button><button class="icon-btn del" onclick="doDelete('${t.id}')"><i data-lucide="trash-2"></i></button>` : ''}
          <button class="icon-btn users" onclick="doShowDoneBy('${t.id}')" style="font-size:10px;"><i data-lucide="users" style="width:12px;height:12px;"></i> ${(t.doneBy||[]).length}</button>
        </div>
        <div class="card-num">
          ${isArchive ? 'ARCHIVADA ' : 'TAREA #'} ${String(i+1).padStart(2,"0")}
          <div style="display:flex;align-items:center;gap:6px;">
            ${newTagHtml}
            <span class="badge" style="background:${u.bg};color:${u.color};">${u.label}</span>
            <span onclick="doToggleDone('${t.id}')" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;border:2px solid ${(t.doneBy||[]).includes(currentUser) ? '#7c3aed' : '#c4b5d8'};background:${(t.doneBy||[]).includes(currentUser) ? '#7c3aed' : 'transparent'};color:white;font-size:13px;line-height:1;">${(t.doneBy||[]).includes(currentUser) ? '✓' : ''}</span>
          </div>
        </div>
        <div class="card-title" style="${(t.doneBy||[]).includes(currentUser) ? 'text-decoration:line-through;opacity:0.5' : ''}">${esc(t.title)}</div>
        ${t.desc ? `<div class="card-desc">${t.desc}</div>` : ''}
        <div class="card-meta">
          ${recentText}
          ${t.assigned ? `<span><i data-lucide="calendar"></i> ${fmtDate(t.assigned)}</span>` : ''}
          <span><i data-lucide="clock"></i> ${fmtDate(t.due)}</span>
          <span class="days-left" style="color:${u.color}">${daysText}</span>
        </div>
      </div>`;
    });
    return html;
  }

  let taskHTML = buildTaskCards(activeTasks);
  let archiveToggleHTML = "";
  if (archivedTasks.length > 0) {
    archiveToggleHTML = `<button class="admin-toggle" onclick="doToggleArchive()" style="margin-top:20px;text-align:center;"><i data-lucide="history"></i> ${showArchive ? "Ocultar historial" : "Ver historial (" + archivedTasks.length + ")"}</button>`;
    if (showArchive) taskHTML += `<div style="margin-top:24px;border-top:2px dashed var(--border);padding-top:20px;"><div class="panel-label" style="text-align:center;margin-bottom:20px;">TAREAS PASADAS</div>${buildTaskCards(archivedTasks, true)}</div>`;
  }

  let adminHTML = adminUnlocked ? 
    `<button class="admin-toggle" onclick="doOpenAudit()"><i data-lucide="scroll-text"></i> Registro de Tareas</button>
     <button class="admin-toggle" onclick="doToggleAi()"><i data-lucide="sparkles"></i> Agregar con IA</button>
     <div class="panel ${aiOpen?"open":""}" id="aiPanel">
       <div class="form-grid">
         <textarea id="aiInput" class="inp" rows="3" placeholder="Describe la tarea..."></textarea>
         <div id="aiResultBox" style="display:none">
           <div class="ai-preview" id="aiPreview"></div>
           <div class="btn-row"><button class="btn btn-primary" onclick="doConfirmAi()"><i data-lucide="check"></i> Guardar</button><button class="btn btn-secondary" onclick="doResetAi()">Editar</button></div>
         </div>
         <div id="aiLoadBox" style="display:none;text-align:center;"><div class="spinner"></div></div>
         <div class="btn-row" id="aiSubmitRow"><button class="btn btn-primary" onclick="doSendAi()"><i data-lucide="wand-2"></i> Interpretar</button><button class="btn btn-secondary" onclick="doToggleAi()">Cancelar</button></div>
       </div>
     </div>
     <button class="admin-toggle" onclick="doToggleAdd()"><i data-lucide="plus-circle"></i> Agregar manualmente</button>
     <div class="panel ${addOpen?"open":""}" id="addPanel">
       <div class="form-grid">
         <input id="nTitle" class="inp" placeholder="Nombre">
         ${toolbarHTML("nDesc")}<div id="nDesc" class="rich-area" contenteditable="true"></div>
         <div class="form-row"><input id="nAssigned" type="date" class="inp" value="${todayStr}"><input id="nDue" type="date" class="inp"></div>
         ${colorPickerHTML(selectedColor, "add")}
         <div class="btn-row"><button class="btn btn-primary" onclick="doAddTask()"><i data-lucide="save"></i> Guardar</button><button class="btn btn-secondary" onclick="doToggleAdd()">Cancelar</button></div>
       </div>
     </div>
     <button class="btn btn-secondary btn-full" style="margin-top:10px" onclick="doLock()"><i data-lucide="lock"></i> Cerrar admin</button>
     
     <div class="danger-zone">
       <button class="admin-toggle" onclick="doClearOldHistory()"><i data-lucide="eraser"></i> Limpiar Historial Antiguo</button>
     </div>` :
    `<button class="admin-toggle" onclick="doToggleLogin()"><i data-lucide="user-cog"></i> Acceso administrador</button>
     <div class="panel ${loginOpen?"open":""}" id="loginPanel">
       <div class="pin-wrap">
         <input type="password" id="pinInput" class="inp" placeholder="Contrasena" onkeydown="if(event.key==='Enter')doLogin()">
         <button class="btn btn-primary" onclick="doLogin()">Entrar</button>
       </div>
       <div id="pinErr" style="display:none;color:var(--danger)">Incorrecta</div>
     </div>`;

  document.getElementById("app").innerHTML = `
    <div class="wrap">
      <div class="header">
        <div class="header-top">
          <span class="label">Grupo Escolar</span>
          <div class="dots-wrap">
            <span class="live">● En vivo</span>
            <button onclick="doOpenRanking()" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px 8px;"><i data-lucide="trophy" class="ranking-btn-icon"></i></button>
            <button class="dots-btn" id="dotsBtn" onclick="doToggleDots()"><i data-lucide="more-vertical"></i></button>
            <div class="dots-menu" id="dotsMenu">
              <div class="dots-item" onclick="doEnableReminders()"><i data-lucide="bell" style="width:14px;height:14px;vertical-align:middle;margin-right:8px;"></i> Activar recordatorios</div>
              <div class="dots-item" id="copyItem" onclick="doCopy()"><i data-lucide="copy" style="width:14px;height:14px;vertical-align:middle;margin-right:8px;"></i> Copiar WhatsApp</div>
              <div class="dots-item" onclick="doLogout()"><i data-lucide="log-out" style="width:14px;height:14px;vertical-align:middle;margin-right:8px;"></i> Cerrar sesión</div>
            </div>
          </div>
        </div>
        <h1>Tareas<br>de la semana</h1>
        <p class="subtitle">Ordenadas por margen de tiempo</p>
      </div>
      <div class="stats">
        <div class="stat"><i data-lucide="layers"></i> <strong>${activeTasks.length}</strong> activa${activeTasks.length!==1?'s':''}</div>
        ${urgent ? `<div class="stat"><i data-lucide="alert-circle" style="color:var(--warn)"></i> <strong style="color:var(--warn)">${urgent}</strong> urgente</div>` : ''}
        ${overdue ? `<div class="stat"><i data-lucide="calendar-x" style="color:var(--danger)"></i> <strong style="color:var(--danger)">${overdue}</strong> vencida</div>` : ''}
      </div>
      ${activeTasks.length === 0 ? '<div class="empty"><div class="empty-icon"><i data-lucide="inbox"></i></div>SIN TAREAS</div>' : taskHTML}
      ${archiveToggleHTML}
      ${adminHTML}
    </div>`;

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function toolbarHTML(id) {
  return `<div class="toolbar"><button class="tb-btn" onclick="doFormat('bold','${id}')"><b>N</b></button><button class="tb-btn" onclick="doFormat('italic','${id}')"><i>C</i></button><button class="tb-btn" onclick="doFormat('underline','${id}')"><u>S</u></button><button class="tb-btn" style="color:#e53935" onclick="doColor('#e53935','${id}')">A</button><button class="tb-btn" style="color:#1565c0" onclick="doColor('#1565c0','${id}')">A</button><button class="tb-btn" style="color:#2e7d32" onclick="doColor('#2e7d32','${id}')">A</button></div>`;
}

function colorPickerHTML(sel, prefix) {
  let h = '<div class="color-picker-row">';
  CARD_COLORS.forEach(c => h += `<div class="card-color-opt ${sel===c.value?'selected':''}" style="background:${c.value}" onclick="doSelectColor('${c.value}','${prefix}')"></div>`);
  return h + '</div>';
}

/* =========================================================
   ACCIONES
   ========================================================= */
function doLogin() {
  const pin = document.getElementById("pinInput")?.value;
  if (pin === ADMIN_PIN) { adminUnlocked = true; loginOpen = false; render(); }
  else { const e = document.getElementById("pinErr"); if(e) e.style.display = "block"; }
}

function doLoginName() {
  const val = document.getElementById("loginInput")?.value.trim();
  if (val.length < 3) return alert("Nombre muy corto (mínimo 3 letras)");
  currentUser = val;
  localStorage.setItem("userName", val);
  render();
}

function doOpenRanking() {
  const personData = {};
  tasks.forEach(t => (t.confirmedBy || []).forEach(name => {
    if (!name) return;
    if (!personData[name]) personData[name] = { count: 0, earliestDate: null };
    personData[name].count += 1;
    const dStr = (t.doneByMeta || {})[name];
    if (dStr) { const d = new Date(dStr); if (!personData[name].earliestDate || d < personData[name].earliestDate) personData[name].earliestDate = d; }
  }));
  rankingScores.forEach(row => {
    if (!row.name) return;
    if (!personData[row.name]) personData[row.name] = { count: 0, earliestDate: null };
    personData[row.name].count = Math.max(personData[row.name].count, row.points || 0);
  });
  const sortedR = Object.entries(personData).sort((a,b) => b[1].count - a[1].count || (a[1].earliestDate - b[1].earliestDate));
  const medals = ["🥇", "🥈", "🥉"];
  let h = sortedR.map((entry, i) => {
    const medal = medals[i] || `<span style="display:inline-block;width:28px;text-align:center;font-size:13px;color:#7a6a99;">${i+1}</span>`;
    const isOpen = rankingActionsOpenFor === entry[0];
    const actions = adminUnlocked ? `<div style="position:relative;">
      <button onclick="doToggleRankActions('${escJsSingle(entry[0])}')" style="background:#f1e9ff;border:1px solid #cdb7f3;border-radius:8px;color:#6b3fc2;font-size:13px;padding:2px 9px;cursor:pointer;"><i data-lucide="more-horizontal" style="width:14px;height:14px;"></i></button>
      ${isOpen ? `<div style="position:absolute;top:30px;right:0;background:white;border:1px solid #d8cff0;border-radius:10px;box-shadow:0 8px 20px rgba(124,77,204,0.18);padding:6px;display:flex;flex-direction:column;gap:6px;z-index:100;min-width:135px;">
        <button onclick="doAdjustPoints('${escJsSingle(entry[0])}',1)" style="background:#7c4dcc;border:none;border-radius:6px;color:white;font-size:11px;padding:6px 8px;cursor:pointer;">Sumar +1</button>
        <button onclick="doAdjustPoints('${escJsSingle(entry[0])}',-1)" style="background:none;border:1px solid #d93025;border-radius:6px;color:#d93025;font-size:11px;padding:5px 8px;cursor:pointer;">Quitar -1</button>
        <button onclick="doShowScoreDetail('${escJsSingle(entry[0])}')" style="background:none;border:1px solid #7c4dcc;border-radius:6px;color:#7c4dcc;font-size:11px;padding:5px 8px;cursor:pointer;">Ver detalle</button>
      </div>` : ''}</div>` : '';
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #ede8f5;">
      <span style="font-size:20px;width:28px;text-align:center;">${medal}</span>
      <div style="flex:1;"><div style="font-size:14px;color:#2a1f3d;">${esc(entry[0])}</div></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;"><span style="font-weight:700;color:#7c4dcc;font-size:14px;">${entry[1].count} <i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:middle;"></i></span>${actions}</div>
    </div>`;
  }).join("");
  document.getElementById("rankingContent").innerHTML = h || '<p style="color:#7a6a99;font-size:13px;text-align:center;">Nadie aún</p>';
  document.getElementById("rankingModal").style.display = "flex";
  rankingOpen = true;
  if (window.lucide) window.lucide.createIcons();
}

function doOpenAudit() {
  const activeVerifs = new Map();
  rankingEvents.forEach(ev => { if(ev.source === "task_verification" && ev.taskId) activeVerifs.set(`${ev.name}_${ev.taskId}`, ev); });
  tasks.forEach(t => (t.confirmedBy||[]).forEach(n => {
    const key = `${n}_${t.id}`;
    if (!activeVerifs.has(key)) activeVerifs.set(key, {name:n, note:t.title, createdAt: (t.doneByMeta||{})[n], taskId:t.id});
  }));
  const filtered = Array.from(activeVerifs.values()).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const h = filtered.map(ev => `<div style="padding:12px 0;border-bottom:1px solid #ede8f5;"><div style="display:flex;justify-content:space-between;"><b>${esc(ev.name)}</b><small style="color:#7a6a99">${String(ev.taskId).slice(-4).toUpperCase()}</small></div><div style="color:#7c4dcc;font-size:13px">${esc(ev.note)}</div></div>`).join("");
  document.getElementById("auditContent").innerHTML = h || "Sin datos";
  document.getElementById("auditModal").style.display = "flex";
}

async function doConfirmDone(tid, n) {
  const t = tasks.find(x => x.id === tid);
  await updateDoc(doc(db, "tareas", tid), { confirmedBy: [...(t.confirmedBy||[]), n] });
  await upsertRankingScore(n, 1);
  await addRankingEvent(n, 1, "task_verification", t.title, tid);
  doShowDoneBy(tid);
}

async function doRejectDone(tid, n) {
  const t = tasks.find(x => x.id === tid);
  if (!t) return;
  const isConf = (t.confirmedBy||[]).includes(n);
  const doneBy = t.doneBy.filter(x => x !== n);
  const confirmedBy = (t.confirmedBy||[]).filter(x => x !== n);
  await updateDoc(doc(db, "tareas", tid), { doneBy, confirmedBy });
  if (isConf) { await upsertRankingScore(n, -1); await addRankingEvent(n, -1, "task_rejection", t.title, tid); }
  doShowDoneBy(tid);
}

function doShowDoneBy(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const h = (t.doneBy || []).map(n => {
    const isConf = (t.confirmedBy || []).includes(n);
    const action = adminUnlocked ? 
      (isConf ? `<span style="color:#2e7d32;font-size:12px;font-weight:700;"><i data-lucide="check-circle" style="width:14px;height:14px;vertical-align:middle;"></i> Verificado</span><button onclick="doRejectDone('${id}','${n}')" style="background:none;border:1px solid #d93025;border-radius:6px;color:#d93025;font-size:11px;padding:3px 8px;cursor:pointer;margin-left:8px;">Rechazar</button>` : 
                `<button onclick="doConfirmDone('${id}','${n}')" style="background:#7c4dcc;border:none;border-radius:6px;color:white;font-size:11px;padding:6px 12px;cursor:pointer;">Verificar</button><button onclick="doRejectDone('${id}','${n}')" style="background:none;border:1px solid #d93025;border-radius:6px;color:#d93025;font-size:11px;padding:3px 8px;cursor:pointer;margin-left:8px;"><i data-lucide="x" style="width:14px;height:14px;"></i></button>`) :
      (isConf ? '<i data-lucide="check-circle" style="width:14px;height:14px;vertical-align:middle;color:#2e7d32"></i> Verificado' : '<i data-lucide="clock" style="width:14px;height:14px;vertical-align:middle;color:#7a6a99"></i> Pendiente');
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #ede8f5;"><div>${esc(n)}</div><div>${action}</div></div>`;
  }).join("");
  document.getElementById("doneByContent").innerHTML = h || "Nadie aún";
  document.getElementById("doneByModal").style.display = "flex";
  if (window.lucide) window.lucide.createIcons();
}

async function doAddTask() {
  const title = document.getElementById("nTitle")?.value.trim();
  const due = document.getElementById("nDue")?.value;
  if (!title || !due) return alert("Faltan datos");
  await addDoc(collection(db, "tareas"), { title, desc: document.getElementById("nDesc")?.innerHTML || "", assigned: document.getElementById("nAssigned")?.value || "", due, cardColor: selectedColor, doneBy: [], createdAt: serverTimestamp() });
  addOpen = false; render();
}

async function doDelete(id) { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, "tareas", id)); }
function doStartEdit(id) { editingId = id; render(); }
function doCancelEdit() { editingId = null; render(); }
async function doSaveEdit(id) {
  const t = document.getElementById("eTitle").value.trim();
  const d = document.getElementById("eDue").value;
  await updateDoc(doc(db, "tareas", id), { title: t, desc: document.getElementById("eDesc").innerHTML, assigned: document.getElementById("eAssigned").value, due: d, cardColor: editSelectedColor });
  editingId = null; render();
}

window.doClearOldHistory = async () => {
  if (!confirm("¿Borrar tareas de hace más de 30 días?")) return;
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const qry = query(collection(db, "tareas"), where("due", "<", thirtyDaysAgo.toISOString().split("T")[0]));
  const snap = await getDocs(qry);
  const batch = writeBatch(db);
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
};

window.doMarkTaskSeen = (id) => {
  const userKey = currentUser.toLowerCase();
  const seen = JSON.parse(localStorage.getItem(SEEN_TASKS_STORAGE_KEY)||"{}");
  seen[userKey] = [...(seen[userKey]||[]), id];
  localStorage.setItem(SEEN_TASKS_STORAGE_KEY, JSON.stringify(seen));
  render();
};

/* Sincronización */
onSnapshot(query(collection(db, "tareas"), orderBy("createdAt", "asc")), snap => { tasks = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); });
onSnapshot(collection(db, "ranking_scores"), snap => { rankingScores = snap.docs.map(d => ({ id: d.id, ...d.data() })); if(rankingOpen) doOpenRanking(); });
onSnapshot(query(collection(db, "ranking_events"), orderBy("createdAt", "desc")), snap => {
  rankingEvents = snap.docs.map(d => { const r = d.data(); return { id: d.id, ...r, createdAt: r.createdAt?.toDate?.()?.toISOString() || null }; });
});

/* EXPORTACIONES */
window.doLogin = doLogin; window.doToggleLogin = () => { loginOpen = !loginOpen; render(); }; window.doLock = () => { adminUnlocked = false; render(); };
window.doLogout = () => { localStorage.clear(); location.reload(); }; window.doLoginName = doLoginName;
window.doToggleArchive = () => { showArchive = !showArchive; render(); }; window.doToggleDots = () => { dotsOpen = !dotsOpen; document.getElementById("dotsMenu").classList.toggle("open", dotsOpen); };
window.doAddTask = doAddTask; window.doDelete = doDelete; window.doStartEdit = doStartEdit; window.doCancelEdit = doCancelEdit; window.doSaveEdit = doSaveEdit;
window.doToggleDone = async (id) => {
  const t = tasks.find(x => x.id === id); if(!t) return;
  let doneBy = t.doneBy || [];
  if (doneBy.includes(currentUser)) doneBy = doneBy.filter(n => n !== currentUser); else doneBy.push(currentUser);
  await updateDoc(doc(db, "tareas", id), { doneBy });
};
window.doShowDoneBy = doShowDoneBy; window.doConfirmDone = doConfirmDone; window.doRejectDone = doRejectDone;
window.doOpenRanking = doOpenRanking; window.doToggleRankActions = (n) => { rankingActionsOpenFor = rankingActionsOpenFor === n ? "" : n; doOpenRanking(); };
window.doAdjustPoints = async (n, d) => {
  const r = await new Promise(res => { actionModalResolver = res; document.getElementById("actionModal").style.display="flex"; document.getElementById("actionModalTitle").textContent="Ajuste"; document.getElementById("actionModalMessage").textContent="Motivo para " + n; document.getElementById("actionModalInput").style.display="block"; });
  if (r?.accepted) { await upsertRankingScore(n, d); await addRankingEvent(n, d, "manual_adjustment", r.value || "Ajuste manual"); }
  rankingActionsOpenFor = ""; doOpenRanking();
};
window.doShowScoreDetail = (n) => { const f = rankingEvents.filter(ev => ev.name === n).slice(0, 10); const txt = f.map(ev => `${new Date(ev.createdAt).toLocaleDateString()} | ${ev.delta > 0 ? '+':''}${ev.delta} | ${ev.note}`).join("\n"); document.getElementById("infoModalTitle").textContent="Historial"; document.getElementById("infoModalBody").textContent=txt || "Sin datos"; document.getElementById("infoModal").style.display="flex"; };
window.doOpenAudit = doOpenAudit; window.doCloseAudit = () => { document.getElementById("auditModal").style.display="none"; };
window.doFormat = (c, t) => { document.getElementById(t).focus(); document.execCommand(c, false, null); };
window.doColor = (c, t) => { document.getElementById(t).focus(); document.execCommand('foreColor', false, c); };
window.doSelectColor = (c, p) => { if(p==='add') selectedColor=c; else editSelectedColor=c; render(); };
window.doToggleAi = () => { aiOpen = !aiOpen; render(); }; window.doToggleAdd = () => { addOpen = !addOpen; render(); };
window.doCloseRanking = () => { document.getElementById("rankingModal").style.display="none"; rankingOpen=false; rankingActionsOpenFor=""; };
window.doCloseDoneBy = () => document.getElementById("doneByModal").style.display="none";
window.doCloseInfoModal = () => document.getElementById("infoModal").style.display="none";
window.doCloseActionModal = (a) => { const v = document.getElementById("actionModalInput").value; document.getElementById("actionModal").style.display="none"; if(actionModalResolver) actionModalResolver({accepted:!!a, value:v}); };
window.doCopy = () => alert("Copiado"); window.doEnableReminders = () => Notification.requestPermission();
async function doSendAi() {
  const input = document.getElementById("aiInput")?.value.trim(); if (!input) return;
  document.getElementById("aiLoadBox").style.display = "block"; document.getElementById("aiSubmitRow").style.display = "none";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + _G }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "Extrae title, due (YYYY-MM-DD) en JSON. Tarea: " + input }] }) });
    const data = await res.json(); aiTaskData = JSON.parse(data.choices[0].message.content.match(/\{[\s\S]*\}/)[0]);
    document.getElementById("aiPreview").innerHTML = `<b>${aiTaskData.title}</b><br>${aiTaskData.due}`;
    document.getElementById("aiLoadBox").style.display = "none"; document.getElementById("aiResultBox").style.display = "block";
  } catch(e) { document.getElementById("aiLoadBox").style.display = "none"; document.getElementById("aiSubmitRow").style.display = "flex"; }
}
window.doSendAi = doSendAi; window.doResetAi = () => { aiTaskData = null; document.getElementById("aiResultBox").style.display="none"; document.getElementById("aiSubmitRow").style.display="flex"; };
window.doConfirmAi = async () => { if (!aiTaskData) return; await addDoc(collection(db, "tareas"), { ...aiTaskData, cardColor: CARD_COLORS[0].value, doneBy: [], createdAt: serverTimestamp() }); aiOpen = false; render(); };
