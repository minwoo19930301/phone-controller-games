// Registers this website's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
//
// Every action wraps the lobby page object (lobby.js), so the assistant and the
// page share one set of rules. Operations return {ok: false, reason} when they
// refuse input, before changing anything, and throw only on unexpected failures.
import { App } from "./lobby.js";

const GAME_IDS = App.page.catalogIds();

class SiteActions {
  static registerActions(actions) {
    actions.register(SiteActions.getGameCatalogAction());
    actions.register(SiteActions.getGameRulesAction());
    actions.register(SiteActions.getRoomStateAction());
    actions.register(SiteActions.getServerStatusAction());
    actions.register(SiteActions.getJoinInfoAction());
    actions.register(SiteActions.getSessionStandingsAction());
    actions.register(SiteActions.getTournamentAction());
    actions.register(SiteActions.getLatestClipAction());
    actions.register(SiteActions.openGameAction());
    actions.register(SiteActions.addPracticeBotsAction());
    actions.register(SiteActions.createTournamentAction());
    actions.register(SiteActions.recordMatchResultAction());
  }

  static getGameCatalogAction() {
    return {
      name: "get_game_catalog",
      description: "List the motion games on this site, with player counts, modes, play URLs and vibes. Call it before recommending a game. Filter by players (how many people play) and/or vibe (active, chill, party, music, creative). Returns only real games from the site catalog.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          players: {
            type: "integer",
            minimum: 1,
            maximum: 8,
            description: "How many people want to play. Only games that fit that count are returned.",
          },
          vibe: {
            type: "string",
            enum: ["active", "chill", "party", "music", "creative"],
            description: "The mood the group wants: active (move a lot), chill (relaxed), party (loud group fun), music (rhythm and instruments), creative (make something).",
          },
        },
        additionalProperties: false,
      },
      execute: (args) => App.page.getCatalog(args),
    };
  }

  static getGameRulesAction() {
    return {
      name: "get_game_rules",
      description: "Read the rules of one game: how to play, phone controls, scoring, win condition and tips. Call it with a game id from website_get_game_catalog before explaining a game. Returns ok false for an unknown game.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["game"],
        properties: {
          game: {
            type: "string",
            enum: GAME_IDS,
            description: "Game id from website_get_game_catalog.",
          },
        },
      },
      execute: (args) => App.page.getRules(args.game),
    };
  }

  static getRoomStateAction() {
    return {
      name: "get_room_state",
      description: "Read the current room on this page: room code, game, phase, players and who is ready. Call it before saying anything about the current room. On the lobby there is no room, so it returns ok false with a reason.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => App.page.getRoomState(),
    };
  }

  static getServerStatusAction() {
    return {
      name: "get_server_status",
      description: "Check whether this game server is awake and how many rooms are active right now. The server is on a free tier and can take about a minute to wake up after idle time; if the read fails, say so instead of inventing a status.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => App.page.getServerStatus(),
    };
  }

  static getJoinInfoAction() {
    return {
      name: "get_join_info",
      description: "Get the join information for the current room: room code, join URL and QR code. Call it when the visitor asks how to join. On the lobby there is no room, so it returns ok false with a reason.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => App.page.getJoinInfo(),
    };
  }

  static getSessionStandingsAction() {
    return {
      name: "get_session_standings",
      description: "Read the match history and standings recorded in this browser session. There is no global leaderboard and no history beyond this session: an empty list means nothing has been recorded here, not that nobody has ever played.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          game: {
            type: "string",
            enum: GAME_IDS,
            description: "Optional game id to filter the history to one game.",
          },
        },
        additionalProperties: false,
      },
      execute: (args) => App.page.getSessionStandings(args.game),
    };
  }

  static getTournamentAction() {
    return {
      name: "get_tournament",
      description: "Read the current tournament bracket on this page, or null when there is none. Brackets live only in this browser session.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => App.page.getTournament(),
    };
  }

  static getLatestClipAction() {
    return {
      name: "get_latest_clip",
      description: "Get the latest clip made on this page (an orchestra recording or a photo-booth picture), or null when there is none. Only the orchestra and the photo booth make clips.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => App.page.getLatestClip(),
    };
  }

  static openGameAction() {
    return {
      name: "open_game",
      description: "Open a game page on this site. Call it only when the visitor asks to play a game, with an id from website_get_game_catalog. On a game page it refuses when a match is in progress, because leaving would lose the match. Returns the game that was opened.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["game"],
        properties: {
          game: {
            type: "string",
            enum: GAME_IDS,
            description: "Game id from website_get_game_catalog.",
          },
        },
      },
      execute: (args) => App.page.openGame(args.game),
    };
  }

  static addPracticeBotsAction() {
    return {
      name: "add_practice_bots",
      description: "Add practice bots to the current game page and restart it with them (count 1 to the game's max players). Call it only on a game page and only when the visitor asks. On the lobby it returns ok false: open a game first. It refuses when a match is in progress, because restarting would lose the match.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["count"],
        properties: {
          count: {
            type: "integer",
            minimum: 1,
            maximum: 8,
            description: "How many bots to add.",
          },
        },
      },
      execute: (args) => App.page.addPracticeBots(args.count),
    };
  }

  static createTournamentAction() {
    return {
      name: "create_tournament",
      description: "Create a single-elimination tournament bracket on this page for 2 to 8 players, using the player names the visitor gave. The bracket lives only in this browser session. Creating a new bracket replaces the current one. Returns the bracket.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["game", "players"],
        properties: {
          game: {
            type: "string",
            enum: GAME_IDS,
            description: "Game id from website_get_game_catalog.",
          },
          players: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 20 },
            description: "Player names the visitor gave, 2 to 8, each 1 to 20 characters.",
          },
          format: {
            type: "string",
            enum: ["single-elimination"],
            description: "Tournament format. Only single-elimination is supported.",
          },
        },
      },
      execute: (args) => App.page.createTournament(args),
    };
  }

  static recordMatchResultAction() {
    return {
      name: "record_match_result",
      description: "Record the winner of the current tournament match and move the bracket forward. Only a player in the current match can win; the site refuses anyone else. Ask the visitor who won before calling it — never invent a result.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["winner"],
        properties: {
          winner: {
            type: "string",
            minLength: 1,
            maxLength: 20,
            description: "The name of the player who won the current match, as the visitor told you.",
          },
          score: {
            type: "string",
            maxLength: 40,
            description: "Optional score, such as 7-5.",
          },
        },
      },
      execute: (args) => App.page.recordMatchResult(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
