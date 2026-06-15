// Estado de la selección de equipos.
const state = { A: null, B: null, home: "neutral" };

const el = (id) => document.getElementById(id);

// --- buscador con autocompletado -----------------------------------------

function setupSearch(side) {
  const input = el("search" + side);
  const list = el("sugg" + side);
  let timer;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) {
      list.classList.remove("show");
      return;
    }
    timer = setTimeout(() => fetchSuggestions(q, side, list), 550);
  });

  document.addEventListener("click", (e) => {
    if (!list.contains(e.target) && e.target !== input) list.classList.remove("show");
  });
}

async function fetchSuggestions(q, side, list) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    list.innerHTML = "";
    if (!data.results || data.results.length === 0) {
      list.classList.remove("show");
      return;
    }
    data.results.slice(0, 8).forEach((team) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${team.national ? "🏳️ " : ""}${team.name}</span>
        <span class="flag">${team.country || ""}</span>`;
      li.addEventListener("click", () => chooseTeam(side, team));
      list.appendChild(li);
    });
    list.classList.add("show");
  } catch {
    list.classList.remove("show");
  }
}

function chooseTeam(side, team) {
  state[side] = team;
  el("chosen" + side).textContent = `✓ ${team.name}`;
  el("search" + side).value = team.name;
  el("sugg" + side).classList.remove("show");
  updateButton();
}

function updateButton() {
  el("analyzeBtn").disabled = !(state.A && state.B);
}

// --- toggle de localía ----------------------------------------------------

function setupHomeToggle() {
  const btns = el("homeToggle").querySelectorAll("button");
  btns.forEach((b) => {
    b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.home = b.dataset.home;
    });
  });
  // default: cancha neutral
  btns.forEach((x) => x.classList.remove("active"));
  el("homeToggle").querySelector('[data-home="neutral"]').classList.add("active");
}

// --- análisis -------------------------------------------------------------

el("analyzeBtn").addEventListener("click", runAnalysis);

async function runAnalysis() {
  const status = el("status");
  const results = el("results");
  results.classList.add("hidden");
  status.className = "status";
  status.textContent = "⏳ Consultando datos y calculando probabilidades...";

  try {
    const url = `/api/analyze?a=${state.A.id}&b=${state.B.id}&home=${state.home}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al analizar.");
    status.textContent = "";
    render(data);
    results.classList.remove("hidden");
    results.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    status.className = "status error";
    status.textContent = "⚠️ " + e.message;
  }
}

// --- render ---------------------------------------------------------------

function render(d) {
  const A = d.teams.A.name, B = d.teams.B.name;
  const p = d.probabilities;

  el("results").innerHTML = `
    ${cardResult(d, A, B, p)}
    ${cardH2H(d, A, B)}
    <div class="grid2">
      ${cardForm("Forma · " + A, d.form.A)}
      ${cardForm("Forma · " + B, d.form.B)}
    </div>
    ${cardRanking(d, A, B)}
  `;
}

function cardResult(d, A, B, p) {
  const homeTxt =
    d.homeSide === "A" ? `${A} (local)` :
    d.homeSide === "B" ? `${B} (local)` : "Cancha neutral";
  return `
  <div class="card">
    <div class="headline">
      <div><div class="team-name" style="color:var(--accentA)">${A}</div></div>
      <div>
        <div class="score">${d.mostLikelyScore}</div>
        <div class="small">marcador más probable</div>
      </div>
      <div><div class="team-name" style="color:var(--accentB)">${B}</div></div>
    </div>

    <div class="prob-bar">
      <div class="pa" style="flex-basis:${p.winA}%">${p.winA}%</div>
      <div class="pd" style="flex-basis:${p.draw}%">${p.draw}%</div>
      <div class="pb" style="flex-basis:${p.winB}%">${p.winB}%</div>
    </div>
    <div class="prob-legend">
      <span>● Gana ${A}: <b>${p.winA}%</b></span>
      <span>● Empate: <b>${p.draw}%</b></span>
      <span>● Gana ${B}: <b>${p.winB}%</b></span>
    </div>

    <table style="margin-top:16px">
      <tr><th>Goles esperados (xG modelo)</th><td>${A}: <b>${d.expectedGoals.A}</b> — ${B}: <b>${d.expectedGoals.B}</b></td></tr>
      <tr><th>Contexto</th><td>${homeTxt}</td></tr>
      <tr><th>Factor decisivo</th><td class="decisive">${d.decisiveFactor}</td></tr>
      <tr><th>Confianza del modelo</th><td><span class="badge ${d.confidence}">${d.confidence}</span></td></tr>
    </table>
  </div>`;
}

function cardH2H(d, A, B) {
  const h = d.h2h;
  if (!h.played) {
    return `<div class="card"><h2>Historial directo</h2><p style="color:var(--muted)">Sin enfrentamientos recientes encontrados en la base de datos.</p></div>`;
  }
  const rows = h.last5.map((m) => `
    <tr>
      <td>${m.date}</td>
      <td>${m.home} ${m.score} ${m.away}</td>
      <td>${m.official ? "Oficial" : "Amistoso"}</td>
    </tr>`).join("");
  return `
  <div class="card">
    <h2>Historial directo (${h.played} cruces)</h2>
    <p style="margin-bottom:12px">
      <b style="color:var(--accentA)">${A}: ${h.aWins}</b> ·
      Empates: ${h.draws} ·
      <b style="color:var(--accentB)">${B}: ${h.bWins}</b>
      &nbsp;|&nbsp; Goles: ${h.aGoals}-${h.bGoals}
    </p>
    <table>
      <tr><th>Fecha</th><th>Resultado</th><th>Tipo</th></tr>
      ${rows}
    </table>
  </div>`;
}

function cardForm(title, f) {
  const seq = f.sequence.map((r) => `<span class="${r}">${r}</span>`).join("");
  return `
  <div class="card">
    <h2>${title}</h2>
    <div class="seq" style="margin-bottom:12px">${seq || "—"}</div>
    <table>
      <tr><th>Partidos</th><td>${f.played}</td></tr>
      <tr><th>V-E-D</th><td>${f.w}-${f.d}-${f.l}</td></tr>
      <tr><th>Puntos/partido</th><td>${f.ppg.toFixed(2)}</td></tr>
      <tr><th>Goles a favor (prom)</th><td>${f.gfPerMatch.toFixed(2)}</td></tr>
      <tr><th>Goles en contra (prom)</th><td>${f.gaPerMatch.toFixed(2)}</td></tr>
    </table>
  </div>`;
}

function cardRanking(d, A, B) {
  const ra = d.ranking.A, rb = d.ranking.B;
  if (!ra && !rb) return "";
  const cell = (r) => r ? `#${r.ranking} · ${Math.round(r.points)} pts` : "Sin dato";
  return `
  <div class="card">
    <h2>Ranking FIFA</h2>
    <table>
      <tr><th>${A}</th><td>${cell(ra)}</td></tr>
      <tr><th>${B}</th><td>${cell(rb)}</td></tr>
    </table>
  </div>`;
}

// --- aviso de configuración ----------------------------------------------
async function checkKey() {
  try {
    const r = await fetch("/api/status");
    const d = await r.json();
    if (!d.hasKey) {
      const s = el("status");
      s.className = "status error";
      s.innerHTML = "⚙️ Falta configurar la API key. Creá el archivo " +
        "<b>api-key.txt</b> en la carpeta del proyecto con tu clave gratuita de " +
        "<a href='https://www.api-football.com/' target='_blank' style='color:var(--accentA)'>API-Football</a> y reiniciá el servidor.";
    }
  } catch {}
}

// --- init -----------------------------------------------------------------
setupSearch("A");
setupSearch("B");
setupHomeToggle();
checkKey();
