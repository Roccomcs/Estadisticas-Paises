import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import {
  searchTeams,
  getTeam,
  teamFromEvents,
  getLastEvents,
  getH2HEvents,
} from "./apifootball.js";
import { analyzeMatch } from "./analysis.js";
import { API_KEY } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// Indica al frontend si la clave está configurada.
app.get("/api/status", (req, res) => {
  res.json({ hasKey: !!API_KEY });
});

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (q.length < 3) return res.json({ results: [] });
  try {
    res.json({ results: await searchTeams(q) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.get("/api/analyze", async (req, res) => {
  const idA = Number(req.query.a);
  const idB = Number(req.query.b);
  const homeSide = ["A", "B", "neutral"].includes(req.query.home)
    ? req.query.home
    : "neutral";

  if (!idA || !idB || idA === idB) {
    return res.status(400).json({ error: "Indicá dos equipos distintos." });
  }

  try {
    // El limitador serializa internamente; pedimos sólo lo imprescindible.
    const [eventsA, eventsB, h2hEvents] = await Promise.all([
      getLastEvents(idA, 10),
      getLastEvents(idB, 10),
      getH2HEvents(idA, idB, 10),
    ]);

    // Nombres deducidos de los partidos; si no aparecen, consultamos /teams.
    let teamA = teamFromEvents(idA, eventsA, h2hEvents);
    let teamB = teamFromEvents(idB, eventsB, h2hEvents);
    if (!teamA) teamA = await getTeam(idA);
    if (!teamB) teamB = await getTeam(idB);

    const result = analyzeMatch({
      teamA,
      teamB,
      eventsA,
      eventsB,
      h2hEvents,
      rankA: null,
      rankB: null,
      homeSide,
    });

    res.json(result);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  if (!API_KEY) {
    console.log("⚠️  Sin API key: creá api-key.txt con tu clave de API-Football.");
  }
});
