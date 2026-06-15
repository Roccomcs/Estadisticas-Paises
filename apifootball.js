// Cliente de API-Football (api-sports.io). Adapta las respuestas al formato
// interno de "evento" que consume analysis.js, para reusar el motor de Poisson.
import { API_KEY, API_HOST } from "./config.js";

const BASE = `https://${API_HOST}`;

const cache = new Map();
const TTL_MS = 1000 * 60 * 30;

// --- limitador de peticiones (plan gratuito: 10 por minuto) ----------------
// Encolamos y espaciamos las llamadas para no superar el límite, con una
// cota algo conservadora (9/min) y reintento automático ante un 429.
const MAX_PER_MIN = 9;
const WINDOW_MS = 60 * 1000;
const recent = []; // timestamps de las últimas peticiones reales
let chain = Promise.resolve(); // serializa el acceso al limitador

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const now = Date.now();
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_MIN) {
    const wait = WINDOW_MS - (now - recent[0]) + 50;
    await sleep(wait);
    return throttle();
  }
  recent.push(Date.now());
}

async function rawFetch(url) {
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (res.status === 429) {
    await sleep(WINDOW_MS / 2); // esperar y reintentar una vez
    return rawFetch(url);
  }
  return res;
}

async function getJSON(path) {
  if (!API_KEY) {
    const e = new Error(
      "Falta la API key. Creá el archivo api-key.txt con tu clave de API-Football."
    );
    e.status = 401;
    throw e;
  }
  const url = BASE + path;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.data;

  // Encadenamos para que el limitador procese una petición por vez.
  const run = chain.then(async () => {
    await throttle();
    return rawFetch(url);
  });
  chain = run.catch(() => {});
  const res = await run;

  if (!res.ok) {
    const e = new Error(`API-Football ${res.status} en ${path}`);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length) {
    const msg = Object.values(data.errors).join("; ");
    const e = new Error("API-Football: " + msg);
    e.status = 400;
    throw e;
  }
  cache.set(url, { t: Date.now(), data });
  return data;
}

// Convierte un fixture de API-Football al formato interno de evento.
function mapFixture(fx) {
  const finished = ["FT", "AET", "PEN"].includes(fx.fixture.status.short);
  return {
    id: fx.fixture.id,
    startTimestamp: fx.fixture.timestamp,
    status: { type: finished ? "finished" : "notstarted" },
    tournament: { name: fx.league?.name || "" },
    homeTeam: { id: fx.teams.home.id, name: fx.teams.home.name },
    awayTeam: { id: fx.teams.away.id, name: fx.teams.away.name },
    homeScore: { current: fx.goals.home ?? 0 },
    awayScore: { current: fx.goals.away ?? 0 },
  };
}

export async function searchTeams(query) {
  const data = await getJSON(`/teams?search=${encodeURIComponent(query)}`);
  return (data.response || []).map((r) => ({
    id: r.team.id,
    name: r.team.name,
    country: r.team.country || null,
    national: !!r.team.national,
  }));
}

export async function getTeam(id) {
  const data = await getJSON(`/teams?id=${id}`);
  const t = data.response?.[0]?.team;
  if (!t) throw new Error("Equipo no encontrado: " + id);
  return { id: t.id, name: t.name, country: { name: t.country } };
}

// Deduce nombre/país de un equipo a partir de partidos ya descargados,
// para evitar una petición extra a /teams.
export function teamFromEvents(id, ...eventLists) {
  for (const list of eventLists) {
    for (const ev of list || []) {
      if (ev.homeTeam.id === id) return { id, name: ev.homeTeam.name, country: {} };
      if (ev.awayTeam.id === id) return { id, name: ev.awayTeam.name, country: {} };
    }
  }
  return null;
}

// El plan gratuito no admite el parámetro `last`, sólo `season` (temporadas
// 2021-2023). Juntamos varias temporadas para reunir partidos suficientes.
const SEASONS = [2022, 2021, 2023];

export async function getLastEvents(teamId, count = 10) {
  const all = [];
  const seen = new Set();
  for (const season of SEASONS) {
    let data;
    try {
      data = await getJSON(`/fixtures?team=${teamId}&season=${season}`);
    } catch {
      continue;
    }
    for (const fx of data.response || []) {
      const ev = mapFixture(fx);
      if (ev.status.type === "finished" && !seen.has(ev.id)) {
        seen.add(ev.id);
        all.push(ev);
      }
    }
    if (all.length >= count) break; // ya tenemos suficientes
  }
  return all.sort((a, b) => b.startTimestamp - a.startTimestamp).slice(0, count);
}

export async function getH2HEvents(idA, idB, count = 10) {
  const data = await getJSON(`/fixtures/headtohead?h2h=${idA}-${idB}`);
  return (data.response || [])
    .map(mapFixture)
    .filter((ev) => ev.status.type === "finished")
    .sort((a, b) => b.startTimestamp - a.startTimestamp)
    .slice(0, count);
}
