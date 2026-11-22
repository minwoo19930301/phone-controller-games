// Agentify smoke tests: the 12 website_* tools on the lobby page.
// Run with: node --test scripts/test-agentify.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { registerActions } from "../public/site-actions.js";
import { sessionStore } from "../public/common/session-store.js";

const MANIFEST_TOOLS = [
  "get_game_catalog",
  "get_game_rules",
  "get_room_state",
  "get_server_status",
  "get_join_info",
  "get_session_standings",
  "get_tournament",
  "get_latest_clip",
  "open_game",
  "add_practice_bots",
  "create_tournament",
  "record_match_result",
];

function registeredTools() {
  const defs = new Map();
  registerActions({ register: (def) => defs.set(def.name, def) });
  return defs;
}

test("every manifest tool is registered and local-only", () => {
  const defs = registeredTools();
  assert.deepEqual([...defs.keys()].sort(), [...MANIFEST_TOOLS].sort());
  for (const def of defs.values()) {
    assert.equal(def.availability, undefined, `${def.name} must be local-only`);
    assert.ok(["read", "write", "irreversible"].includes(def.effect), def.name);
    assert.equal(def.inputSchema.additionalProperties, false, def.name);
  }
});

test("get_game_catalog lists 15 real games and filters", async () => {
  const defs = registeredTools();
  const all = await defs.get("get_game_catalog").execute({});
  assert.equal(all.games.length, 15);
  assert.ok(all.games.every((g) => g.id && g.play_url && g.title_ko));
  const eight = await defs.get("get_game_catalog").execute({ players: 8 });
  assert.deepEqual(eight.games.map((g) => g.id).sort(), ["gun", "tugofwar"]);
  const music = await defs.get("get_game_catalog").execute({ vibe: "music" });
  assert.deepEqual(music.games.map((g) => g.id).sort(), ["orchestra", "rhythm"]);
  const none = await defs.get("get_game_catalog").execute({ players: 8, vibe: "music" });
  assert.equal(none.games.length, 0);
});

test("get_game_rules returns grounded rules, refuses unknown games", async () => {
  const defs = registeredTools();
  const bowling = await defs.get("get_game_rules").execute({ game: "bowling" });
  assert.equal(bowling.title, "볼링");
  assert.match(bowling.win_condition, /총점/);
  assert.match(bowling.scoring, /텐핀/);
  const unknown = await defs.get("get_game_rules").execute({ game: "chess" });
  assert.equal(unknown.ok, false);
});

test("lobby room reads refuse honestly", async () => {
  const defs = registeredTools();
  const room = await defs.get("get_room_state").execute({});
  assert.equal(room.ok, false);
  assert.match(room.reason, /로비/);
  const join = await defs.get("get_join_info").execute({});
  assert.equal(join.ok, false);
  const clip = await defs.get("get_latest_clip").execute({});
  assert.equal(clip.clip, null);
});

test("open_game returns the target without a browser; bots refuse on the lobby", async () => {
  const defs = registeredTools();
  const opened = await defs.get("open_game").execute({ game: "archery" });
  assert.equal(opened.play_url, "/archery/");
  const bad = await defs.get("open_game").execute({ game: "chess" });
  assert.equal(bad.ok, false);
  const bots = await defs.get("add_practice_bots").execute({ count: 2 });
  assert.equal(bots.ok, false);
  assert.match(bots.reason, /게임 페이지/);
});

test("tournament flow: create, play, champion, standings", async () => {
  sessionStore.clear();
  const defs = registeredTools();
  const created = await defs.get("create_tournament").execute({
    game: "pingpong",
    players: ["민우", "수민", "영일", "지훈"],
  });
  assert.equal(created.tournament.rounds[0].length, 2);
  assert.equal(created.tournament.champion, null);

  // A non-player cannot win the current match.
  const bad = await defs.get("record_match_result").execute({ winner: "낯선사람" });
  assert.equal(bad.ok, false);

  const semi1 = await defs.get("record_match_result").execute({ winner: "민우", score: "7-5" });
  assert.equal(semi1.tournament.rounds[0][0].winner, "민우");
  const semi2 = await defs.get("record_match_result").execute({ winner: "영일", score: "7-3" });
  assert.equal(semi2.tournament.rounds.length, 2);
  assert.equal(semi2.tournament.rounds[1][0].a, "민우");
  assert.equal(semi2.tournament.rounds[1][0].b, "영일");
  const final = await defs.get("record_match_result").execute({ winner: "민우", score: "7-6" });
  assert.equal(final.tournament.champion, "민우");

  const done = await defs.get("record_match_result").execute({ winner: "영일" });
  assert.equal(done.ok, false);

  const standings = await defs.get("get_session_standings").execute({});
  const minwoo = standings.standings.find((s) => s.player === "민우");
  assert.equal(minwoo.wins, 2);
  assert.equal(minwoo.games, 2);
  const pingpongOnly = await defs.get("get_session_standings").execute({ game: "pingpong" });
  assert.equal(pingpongOnly.matches.length, 3);
  const golfOnly = await defs.get("get_session_standings").execute({ game: "golf" });
  assert.equal(golfOnly.matches.length, 0);
});

test("create_tournament validates players", async () => {
  sessionStore.clear();
  const defs = registeredTools();
  const one = await defs.get("create_tournament").execute({ game: "bowling", players: ["혼자"] });
  assert.equal(one.ok, false);
  const dup = await defs.get("create_tournament").execute({ game: "bowling", players: ["민우", "민우"] });
  assert.equal(dup.ok, false);
  const badGame = await defs.get("create_tournament").execute({ game: "chess", players: ["a", "b"] });
  assert.equal(badGame.ok, false);
});
