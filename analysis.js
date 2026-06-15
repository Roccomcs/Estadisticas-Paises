// Motor de análisis: a partir de los datos crudos de Sofascore calcula
// forma, head-to-head, fortalezas de ataque/defensa y las probabilidades
// de Victoria A / Empate / Victoria B mediante un modelo de Poisson.

const LEAGUE_AVG_GOALS = 1.35; // goles esperados medios por equipo y partido
const HOME_ADVANTAGE = 1.15; // multiplicador de goles esperados al jugar de local

// --- utilidades -----------------------------------------------------------

function resultFor(ev, teamId) {
  const isHome = ev.homeTeam.id === teamId;
  const gf = isHome ? ev.homeScore.current : ev.awayScore.current;
  const ga = isHome ? ev.awayScore.current : ev.homeScore.current;
  let outcome = "D";
  if (gf > ga) outcome = "W";
  else if (gf < ga) outcome = "L";
  return { isHome, gf, ga, outcome, opponentId: isHome ? ev.awayTeam.id : ev.homeTeam.id };
}

// Resumen de la forma reciente con los últimos N partidos.
function buildForm(events, teamId, n = 10) {
  const last = events.slice(0, n);
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  const sequence = [];
  const matches = [];
  for (const ev of last) {
    const r = resultFor(ev, teamId);
    if (r.outcome === "W") w++;
    else if (r.outcome === "D") d++;
    else l++;
    gf += r.gf;
    ga += r.ga;
    sequence.push(r.outcome);
    matches.push({
      date: new Date(ev.startTimestamp * 1000).toISOString().slice(0, 10),
      home: ev.homeTeam.name,
      away: ev.awayTeam.name,
      score: `${ev.homeScore.current}-${ev.awayScore.current}`,
      tournament: ev.tournament?.name || "",
      result: r.outcome,
    });
  }
  const played = last.length || 1;
  return {
    played: last.length,
    w, d, l,
    points: w * 3 + d,
    ppg: (w * 3 + d) / played,
    goalsFor: gf,
    goalsAgainst: ga,
    gfPerMatch: gf / played,
    gaPerMatch: ga / played,
    sequence, // ej: ["W","W","D","L"...] del más reciente al más antiguo
    matches,
  };
}

// Head-to-head: cruza los partidos de A buscando enfrentamientos contra B.
function buildH2H(eventsA, teamAId, teamBId) {
  const direct = eventsA.filter(
    (ev) => ev.homeTeam.id === teamBId || ev.awayTeam.id === teamBId
  );
  let aWins = 0, draws = 0, bWins = 0, aGoals = 0, bGoals = 0;
  const last5 = [];
  for (const ev of direct) {
    const r = resultFor(ev, teamAId);
    if (r.outcome === "W") aWins++;
    else if (r.outcome === "D") draws++;
    else bWins++;
    aGoals += r.gf;
    bGoals += r.ga;
    if (last5.length < 5) {
      last5.push({
        date: new Date(ev.startTimestamp * 1000).toISOString().slice(0, 10),
        home: ev.homeTeam.name,
        away: ev.awayTeam.name,
        score: `${ev.homeScore.current}-${ev.awayScore.current}`,
        tournament: ev.tournament?.name || "",
        official: !/friendly|amistoso/i.test(ev.tournament?.name || ""),
      });
    }
  }
  return {
    played: direct.length,
    aWins, draws, bWins,
    aGoals, bGoals,
    last5,
  };
}

// --- modelo de Poisson ----------------------------------------------------

function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}
function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

// Construye la matriz de marcadores y deriva probabilidades.
function scoreMatrix(lambdaA, lambdaB, maxGoals = 8) {
  let pHome = 0, pDraw = 0, pAway = 0;
  let best = { a: 0, b: 0, p: 0 };
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = poisson(i, lambdaA) * poisson(j, lambdaB);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      if (p > best.p) best = { a: i, b: j, p };
    }
  }
  const total = pHome + pDraw + pAway;
  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total,
    mostLikelyScore: `${best.a}-${best.b}`,
  };
}

// --- cálculo principal ----------------------------------------------------

export function analyzeMatch({
  teamA, teamB,
  eventsA, eventsB,
  h2hEvents, // opcional: lista de cruces directos (formato evento)
  rankA, rankB,
  homeSide, // "A" | "B" | "neutral"
}) {
  const formA = buildForm(eventsA, teamA.id);
  const formB = buildForm(eventsB, teamB.id);
  // Si nos pasan los cruces directos, los usamos; si no, los derivamos de eventsA.
  const h2h = buildH2H(h2hEvents && h2hEvents.length ? h2hEvents : eventsA, teamA.id, teamB.id);

  // Fortalezas relativas (1 = media de la liga). Se mezcla forma reciente
  // con un ajuste por diferencia de ranking FIFA.
  const attackA = clamp(formA.gfPerMatch / LEAGUE_AVG_GOALS, 0.4, 2.5);
  const defenseA = clamp(formA.gaPerMatch / LEAGUE_AVG_GOALS, 0.4, 2.5);
  const attackB = clamp(formB.gfPerMatch / LEAGUE_AVG_GOALS, 0.4, 2.5);
  const defenseB = clamp(formB.gaPerMatch / LEAGUE_AVG_GOALS, 0.4, 2.5);

  // Ajuste por ranking: cada equipo recibe un factor según puntos FIFA.
  let rankFactorA = 1, rankFactorB = 1;
  if (rankA?.points != null && rankB?.points != null) {
    const diff = rankA.points - rankB.points; // >0 favorece a A
    const f = 1 + Math.tanh(diff / 600) * 0.25; // ±25% como máximo
    rankFactorA = f;
    rankFactorB = 2 - f;
  }

  // Goles esperados base por el modelo ataque x defensa rival.
  let lambdaA = attackA * defenseB * LEAGUE_AVG_GOALS * rankFactorA;
  let lambdaB = attackB * defenseA * LEAGUE_AVG_GOALS * rankFactorB;

  // Ventaja de localía.
  if (homeSide === "A") lambdaA *= HOME_ADVANTAGE;
  else if (homeSide === "B") lambdaB *= HOME_ADVANTAGE;

  // Pequeño ajuste por historial directo (si hay muestra suficiente).
  if (h2h.played >= 3) {
    const total = h2h.aWins + h2h.draws + h2h.bWins;
    const dominanceA = (h2h.aWins - h2h.bWins) / total; // -1..1
    lambdaA *= 1 + dominanceA * 0.1;
    lambdaB *= 1 - dominanceA * 0.1;
  }

  lambdaA = clamp(lambdaA, 0.2, 5);
  lambdaB = clamp(lambdaB, 0.2, 5);

  const probs = scoreMatrix(lambdaA, lambdaB);

  // Confianza del modelo según cantidad de datos disponibles.
  let dataPoints = 0;
  if (formA.played >= 8) dataPoints++;
  if (formB.played >= 8) dataPoints++;
  if (h2h.played >= 3) dataPoints++;
  if (rankA?.points != null && rankB?.points != null) dataPoints++;
  const confidence = dataPoints >= 4 ? "Alta" : dataPoints >= 2 ? "Media" : "Baja";

  // Factor decisivo: el de mayor desequilibrio.
  const decisive = pickDecisiveFactor({ formA, formB, h2h, rankA, rankB, homeSide, teamA, teamB });

  return {
    teams: {
      A: { id: teamA.id, name: teamA.name, country: teamA.country?.name },
      B: { id: teamB.id, name: teamB.name, country: teamB.country?.name },
    },
    ranking: {
      A: rankA || null,
      B: rankB || null,
    },
    form: { A: formA, B: formB },
    h2h,
    expectedGoals: { A: Number(lambdaA.toFixed(2)), B: Number(lambdaB.toFixed(2)) },
    probabilities: {
      winA: Math.round(probs.home * 100),
      draw: Math.round(probs.draw * 100),
      winB: Math.round(probs.away * 100),
    },
    mostLikelyScore: probs.mostLikelyScore,
    decisiveFactor: decisive,
    confidence,
    homeSide,
  };
}

function pickDecisiveFactor({ formA, formB, h2h, rankA, rankB, homeSide, teamA, teamB }) {
  const candidates = [];
  if (rankA?.points != null && rankB?.points != null) {
    const diff = Math.abs(rankA.points - rankB.points);
    candidates.push({
      weight: diff / 100,
      text: `Diferencia de ranking FIFA de ${diff.toFixed(0)} puntos a favor de ${
        rankA.points > rankB.points ? teamA.name : teamB.name
      }.`,
    });
  }
  const ppgDiff = Math.abs(formA.ppg - formB.ppg);
  candidates.push({
    weight: ppgDiff * 2,
    text: `Forma reciente: ${
      formA.ppg > formB.ppg ? teamA.name : teamB.name
    } llega mejor (${Math.max(formA.ppg, formB.ppg).toFixed(2)} pts/partido vs ${Math.min(
      formA.ppg,
      formB.ppg
    ).toFixed(2)}).`,
  });
  if (h2h.played >= 3 && h2h.aWins !== h2h.bWins) {
    candidates.push({
      weight: Math.abs(h2h.aWins - h2h.bWins),
      text: `Historial directo favorable a ${
        h2h.aWins > h2h.bWins ? teamA.name : teamB.name
      } (${h2h.aWins}-${h2h.draws}-${h2h.bWins} en ${h2h.played} cruces).`,
    });
  }
  if (homeSide === "A" || homeSide === "B") {
    candidates.push({
      weight: 1.2,
      text: `Ventaja de localía para ${homeSide === "A" ? teamA.name : teamB.name}.`,
    });
  }
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0]?.text || "Sin un factor claramente dominante.";
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}
