import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, EMAIL_DOMAIN } from "./firebase-config.js";

// ---------------- people & roles ----------------
const PEOPLE = ["bv", "oo", "ck"];
const LABEL = { bv: "BV", oo: "OO", ck: "CK" };
const LENDER = "bv", BORROWER = "oo", PAYER = "bv";
const TABS = {
  bv: [["bills", "Bills"], ["loan", "OO's Loan"], ["budget", "Budget"], ["settings", "Settings"]],
  oo: [["bills", "Bills"], ["loan", "My Loan"], ["budget", "Budget"], ["settings", "Settings"]],
  ck: [["bills", "Bills"], ["settings", "Settings"]],
};
const ICONS = {
  bills: '<path d="M6 2.8h12v18.4l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  loan: '<circle cx="12" cy="12" r="9.2"/><path d="M12 6.6v10.8M14.6 9.3c0-1-1.2-1.8-2.6-1.8s-2.6.8-2.6 1.8 1.2 1.6 2.6 1.9 2.6.8 2.6 1.9-1.2 1.8-2.6 1.8-2.6-.8-2.6-1.8"/>',
  budget: '<path d="M11 3.1a9 9 0 1 0 9.9 9.9H11z"/><path d="M14 2.9a8 8 0 0 1 7.1 7.1H14z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
};

// ---------------- appearance ----------------
function applyTheme(choice) {
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("ledger.theme", choice); } catch {}
  document.querySelectorAll("#themeSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === choice)));
}
let themeNow = "system"; try { themeNow = localStorage.getItem("ledger.theme") || "system"; } catch {}
document.addEventListener("DOMContentLoaded", () => applyTheme(themeNow));
applyTheme(themeNow);

// ---------------- helpers ----------------
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cents) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const r2 = n => Math.round(n * 100) / 100;
// House rounding rule: cents above 45 round up to the next dollar, 45 cents or less round down.
// Worked in whole cents so 70.49 can't drift to 70.4899999.
const roundBill = x => { const c = Math.round(x * 100), d = Math.floor(c / 100), rem = c - d * 100; return rem > 45 ? d + 1 : d; };
const m2 = n => money(r2(n), Math.round(r2(n)) !== r2(n));
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const fmtDate = (s, o) => parse(s).toLocaleDateString("en-US", o || { month: "short", day: "numeric" });
const monthKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1);
const monthLabel = k => parse(k + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const DAY = 864e5;
const uid = () => Math.random().toString(36).slice(2, 10);
let toastT;
const toast = msg => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); };
const fail = e => { console.error(e); toast(e && e.code === "permission-denied" ? "You don't have permission to change that." : "Couldn't save. Check your connection and try again."); };
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + " copied"); }
  catch { toast(text); }
}

// ---------------- firebase ----------------
if (firebaseConfig.apiKey === "PASTE_HERE") {
  document.body.innerHTML = `<div class="wrap"><div class="notice" style="margin-top:20vh">Setup isn't finished yet. Paste your Firebase settings into <b>firebase-config.js</b> (see README).</div></div>`;
  throw new Error("Missing Firebase config");
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- state ----------------
const S = { me: null, members: {}, bills: [], months: {}, loan: null, payments: [], budget: null, expenses: [], settles: {}, month: monthKey(today()), tab: "bills" };
let unsubs = [];

// ---------------- login ----------------
let pick = "";
try { pick = localStorage.getItem("ledger.who") || ""; } catch {}
function paintPick() { document.querySelectorAll("#whoPick button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.code === pick))); }
paintPick();
$("whoPick").onclick = e => { const b = e.target.closest("button"); if (!b) return; pick = b.dataset.code; paintPick(); $("pw").focus(); };
$("loginForm").onsubmit = async e => {
  e.preventDefault();
  const err = $("loginErr"); err.hidden = true;
  if (!pick) { err.textContent = "Tap your initials first."; err.hidden = false; return; }
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, `${pick}@${EMAIL_DOMAIN}`, $("pw").value);
    try { localStorage.setItem("ledger.who", pick); } catch {}
    $("pw").value = "";
  } catch (er) {
    err.textContent = er.code === "auth/too-many-requests" ? "Too many tries. Wait a few minutes and try again." : "That password didn't work. Try again, or ask BV to reset it.";
    err.hidden = false;
  } finally { $("loginBtn").disabled = false; }
};

onAuthStateChanged(auth, user => {
  unsubs.forEach(u => u()); unsubs = [];
  const code = user && user.email ? user.email.split("@")[0] : null;
  if (!code || !PEOPLE.includes(code)) {
    if (user) signOut(auth);
    $("appView").hidden = true; $("loginView").hidden = false; return;
  }
  S.me = code;
  $("loginView").hidden = true; $("appView").hidden = false;
  $("meBadge").textContent = LABEL[code]; $("meBadge").dataset.who = code;
  $("greet").textContent = "Signed in as " + LABEL[code];
  buildTabs();
  start();
});
$("signOut").onclick = () => signOut(auth);
$("pwForm").onsubmit = async e => {
  e.preventDefault();
  try { await updatePassword(auth.currentUser, $("newPw").value); $("newPw").value = ""; toast("Password changed"); }
  catch (er) { toast(er.code === "auth/requires-recent-login" ? "Sign out and back in, then change your password." : "Couldn't change the password."); }
};

// ---------------- tabs ----------------
function buildTabs() {
  const tabs = TABS[S.me];
  $("tabs").innerHTML = tabs.map(([k, t]) => `<button role="tab" data-tab="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>${t}</button>`).join("");
  $("tabs").style.gridTemplateColumns = `repeat(${tabs.length},1fr)`;
  let saved = ""; try { saved = localStorage.getItem("ledger.tab") || ""; } catch {}
  showTab(tabs.some(t => t[0] === saved) ? saved : "bills");
}
function showTab(t) {
  S.tab = t;
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  document.querySelectorAll("section.panel").forEach(s => s.hidden = s.id !== "tab-" + t);
  const tab = (TABS[S.me] || []).find(x => x[0] === t);
  $("pageTitle").textContent = tab ? tab[1] : "";
  try { localStorage.setItem("ledger.tab", t); } catch {}
  window.scrollTo(0, 0);
}
$("tabs").onclick = e => { const b = e.target.closest("button"); if (b) showTab(b.dataset.tab); };
$("themeSeg").onclick = e => { const b = e.target.closest("[data-theme-choice]"); if (b) applyTheme(b.dataset.themeChoice); };
$("payMethodSeg").onclick = e => {
  const b = e.target.closest("[data-method]"); if (!b) return;
  $("payMethod").value = b.dataset.method;
  document.querySelectorAll("#payMethodSeg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
};
document.querySelectorAll("[data-month]").forEach(b => b.onclick = () => {
  const d = parse(S.month + "-01"); d.setMonth(d.getMonth() + Number(b.dataset.month)); S.month = monthKey(d); render();
});
$("payDate").value = iso(today()); $("expDate").value = iso(today());

// ---------------- data ----------------
const canLoan = () => S.me === LENDER || S.me === BORROWER;
const hasBudget = () => S.me === LENDER || S.me === BORROWER;
const watchErr = er => { console.error(er); toast("Lost connection. Reload the page."); };

async function start() {
  // Make sure my member record exists.
  const meRef = doc(db, "members", S.me);
  try { if (!(await getDoc(meRef)).exists()) await setDoc(meRef, { venmo: "", phone: "" }); } catch (e) { console.error(e); }
  if (S.me === LENDER) await seedHouse();
  if (hasBudget()) await seedBudget();

  unsubs.push(onSnapshot(collection(db, "members"), s => { S.members = {}; s.forEach(d => S.members[d.id] = d.data()); render(); }, watchErr));
  unsubs.push(onSnapshot(query(collection(db, "bills"), orderBy("createdAt")), s => { S.bills = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, watchErr));
  unsubs.push(onSnapshot(collection(db, "billMonths"), s => { S.months = {}; s.forEach(d => S.months[d.id] = d.data()); render(); }, watchErr));
  unsubs.push(onSnapshot(collection(db, "roundingSettlements"), s => { S.settles = {}; s.forEach(d => S.settles[d.id] = d.data()); render(); }, watchErr));
  if (canLoan()) {
    unsubs.push(onSnapshot(doc(db, "loan", "settings"), s => { S.loan = s.exists() ? s.data() : null; render(); }, watchErr));
    unsubs.push(onSnapshot(collection(db, "loanPayments"), s => { S.payments = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, watchErr));
  }
  if (hasBudget()) {
    unsubs.push(onSnapshot(doc(db, "budgets", S.me), s => { S.budget = s.exists() ? s.data() : null; render(); }, watchErr));
    unsubs.push(onSnapshot(collection(db, "budgets", S.me, "expenses"), s => { S.expenses = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, watchErr));
  }
  render();
}

// First sign-in by BV fills in the house's bills and loan terms.
async function seedHouse() {
  try {
    if ((await getDoc(doc(db, "loan", "settings"))).exists()) return;
    const b = writeBatch(db);
    b.set(doc(db, "loan", "settings"), { principal: 12000, weekly: 200, start: "2026-11-06", end: "2027-12-31" });
    const bills = [
      ["rent", "Rent", "Landlord", "", 1926, 1],
      ["gas", "Gas", "Black Hills Energy", "https://www.blackhillsenergy.com", null, null],
      ["electric", "Electric", "OPPD", "https://www.oppd.com", null, null],
      ["water", "Water", "MUD", "https://www.mudomaha.com", null, null],
      ["wifi", "Wifi", "Spectrum", "https://www.spectrum.net", 141.13, null],
    ];
    bills.forEach(([id, name, company, url, amount, dueDay], i) => b.set(doc(db, "bills", id), { name, company, url, amount, varies: amount == null, dueDay, createdAt: i + 1 }));
    PEOPLE.forEach(p => b.set(doc(db, "members", p), { venmo: "", phone: "" }, { merge: true }));
    await b.commit();
  } catch (e) { console.error(e); }
}
async function seedBudget() {
  try {
    const ref = doc(db, "budgets", S.me);
    if ((await getDoc(ref)).exists()) return;
    const goals = [{ id: uid(), name: "Emergency fund", target: 1000, saved: 0 }, { id: uid(), name: "Vacation", target: 1500, saved: 0 }];
    const plan = S.me === BORROWER
      ? { income: 2350, lines: [{ name: "House bills", amount: 800, source: "bills" }, { name: "Loan payment", amount: 860, source: "loan" }, { name: "Phone", amount: 50, source: null }, { name: "Personal", amount: 150, source: null }, { name: "Savings", amount: 290, source: "goals" }], goals }
      : { income: 0, lines: [{ name: "House bills", amount: 0, source: "bills" }, { name: "Savings", amount: 0, source: "goals" }], goals };
    await setDoc(ref, plan);
  } catch (e) { console.error(e); }
}

// ---------------- pay buttons (Venmo + Apple Cash) ----------------
function payButtons(to, amount, note) {
  const m = S.members[to] || {}, amt = r2(amount).toFixed(2), parts = [];
  if (m.venmo) parts.push(`<a class="paybtn" target="_blank" rel="noopener" href="https://venmo.com/${encodeURIComponent(m.venmo.replace(/^@/, ""))}?txn=pay&amount=${amt}&note=${encodeURIComponent(note)}">Venmo ${m2(+amt)}</a>`);
  if (m.phone) {
    const digits = m.phone.replace(/[^\d+@.a-z]/gi, "");
    parts.push(`<a class="paybtn" href="sms:${encodeURIComponent(digits)}&body=${encodeURIComponent("$" + amt)}">Apple Cash: text ${m2(+amt)}</a>`);
    parts.push(`<button type="button" class="paybtn" data-copy="${esc(m.phone)}" data-what="Number">Copy ${esc(m.phone)}</button>`);
    parts.push(`<button type="button" class="paybtn" data-copy="${amt}" data-what="Amount">Copy ${m2(+amt)}</button>`);
  }
  return parts.length ? `<div class="chips">${parts.join("")}</div>` : `<div class="small muted">${LABEL[to]} hasn't added Venmo or Apple Cash yet (Settings tab).</div>`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-copy]"); if (b) copy(b.dataset.copy, b.dataset.what); });

// ---------------- bills ----------------
// Bill amounts are stored exactly as billed. Each roommate's share is rounded to whole dollars
// (over 45¢ up, 45¢ or less down) so they can send round numbers. The cents they send over or under
// are tracked per person for the calendar year and settled at year end.
const recOf = b => S.months[b.id + "__" + S.month] || {};
const amountFor = (b, rec) => b.varies ? (rec && rec.amount != null ? +rec.amount : null) : (+b.amount || 0);
const billAmount = b => amountFor(b, recOf(b));
const exactOf = a => a == null ? null : a / PEOPLE.length;
const sendOf = a => a == null ? null : roundBill(exactOf(a));
// What person p puts toward bill b this month: BV's exact third, a roommate's rounded share.
const shareFor = (b, p) => { const a = billAmount(b); return a == null ? null : p === PAYER ? r2(exactOf(a)) : sendOf(a); };
const settled = (b, p) => p === PAYER ? !!recOf(b).companyPaid : !!(recOf(b).paid || {})[p];
function dueDate(b) {
  const rd = recOf(b).dueDate; // from the bill email, when there is one
  if (rd && rd.slice(0, 7) === S.month) return parse(rd);
  if (!b.dueDay) return null;
  const [y, m] = S.month.split("-").map(Number), last = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(b.dueDay, last));
}
function dueLabel(b) {
  const d = dueDate(b); if (!d) return { t: "Due date not set", c: "later" };
  const ds = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (recOf(b).companyPaid) return { t: "Paid · was due " + ds, c: "done" };
  const days = Math.round((d - today()) / DAY);
  if (days < 0) return { t: "Overdue · was due " + ds, c: "late" };
  if (days === 0) return { t: "Due today", c: "late" };
  if (days <= 5) return { t: `Due ${ds} · in ${days} day${days > 1 ? "s" : ""}`, c: "soon" };
  return { t: "Due " + ds, c: "later" };
}
function renderBills() {
  $("billMonth").textContent = monthLabel(S.month);
  const dd = b => { const d = dueDate(b); return d ? d.getDate() : 99; };
  const bills = [...S.bills].sort((a, b) => dd(a) - dd(b));
  let total = 0, missing = 0, mine = 0, mineUnknown = false;
  const owes = {};
  bills.forEach(b => {
    const a = billAmount(b), s = shareFor(b, S.me);
    if (a == null) missing++; else total += a;
    if (s == null) mineUnknown = true; else mine += s;
    PEOPLE.filter(p => p !== PAYER).forEach(p => { const sp = shareFor(b, p); if (sp != null && !settled(b, p)) owes[p] = (owes[p] || 0) + sp; });
  });
  $("billTotal").textContent = m2(total) + (missing ? "+" : "");
  $("billMine").textContent = m2(mine) + (mineUnknown ? "+" : "");
  const open = bills.filter(b => dueDate(b) && !recOf(b).companyPaid).sort((a, b) => dueDate(a) - dueDate(b));
  const up = open[0];
  $("billNextDue").textContent = up ? `${up.name} ${dueDate(up) < today() ? "overdue" : dueDate(up).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : bills.some(b => !recOf(b).companyPaid) ? "Set due dates" : bills.length ? "All paid" : "—";
  $("billNextDue").style.color = up && dueDate(up) < today() ? "var(--bad)" : "";
  const who = Object.keys(owes).filter(p => owes[p] > 0.004);
  $("billSummary").innerHTML = (who.length ? who.map(p => `<span class="pill warn">${p === S.me ? "You owe" : LABEL[p] + " owes"} ${PAYER === S.me ? "you" : LABEL[PAYER]} ${m2(owes[p])}</span>`).join("")
    : bills.length ? `<span class="pill good">Everyone's paid up${missing ? " so far" : ""}</span>` : "")
    + (missing ? `<span class="pill">${missing} bill${missing > 1 ? "s" : ""} need this month's amount</span>` : "");
  const myOwe = S.me !== PAYER ? (owes[S.me] || 0) : 0;
  $("payCard").hidden = myOwe < 0.005;
  $("payLinks").innerHTML = myOwe >= 0.005 ? `<div><b>${m2(myOwe)}</b> to ${LABEL[PAYER]} for ${monthLabel(S.month)}${missing ? " (more once the remaining bills are entered)" : ""}</div>${payButtons(PAYER, myOwe, "House bills " + monthLabel(S.month))}` : "";
  $("billList").innerHTML = bills.length ? bills.map(b => {
    const rec = recOf(b), a = billAmount(b), due = dueLabel(b);
    const co = b.company ? (b.url ? `<a class="co" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.company)}</a>` : `<span class="co">${esc(b.company)}</span>`) : "";
    const exact = exactOf(a), send = sendOf(a), rounds = a != null && Math.abs(send - exact) >= 0.005;
    const amountCell = a == null
      ? `<div class="amtin"><input id="amt-${esc(b.id)}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount" aria-label="${esc(b.name)} amount"><button type="button" class="ghost" data-setamt="${esc(b.id)}">Save</button></div>`
      : `<div style="text-align:right"><span class="amt">${money(a, Math.round(a * 100) % 100 !== 0)}</span>${b.varies ? ` <button type="button" class="x" style="font-size:12px" data-clearamt="${esc(b.id)}">edit</button>` : ""}${rounds ? `<div class="foot num">Each ${money(exact, true)} → ${m2(send)}</div>` : ""}${rec.source === "email" ? `<div class="foot">From email</div>` : ""}</div>`;
    const chips = PEOPLE.filter(p => p !== PAYER).map(p => {
      const on = !!(rec.paid || {})[p], via = on && (rec.method || {})[p], mine = p === S.me || S.me === PAYER;
      const inner = `<span class="dot">${on ? "✓" : ""}</span>${LABEL[p]} ${a == null ? "" : m2(send)}${via ? ` <span class="muted">· ${esc(via)}</span>` : ""}`;
      return mine ? `<button type="button" class="check ${on ? "on" : ""}" data-bill="${esc(b.id)}" data-p="${p}" aria-pressed="${on}">${inner}</button>` : `<span class="check ${on ? "on" : ""}">${inner}</span>`;
    }).join("");
    const payerInner = `<span class="dot">${rec.companyPaid ? "✓" : ""}</span>Paid to company <span class="muted">· ${LABEL[PAYER]}</span>`;
    const payerChip = S.me === PAYER ? `<button type="button" class="check ${rec.companyPaid ? "on" : ""}" data-company="${esc(b.id)}">${payerInner}</button>` : `<span class="check ${rec.companyPaid ? "on" : ""}">${payerInner}</span>`;
    return `<li style="align-items:flex-start"><div class="grow" style="display:flex;flex-direction:column;gap:8px">
      <div class="row between" style="align-items:flex-start"><div><b>${esc(b.name)}</b> ${co}<div class="due ${due.c}">${esc(due.t)}</div></div><div>${amountCell}</div></div>
      <div class="chips">${chips}${payerChip}</div></div></li>`;
  }).join("") : `<li class="empty">No bills yet.${S.me === PAYER ? " Add them in Settings." : ""}</li>`;
  renderRounding();
  $("billHelp").innerHTML = S.me === PAYER
    ? `When someone pays you, their chip turns green. Tap a chip to fix a mistake, and tap <b>Paid to company</b> once you've paid the bill. Utility amounts fill in from email, or type them in.`
    : `After you send your share, tap your initials to mark it paid. Utility amounts fill in from BV's bill emails, or anyone can type them in.`;
}

// ---------------- rounding balance ----------------
// For each roommate and calendar year: what they sent (rounded shares they marked paid) minus their exact thirds.
// Positive = they sent more than their real share, so BV refunds them. Negative = they owe BV.
function roundingFor(p, year) {
  let bal = 0, n = 0;
  Object.values(S.months).forEach(rec => {
    if (!rec.month || rec.month.slice(0, 4) !== year || !(rec.paid || {})[p]) return;
    const b = S.bills.find(x => x.id === rec.billId); if (!b) return;
    const a = amountFor(b, rec); if (a == null) return;
    bal += sendOf(a) - exactOf(a); n++;
  });
  const settledAmt = +((S.settles[year + "_" + p] || {}).amount || 0);
  return { total: r2(bal), settled: settledAmt, left: r2(bal - settledAmt), n };
}
function renderRounding() {
  const year = S.month.slice(0, 4), past = +year < today().getFullYear();
  $("roundYear").textContent = year;
  const people = S.me === PAYER ? PEOPLE.filter(p => p !== PAYER) : [S.me];
  $("roundBox").innerHTML = people.map(p => {
    const r = roundingFor(p, year), you = p === S.me, nm = you ? "You" : LABEL[p];
    const st = S.settles[year + "_" + p];
    let line, sub, color = "";
    if (Math.abs(r.left) < 0.005) { line = "Even"; sub = st ? `Settled ${money(Math.abs(st.amount), true)} on ${fmtDate(st.date)}` : r.n ? "Nothing to settle so far" : "No rounded shares yet"; }
    else if (r.left > 0) { line = "+" + money(r.left, true); color = "var(--good-ink)"; sub = you ? `You've sent ${money(r.left, true)} extra. ${LABEL[PAYER]} refunds you ${past ? "now" : "at year end"}.` : `${nm} sent extra. You refund ${nm} ${past ? "now" : "at year end"}.`; }
    else { line = "−" + money(-r.left, true); color = "var(--bad)"; sub = you ? `You've sent ${money(-r.left, true)} less than your share. You pay ${LABEL[PAYER]} ${past ? "now" : "at year end"}.` : `${nm} sent less. ${nm} pays you ${past ? "now" : "at year end"}.`; }
    const settleBtn = S.me === PAYER && Math.abs(r.left) >= 0.005 ? `<button type="button" class="ghost" data-settle="${p}">Mark settled</button>` : "";
    const payBtns = you && r.left <= -0.005 && past ? `<div style="margin-top:8px">${payButtons(PAYER, -r.left, "Rounding balance " + year)}</div>` : "";
    return `<div class="roundrow"><div style="min-width:0"><div style="font-weight:600">${S.me === PAYER ? LABEL[p] : "Your balance"}</div><div class="foot">${esc(sub)}</div>${payBtns}</div>
      <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px"><div class="amt num" style="font-family:var(--sf-rounded);font-size:20px;color:${color}">${line}</div>${settleBtn}</div></div>`;
  }).join("");
}
$("roundBox").addEventListener("click", async e => {
  const b = e.target.closest("[data-settle]"); if (!b) return;
  const year = S.month.slice(0, 4), p = b.dataset.settle, r = roundingFor(p, year);
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = r.left > 0 ? `Refunded ${money(r.left, true)}?` : `Received ${money(-r.left, true)}?`; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Mark settled"; } }, 4000); return; }
  try { await setDoc(doc(db, "roundingSettlements", year + "_" + p), { year, person: p, amount: r.total, date: iso(today()) }); toast(`${LABEL[p]} settled for ${year}`); } catch (er) { fail(er); }
});

async function writeMonth(billId, patch) {
  const id = billId + "__" + S.month, cur = S.months[id] || {};
  const body = { ...cur, billId, month: S.month, paid: { ...(cur.paid || {}) }, method: { ...(cur.method || {}) } };
  patch(body);
  try { await setDoc(doc(db, "billMonths", id), body); } catch (er) { fail(er); }
}
$("billList").addEventListener("click", e => {
  const b = e.target.closest("[data-bill]");
  if (b) return writeMonth(b.dataset.bill, body => { const p = b.dataset.p, on = !body.paid[p]; body.paid[p] = on; if (on) body.method[p] = $("payMethod").value; else delete body.method[p]; });
  const c = e.target.closest("[data-company]");
  if (c) return writeMonth(c.dataset.company, body => { if (body.companyPaid) delete body.companyPaid; else body.companyPaid = true; });
  const sa = e.target.closest("[data-setamt]");
  if (sa) { const v = parseFloat($("amt-" + sa.dataset.setamt).value); if (!(v >= 0)) return toast("Type the amount from the bill first."); return writeMonth(sa.dataset.setamt, body => { body.amount = r2(v); body.source = "manual"; delete body.actual; }).then(() => toast("Amount saved")); }
  const ca = e.target.closest("[data-clearamt]");
  if (ca) return writeMonth(ca.dataset.clearamt, body => { delete body.amount; delete body.actual; delete body.source; });
});

// ---------------- loan ----------------
function renderLoan() {
  if (!canLoan()) return;
  const L = S.loan, isBorrower = S.me === BORROWER;
  const pays = [...S.payments].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const paid = pays.reduce((s, p) => s + (+p.amount || 0), 0);
  const pending = pays.filter(p => !p.confirmed).reduce((s, p) => s + (+p.amount || 0), 0);
  $("payFormTitle").textContent = isBorrower ? "I sent a payment" : "Record a payment from OO";
  if (!L) { $("loanStatus").textContent = "Loan not set up"; return; }
  const remaining = Math.max(0, L.principal - paid);
  $("loanTitle").textContent = isBorrower ? "You owe BV" : "OO owes you";
  $("loanRemaining").textContent = m2(remaining);
  $("loanRemLabel").textContent = "left to pay back" + (pending ? ` (${m2(pending)} waiting for BV to confirm)` : "");
  $("loanPaid").textContent = m2(paid);
  $("loanBar").style.width = Math.min(100, paid / L.principal * 100).toFixed(1) + "%";
  const start = parse(L.start), t = today();
  const nDue = t < start ? 0 : Math.floor((t - start) / DAY / 7) + 1;
  const expected = Math.min(L.principal, nDue * L.weekly), diff = paid - expected, st = $("loanStatus");
  if (remaining <= 0) { st.textContent = "Paid in full"; st.className = "pill good"; }
  else if (t < start && paid === 0) { st.textContent = "Starts " + fmtDate(L.start); st.className = "pill"; }
  else if (diff >= 0) { st.textContent = diff > 0 ? m2(diff) + " ahead" : "On track"; st.className = "pill good"; }
  else { st.textContent = m2(-diff) + " behind"; st.className = "pill " + (-diff <= L.weekly ? "warn" : "bad"); }
  let next = new Date(start);
  if (t > start) next = new Date(start.getTime() + Math.ceil((t - start) / DAY / 7) * 7 * DAY);
  const nextAmt = Math.min(L.weekly, remaining);
  $("loanNext").textContent = remaining <= 0 ? "Done" : `${m2(nextAmt)} · ${next.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const finish = new Date(next.getTime() + Math.max(0, Math.ceil(remaining / L.weekly) - 1) * 7 * DAY);
  $("loanFinish").textContent = remaining <= 0 ? "Done" : finish.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  $("loanFinish").style.color = L.end && finish > parse(L.end) ? "var(--bad)" : "";
  $("loanPayCard").hidden = !(isBorrower && remaining > 0);
  $("loanPayLinks").innerHTML = isBorrower && remaining > 0 ? `<div class="small muted">Send it, then record it below so BV can confirm.</div>${payButtons(LENDER, nextAmt, "Loan payment")}` : "";
  drawChart(L, pays);
  $("payList").innerHTML = pays.length ? pays.map(p => {
    const when = esc(fmtDate(p.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" }));
    const tag = p.confirmed ? "" : ` <span class="pill warn">${isBorrower ? "Waiting for BV" : "Needs your OK"}</span>`;
    const actions = S.me === LENDER
      ? `${p.confirmed ? "" : `<button class="ghost" data-confirm="${esc(p.id)}">Confirm</button>`}<button class="x" data-delpay="${esc(p.id)}" aria-label="Delete payment">×</button>`
      : (!p.confirmed ? `<button class="x" data-delpay="${esc(p.id)}" aria-label="Delete payment">×</button>` : "");
    return `<li><div class="grow"><div class="amt">${m2(+p.amount)}${tag}</div><div class="small muted">${when}${p.method ? " · " + esc(p.method) : ""}${p.note ? " · " + esc(p.note) : ""}</div></div>${actions}</li>`;
  }).join("") : `<li class="empty">No payments yet.</li>`;
}
function drawChart(L, pays) {
  const W = 600, H = 170, padL = 44, padR = 10, padT = 10, padB = 24;
  const start = parse(L.start), end = L.end ? parse(L.end) : new Date(start.getTime() + Math.ceil(L.principal / L.weekly) * 7 * DAY);
  const t0 = start.getTime() - 7 * DAY, t1 = Math.max(end.getTime(), today().getTime());
  const x = t => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const y = v => H - padB - v / L.principal * (H - padT - padB);
  let plan = `M${x(t0)},${y(0)}`, cum = 0;
  for (let t = start.getTime(); cum < L.principal && t <= t1; t += 7 * DAY) { cum = Math.min(L.principal, cum + L.weekly); plan += ` L${x(t)},${y(cum)}`; }
  const sorted = [...pays].filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
  let act = `M${x(t0)},${y(0)}`; cum = 0;
  for (const p of sorted) { const tt = Math.max(t0, parse(p.date).getTime()); act += ` L${x(tt)},${y(cum)}`; cum += +p.amount || 0; act += ` L${x(tt)},${y(Math.min(cum, L.principal))}`; }
  const tx = x(Math.min(today().getTime(), t1)); act += ` L${tx},${y(Math.min(cum, L.principal))}`;
  let g = "";
  [0, .5, 1].forEach(f => g += `<line x1="${padL}" x2="${W - padR}" y1="${y(L.principal * f)}" y2="${y(L.principal * f)}" stroke="var(--line)"/><text x="${padL - 6}" y="${y(L.principal * f) + 4}" text-anchor="end">${(L.principal * f / 1000).toFixed(L.principal * f % 1000 ? 1 : 0)}k</text>`);
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  for (; d.getTime() <= t1; d.setMonth(d.getMonth() + 3)) if (d.getTime() >= t0) g += `<text x="${x(d.getTime())}" y="${H - 6}" text-anchor="middle">${d.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}</text>`;
  g += `<line x1="${tx}" x2="${tx}" y1="${padT}" y2="${H - padB}" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
  g += `<path d="${plan}" fill="none" stroke="var(--muted)" stroke-width="1.5" opacity=".7"/>`;
  g += `<path d="${act}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;
  g += `<circle cx="${tx}" cy="${y(Math.min(cum, L.principal))}" r="4" fill="var(--accent)"/>`;
  $("loanChart").innerHTML = g;
}
$("payForm").onsubmit = async e => {
  e.preventDefault();
  const amount = +$("payAmt").value; if (!(amount > 0)) return;
  try {
    await addDoc(collection(db, "loanPayments"), { amount, date: $("payDate").value, method: $("payVia").value, note: $("payNote").value.trim(), confirmed: S.me === LENDER, by: S.me, createdAt: Date.now() });
    $("payAmt").value = ""; $("payNote").value = "";
    toast(S.me === LENDER ? "Payment added" : "Sent to BV to confirm");
  } catch (er) { fail(er); }
};
let armed = null;
$("payList").addEventListener("click", async e => {
  const c = e.target.closest("[data-confirm]");
  if (c) { try { await updateDoc(doc(db, "loanPayments", c.dataset.confirm), { confirmed: true }); toast("Confirmed"); } catch (er) { fail(er); } return; }
  const d = e.target.closest("[data-delpay]"); if (!d) return;
  if (armed !== d) { armed = d; d.textContent = "Delete?"; d.style.fontSize = "13px"; d.style.color = "var(--bad)"; setTimeout(() => { if (armed === d) { armed = null; d.textContent = "×"; d.style.cssText = ""; } }, 3000); return; }
  armed = null;
  try { await deleteDoc(doc(db, "loanPayments", d.dataset.delpay)); toast("Deleted"); } catch (er) { fail(er); }
});

// ---------------- budget ----------------
let planEditing = false, planDraft = null;
function lineActual(line) {
  const inMonth = d => d && d.slice(0, 7) === S.month;
  if (line.source === "loan") return S.me === BORROWER ? S.payments.filter(p => inMonth(p.date)).reduce((s, p) => s + (+p.amount || 0), 0) : 0;
  if (line.source === "bills") return S.bills.reduce((s, b) => s + (settled(b, S.me) ? (shareFor(b, S.me) || 0) : 0), 0);
  if (line.source === "goals") return S.expenses.filter(x => x.goalId && inMonth(x.date)).reduce((s, x) => s + (+x.amount || 0), 0);
  return S.expenses.filter(x => !x.goalId && inMonth(x.date) && x.category === line.name).reduce((s, x) => s + (+x.amount || 0), 0);
}
function renderBudget() {
  if (!hasBudget()) return;
  $("spendMonth").textContent = monthLabel(S.month);
  const B = S.budget || { income: 0, lines: [], goals: [] }, lines = B.lines || [];
  const cats = lines.filter(l => !l.source).map(l => l.name);
  const other = S.expenses.filter(x => !x.goalId && (x.date || "").slice(0, 7) === S.month && !cats.includes(x.category)).reduce((s, x) => s + (+x.amount || 0), 0);
  let spent = 0;
  const rows = lines.map(l => { const a = lineActual(l); spent += a; const pct = l.amount ? Math.min(100, a / l.amount * 100) : (a ? 100 : 0);
    return `<tr><td>${esc(l.name)}${l.source ? ' <span class="small muted">auto</span>' : ""}</td><td>${m2(+l.amount || 0)}</td><td>${m2(a)}<span class="mini"><i class="${a > l.amount && l.source !== "goals" ? "over" : ""}" style="width:${pct}%"></i></span></td></tr>`; });
  if (other) { spent += other; rows.push(`<tr><td>Other</td><td>$0</td><td>${m2(other)}</td></tr>`); }
  $("planBody").innerHTML = rows.join("") || `<tr><td colspan="3"><div class="empty">No plan yet. Tap Edit below to set your pay and categories.</div></td></tr>`;
  $("bIncome").textContent = m2(+B.income || 0);
  $("bSpent").textContent = m2(spent);
  const left = (+B.income || 0) - spent; $("bLeft").textContent = m2(left); $("bLeft").style.color = left < 0 ? "var(--bad)" : "";
  // goals
  const goals = B.goals || [];
  $("goalList").innerHTML = goals.length ? goals.map(g => { const pct = g.target ? Math.min(100, g.saved / g.target * 100) : 0;
    return `<div class="goal"><div class="row between"><b>${esc(g.name)}</b><span class="small"><b class="num">${m2(+g.saved || 0)}</b> <span class="muted">of ${m2(+g.target || 0)}</span></span></div>
      <div class="bar thin"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="row between small muted"><span>${pct >= 100 ? "Goal reached" : m2(Math.max(0, g.target - g.saved)) + " to go"}</span><button type="button" class="x" style="font-size:12px" data-delgoal="${esc(g.id)}">remove</button></div>
      <div class="addrow"><input id="ga-${esc(g.id)}" type="number" min="0" step="1" inputmode="decimal" placeholder="Amount" aria-label="Add to ${esc(g.name)}"><button type="button" class="ghost" data-addgoal="${esc(g.id)}">Add</button><button type="button" class="ghost" data-takegoal="${esc(g.id)}">Take out</button></div></div>`; }).join("")
    : `<div class="empty">No goals yet. Add one below, like an emergency fund or a trip.</div>`;
  // spending
  const curCat = $("expCat").value;
  $("expCat").innerHTML = [...cats, "Other"].map(c => `<option>${esc(c)}</option>`).join("");
  if ([...cats, "Other"].includes(curCat)) $("expCat").value = curCat;
  const ex = S.expenses.filter(x => (x.date || "").slice(0, 7) === S.month).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  $("expList").innerHTML = ex.length ? ex.map(x => `<li><div class="grow"><div><b>${esc(x.note || x.category)}</b></div><div class="small muted">${esc(x.category)} · ${esc(fmtDate(x.date))}</div></div><span class="amt">${m2(+x.amount)}</span><button class="x" data-delexp="${esc(x.id)}" aria-label="Delete entry">×</button></li>`).join("")
    : `<li class="empty">Nothing logged for ${monthLabel(S.month)} yet.</li>`;
  if (!planEditing) { $("planEditor").hidden = true; $("planToggle").textContent = "Edit"; }
}
const budgetRef = () => doc(db, "budgets", S.me);
async function saveGoals(goals) { try { await updateDoc(budgetRef(), { goals }); } catch (er) { fail(er); } }
$("goalForm").onsubmit = async e => {
  e.preventDefault();
  const goals = [...((S.budget || {}).goals || []), { id: uid(), name: $("goalName").value.trim(), target: +$("goalTarget").value, saved: 0 }];
  await saveGoals(goals); e.target.reset(); toast("Goal added");
};
$("goalList").addEventListener("click", async e => {
  const goals = ((S.budget || {}).goals || []).map(g => ({ ...g }));
  const add = e.target.closest("[data-addgoal]"), take = e.target.closest("[data-takegoal]"), del = e.target.closest("[data-delgoal]");
  if (del) { await saveGoals(goals.filter(g => g.id !== del.dataset.delgoal)); return; }
  const id = (add || take || {}).dataset?.addgoal || (take && take.dataset.takegoal); if (!id) return;
  const v = parseFloat($("ga-" + id).value); if (!(v > 0)) return toast("Type an amount first.");
  const g = goals.find(g => g.id === id); if (!g) return;
  const delta = add ? v : -Math.min(v, g.saved || 0);
  g.saved = r2((+g.saved || 0) + delta);
  await saveGoals(goals);
  try { await addDoc(collection(db, "budgets", S.me, "expenses"), { amount: delta, date: iso(today()), category: "Savings", note: (add ? "Saved for " : "Took from ") + g.name, goalId: id, createdAt: Date.now() }); } catch (er) { fail(er); }
  toast(add ? `Added to ${g.name}` : `Took from ${g.name}`);
});
function drawPlanRows() {
  $("planRows").innerHTML = planDraft.lines.map((l, i) => `<div class="planedit"><input id="pn${i}" data-i="${i}" data-k="name" value="${esc(l.name)}" placeholder="Category" aria-label="Category name"><input id="pa${i}" data-i="${i}" data-k="amount" type="number" min="0" step="1" value="${esc(l.amount)}" aria-label="Planned amount"><select id="ps${i}" data-i="${i}" data-k="source" aria-label="Fills from"><option value="">Log by hand</option>${S.me === BORROWER ? `<option value="loan" ${l.source === "loan" ? "selected" : ""}>Loan payments</option>` : ""}<option value="bills" ${l.source === "bills" ? "selected" : ""}>House bills</option><option value="goals" ${l.source === "goals" ? "selected" : ""}>Savings goals</option></select><button type="button" class="x" data-rm="${i}" aria-label="Remove">×</button></div>`).join("");
}
$("planToggle").onclick = () => {
  planEditing = !planEditing; const B = S.budget || {};
  planDraft = { lines: (B.lines || []).map(l => ({ ...l })) };
  $("planIncome").value = +B.income || 0; drawPlanRows();
  $("planEditor").hidden = !planEditing; $("planToggle").textContent = planEditing ? "Cancel" : "Edit";
};
$("planRows").addEventListener("input", e => { const i = e.target.dataset.i; if (i == null) return; const k = e.target.dataset.k; planDraft.lines[i][k] = k === "amount" ? +e.target.value : e.target.value; });
$("planRows").addEventListener("click", e => { const i = e.target.dataset.rm; if (i == null) return; planDraft.lines.splice(+i, 1); drawPlanRows(); });
$("planAdd").onclick = () => { planDraft.lines.push({ name: "", amount: 0, source: "" }); drawPlanRows(); };
$("planSave").onclick = async () => {
  const lines = planDraft.lines.filter(l => l.name.trim()).map(l => ({ name: l.name.trim(), amount: +l.amount || 0, source: l.source || null }));
  try { await updateDoc(budgetRef(), { income: +$("planIncome").value || 0, lines }); planEditing = false; toast("Plan saved"); render(); } catch (er) { fail(er); }
};
$("expForm").onsubmit = async e => {
  e.preventDefault();
  try { await addDoc(collection(db, "budgets", S.me, "expenses"), { amount: +$("expAmt").value, date: $("expDate").value, category: $("expCat").value, note: $("expNote").value.trim(), createdAt: Date.now() }); $("expAmt").value = ""; $("expNote").value = ""; toast("Added"); } catch (er) { fail(er); }
};
$("expList").addEventListener("click", async e => {
  const d = e.target.closest("[data-delexp]"); if (!d) return;
  const x = S.expenses.find(x => x.id === d.dataset.delexp);
  try {
    await deleteDoc(doc(db, "budgets", S.me, "expenses", d.dataset.delexp));
    if (x && x.goalId) { const goals = ((S.budget || {}).goals || []).map(g => g.id === x.goalId ? { ...g, saved: r2(Math.max(0, (+g.saved || 0) - (+x.amount || 0))) } : g); await saveGoals(goals); }
    toast("Deleted");
  } catch (er) { fail(er); }
});

// ---------------- settings ----------------
let handlesDirty = false, loanDirty = false;
["hVenmo", "hPhone"].forEach(id => $(id).addEventListener("input", () => handlesDirty = true));
["lPrincipal", "lWeekly", "lStart", "lEnd"].forEach(id => $(id).addEventListener("input", () => loanDirty = true));
function renderSettings() {
  const m = S.members[S.me] || {};
  if (!handlesDirty) { $("hVenmo").value = m.venmo || ""; $("hPhone").value = m.phone || ""; }
  const admin = S.me === LENDER;
  $("billsAdmin").hidden = !admin; $("loanAdmin").hidden = !admin;
  if (!admin) return;
  $("billAdminList").innerHTML = S.bills.length ? S.bills.map(b => `<li><div class="grow"><b>${esc(b.name)}</b> <span class="co">${esc(b.company || "")}</span><div class="small muted">${b.varies ? "Amount changes monthly" : m2(+b.amount || 0) + " a month"}</div></div>
    <label class="small muted" for="dd-${esc(b.id)}" style="display:flex;align-items:center;gap:6px">Due day<input id="dd-${esc(b.id)}" data-due="${esc(b.id)}" type="number" min="1" max="31" value="${b.dueDay || ""}" style="width:64px;padding:6px"></label>
    <button class="x" data-delbill="${esc(b.id)}" aria-label="Delete ${esc(b.name)}">×</button></li>`).join("") : `<li class="empty">No bills yet.</li>`;
  const L = S.loan || {};
  if (!loanDirty) { $("lPrincipal").value = L.principal || ""; $("lWeekly").value = L.weekly || ""; $("lStart").value = L.start || ""; $("lEnd").value = L.end || ""; }
}
$("handleForm").onsubmit = async e => {
  e.preventDefault();
  try { await setDoc(doc(db, "members", S.me), { venmo: $("hVenmo").value.trim().replace(/^@/, ""), phone: $("hPhone").value.trim() }, { merge: true }); handlesDirty = false; toast("Saved"); } catch (er) { fail(er); }
};
$("billAdminList").addEventListener("change", async e => {
  const id = e.target.dataset.due; if (!id) return;
  try { await updateDoc(doc(db, "bills", id), { dueDay: +e.target.value || null }); toast("Due day saved"); } catch (er) { fail(er); }
});
let armedBill = null;
$("billAdminList").addEventListener("click", async e => {
  const d = e.target.closest("[data-delbill]"); if (!d) return;
  if (armedBill !== d) { armedBill = d; d.textContent = "Delete?"; d.style.fontSize = "13px"; d.style.color = "var(--bad)"; setTimeout(() => { if (armedBill === d) { armedBill = null; d.textContent = "×"; d.style.cssText = ""; } }, 3000); return; }
  armedBill = null;
  try { await deleteDoc(doc(db, "bills", d.dataset.delbill)); toast("Bill deleted"); } catch (er) { fail(er); }
});
$("billForm").onsubmit = async e => {
  e.preventDefault();
  const amt = $("billAmt").value, url = $("billUrl").value.trim();
  try { await addDoc(collection(db, "bills"), { name: $("billName").value.trim(), company: $("billCo").value.trim(), url: /^https:\/\//.test(url) ? url : "", amount: amt === "" ? null : +amt, varies: amt === "", dueDay: +$("billDue").value || null, createdAt: Date.now() }); e.target.reset(); toast("Bill added"); } catch (er) { fail(er); }
};
$("loanForm").onsubmit = async e => {
  e.preventDefault();
  const body = { principal: +$("lPrincipal").value || 0, weekly: +$("lWeekly").value || 0, start: $("lStart").value, end: $("lEnd").value };
  if (!(body.principal > 0 && body.weekly > 0 && body.start)) return toast("Fill in the amount, weekly payment and first payment date.");
  try { await setDoc(doc(db, "loan", "settings"), body); loanDirty = false; toast("Loan terms saved"); } catch (er) { fail(er); }
};

// ---------------- render ----------------
function render() {
  if (!S.me) return;
  renderBills(); renderLoan(); renderBudget(); renderSettings();
}
