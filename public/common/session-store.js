// Session-local tournament bracket and match standings.
// Page-local only (localStorage): no server, no accounts, no history beyond this
// browser session. The agent's tournament tools wrap these functions.
const KEY = "pcg-session-v1";

function freshState() {
  return { version: 1, tournament: null, matches: [] };
}

function memoryStore() {
  let state = freshState();
  return {
    load() {
      return structuredClone(state);
    },
    save(next) {
      state = structuredClone(next);
    },
  };
}

function browserStore() {
  return {
    load() {
      try {
        const raw = globalThis.localStorage.getItem(KEY);
        if (!raw) {
          return freshState();
        }
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.matches)) {
          return freshState();
        }
        return parsed;
      } catch {
        return freshState();
      }
    },
    save(next) {
      try {
        globalThis.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode, quota): keep the in-memory copy.
        memoryFallback.save(next);
      }
    },
  };
}

const memoryFallback = memoryStore();

function getStore() {
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage !== null) {
      return browserStore();
    }
  } catch {
    // Fall through to memory.
  }
  return memoryFallback;
}

// --- Pure bracket logic (no storage, no DOM): testable in Node. ---

// Build round 1 from a player list. Pads to a power of two with byes (null
// opponent): a bye advances its player automatically.
export function buildRounds(players) {
  const size = Math.max(2, 2 ** Math.ceil(Math.log2(players.length)));
  const slots = [...players];
  while (slots.length < size) {
    slots.push(null);
  }
  const round = [];
  for (let i = 0; i < size; i += 2) {
    round.push({ a: slots[i], b: slots[i + 1], winner: null, score: null });
  }
  // Auto-advance byes: a match with one null side is won by the other side.
  for (const match of round) {
    if (match.a && !match.b) {
      match.winner = match.a;
    } else if (!match.a && match.b) {
      match.winner = match.b;
    }
  }
  return [round];
}

export function currentMatchIndex(tournament) {
  const round = tournament.rounds[tournament.rounds.length - 1];
  return round.findIndex((m) => !m.winner);
}

export function createTournamentState(game, players) {
  return {
    game,
    players: [...players],
    format: "single-elimination",
    rounds: buildRounds(players),
    champion: null,
    created_at: new Date().toISOString(),
  };
}

// Record a result for the current match. Returns {tournament} or {ok:false, reason}.
export function recordResult(tournament, winner, score) {
  if (tournament.champion) {
    return { ok: false, reason: "토너먼트가 이미 끝났습니다. 우승자는 " + tournament.champion + "입니다." };
  }
  const round = tournament.rounds[tournament.rounds.length - 1];
  const idx = round.findIndex((m) => !m.winner);
  if (idx === -1) {
    return { ok: false, reason: "진행 중인 매치가 없습니다." };
  }
  const match = round[idx];
  if (winner !== match.a && winner !== match.b) {
    return { ok: false, reason: winner + " 선수는 현재 매치(" + match.a + " 대 " + match.b + ")에 없습니다." };
  }
  match.winner = winner;
  match.score = score || null;
  if (round.every((m) => m.winner)) {
    const winners = round.map((m) => m.winner);
    if (winners.length === 1) {
      tournament.champion = winners[0];
    } else {
      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        next.push({ a: winners[i], b: winners[i + 1] ?? null, winner: null, score: null });
      }
      for (const m of next) {
        if (m.a && !m.b) {
          m.winner = m.a;
        }
      }
      tournament.rounds.push(next);
    }
  }
  return { tournament };
}

export function standingsFromMatches(matches, game) {
  const filtered = game ? matches.filter((m) => m.game === game) : matches;
  const table = new Map();
  for (const m of filtered) {
    if (!table.has(m.winner)) {
      table.set(m.winner, { player: m.winner, wins: 0, games: 0 });
    }
    table.get(m.winner).wins += 1;
  }
  for (const m of filtered) {
    for (const p of m.players || []) {
      if (!table.has(p)) {
        table.set(p, { player: p, wins: 0, games: 0 });
      }
      table.get(p).games += 1;
    }
  }
  return [...table.values()].sort((a, b) => b.wins - a.wins || a.player.localeCompare(b.player));
}

// --- Store wrapper (storage + validation). ---

export const sessionStore = {
  load() {
    return getStore().load();
  },

  save(state) {
    getStore().save(state);
  },

  getTournament() {
    return this.load().tournament;
  },

  getStandings(game) {
    const state = this.load();
    return { matches: game ? state.matches.filter((m) => m.game === game) : state.matches, standings: standingsFromMatches(state.matches, game) };
  },

  createTournament(game, players) {
    const state = this.load();
    state.tournament = createTournamentState(game, players);
    this.save(state);
    return state.tournament;
  },

  // Records the current match result and appends it to session match history.
  recordMatchResult(winner, score) {
    const state = this.load();
    if (!state.tournament) {
      return { ok: false, reason: "진행 중인 토너먼트가 없습니다. 먼저 토너먼트를 만들어 주세요." };
    }
    const round = state.tournament.rounds[state.tournament.rounds.length - 1];
    const current = round.find((m) => !m.winner);
    const players = current ? [current.a, current.b].filter(Boolean) : [];
    const out = recordResult(state.tournament, winner, score);
    if (out.ok === false) {
      return out;
    }
    state.matches.push({
      game: state.tournament.game,
      winner,
      players,
      score: score || null,
      at: new Date().toISOString(),
    });
    this.save(state);
    return { tournament: state.tournament };
  },

  clear() {
    this.save(freshState());
  },
};
