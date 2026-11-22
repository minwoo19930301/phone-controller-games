// Lobby page module. Exports the page object the assistant's actions wrap, so the
// assistant and the page share one set of rules. Loaded by public/index.html as a
// module, and imported by site-actions.js from the same URL (no ?v= query), so
// both see the same module instance and state.
import gamesData from "./common/games.json" with { type: "json" };
import { sessionStore } from "./common/session-store.js";

const GAMES = gamesData.games;

function findGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

function catalogEntry(game) {
  return {
    id: game.id,
    title_ko: game.title_ko,
    title_en: game.title_en,
    players_min: game.players_min,
    players_max: game.players_max,
    team: game.team,
    split_screen: game.split_screen,
    modes: game.modes,
    play_url: game.play_url,
    preview: game.preview,
    vibe: game.vibe,
  };
}

/**
 * The lobby's page object. On the lobby there is no room and no match in
 * progress, so room reads refuse honestly and game-page-only writes refuse
 * with a reason. Game pages get their own page module in the next phase.
 */
class LobbyPage {
  getState() {
    return {
      on_game_page: false,
      room_code: null,
      game: null,
      phase: "lobby",
      players: [],
      max: null,
      ready: null,
      tournament: sessionStore.getTournament(),
    };
  }

  catalogIds() {
    return GAMES.map((g) => g.id);
  }

  getCatalog({ players, vibe } = {}) {
    let list = GAMES.map(catalogEntry);
    if (typeof players === "number") {
      list = list.filter((g) => g.players_min <= players && players <= g.players_max);
    }
    if (vibe) {
      list = list.filter((g) => g.vibe.includes(vibe));
    }
    return { games: list };
  }

  getRules(game) {
    const found = findGame(game);
    if (!found) {
      return { ok: false, reason: "알 수 없는 게임입니다: " + game };
    }
    return {
      id: found.id,
      title: found.title_ko,
      title_en: found.title_en,
      play_url: found.play_url,
      player_count: found.rules.player_count,
      ...found.rules,
    };
  }

  async getServerStatus() {
    try {
      const res = await fetch("/api/load", { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        return { ok: false, reason: "서버가 응답하지 않습니다. 무료 서버가 잠들어 있으면 약 1분 뒤 다시 시도해 주세요." };
      }
      const data = await res.json();
      return {
        server_origin: typeof window !== "undefined" ? window.location.origin : null,
        active_rooms: data.activeRooms ?? data.active_rooms ?? null,
        awake: true,
      };
    } catch {
      return { ok: false, reason: "서버에 닿지 않습니다. 무료 서버가 잠들어 있으면 약 1분 뒤 다시 시도해 주세요." };
    }
  }

  getRoomState() {
    return { ok: false, reason: "지금은 로비입니다. 방 정보는 게임 페이지에서 볼 수 있어요. 먼저 게임을 열어 주세요." };
  }

  getJoinInfo() {
    return { ok: false, reason: "지금은 로비라 참가할 방이 없습니다. 게임을 열면 방 코드와 QR이 생깁니다." };
  }

  getLatestClip() {
    return { clip: null, reason: "로비에서는 클립이 없습니다. 오케스트라 녹음이나 네컷 사진은 게임 페이지에서 만들 수 있어요." };
  }

  getSessionStandings(game) {
    if (game && !findGame(game)) {
      return { ok: false, reason: "알 수 없는 게임입니다: " + game };
    }
    return sessionStore.getStandings(game);
  }

  getTournament() {
    const tournament = sessionStore.getTournament();
    return tournament ? { tournament } : { tournament: null };
  }

  // A lobby has no match in progress, so the open-game check always passes here.
  // Game pages add the real check in the next phase.
  checkOpenGame(game) {
    if (!findGame(game)) {
      return { ok: false, reason: "알 수 없는 게임입니다: " + game };
    }
    return { ok: true };
  }

  openGame(game) {
    const check = this.checkOpenGame(game);
    if (!check.ok) {
      return check;
    }
    const found = findGame(game);
    if (typeof window !== "undefined" && window.location) {
      window.location.assign(found.play_url);
    }
    return { opened: game, play_url: found.play_url };
  }

  addPracticeBots() {
    return { ok: false, reason: "봇은 게임 페이지에서 추가할 수 있어요. 먼저 게임을 열어 주세요." };
  }

  createTournament({ game, players, format }) {
    if (!findGame(game)) {
      return { ok: false, reason: "알 수 없는 게임입니다: " + game };
    }
    if (format && format !== "single-elimination") {
      return { ok: false, reason: "지원하는 토너먼트 형식은 single-elimination(싱글 엘리미네이션)뿐입니다." };
    }
    const names = [...new Set(players.map((p) => String(p).trim()).filter(Boolean))];
    if (names.length < 2) {
      return { ok: false, reason: "토너먼트에는 최소 2명의 선수가 필요합니다." };
    }
    if (names.length > 8) {
      return { ok: false, reason: "토너먼트는 최대 8명까지 가능합니다." };
    }
    if (names.length !== players.length) {
      return { ok: false, reason: "선수 이름이 중복되거나 비어 있습니다." };
    }
    return { tournament: sessionStore.createTournament(game, names) };
  }

  recordMatchResult({ winner, score }) {
    return sessionStore.recordMatchResult(winner, score);
  }
}

export const App = {
  page: new LobbyPage(),
};
