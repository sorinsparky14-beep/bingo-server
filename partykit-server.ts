// =============================================================================
// BOX BOX BINGO — PartyKit Server (partykit-server.ts)
// Suportă 1000+ jucători simultan per cameră
//
// Deploy:
//   1. npm install partykit
//   2. npx partykit deploy partykit-server.ts --name box-box-bingo
//
// În vercel.json adaugă:
//   { "source": "/box-box-bingo/party/:path*", "destination": "https://box-box-bingo.<user>.partykit.dev/:path*" }
// =============================================================================

import type * as Party from "partykit/server";

// Tipuri de mesaje
interface Player {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: number;
  result: null | {
    correct: number;
    total: number;
    time: number;
    streak: number;
  };
}

interface RoomState {
  players: Record<string, Player>;
  seed: number;
  hostId: string | null;
  started: boolean;
}

export default class BingServer implements Party.Server {
  // Starea fiecărei camere — persistă cât timp există conexiuni
  private state: RoomState = {
    players: {},
    seed: 0,
    hostId: null,
    started: false,
  };

  constructor(readonly room: Party.Room) {}

  // ── Conexiune nouă ──────────────────────────────────────────────────────────
  onConnect(conn: Party.Connection) {
    // Trimite starea curentă noului jucător
    conn.send(
      JSON.stringify({
        type: "room-state",
        payload: {
          players: this.state.players,
          seed: this.state.seed,
          started: this.state.started,
        },
      })
    );
  }

  // ── Mesaj primit de la un client ────────────────────────────────────────────
  onMessage(message: string, sender: Party.Connection) {
    let msg: { type: string; payload?: any };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    switch (msg.type) {

      // Guest sau host se alătură camerei
      case "join": {
        const { name, isHost } = msg.payload;

        // Generează seed din room ID dacă nu există
        if (!this.state.seed) {
          this.state.seed =
            this.room.id
              .split("")
              .reduce(
                (a: number, c: string) =>
                  (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0,
                7
              ) >>> 0;
        }

        // Adaugă jucătorul
        this.state.players[sender.id] = {
          id: sender.id,
          name,
          isHost: !!isHost,
          joinedAt: Date.now(),
          result: null,
        };

        // Primul jucător e host
        if (isHost || !this.state.hostId) {
          this.state.hostId = sender.id;
          this.state.players[sender.id].isHost = true;
        }

        // Trimite clientului propriul ID asignat de server
        sender.send(
          JSON.stringify({
            type: "your-id",
            payload: { id: sender.id },
          })
        );

        // Broadcast lobby update tuturor
        this._broadcastLobby();
        break;
      }

      // Hostul pornește jocul
      case "start": {
        if (sender.id !== this.state.hostId) return;
        this.state.started = true;

        this.room.broadcast(
          JSON.stringify({
            type: "start",
            payload: {
              players: this.state.players,
              seed: this.state.seed,
            },
          })
        );
        break;
      }

      // Un jucător trimite rezultatul
      case "result": {
        if (this.state.players[sender.id]) {
          this.state.players[sender.id].result = msg.payload;
        }

        // Broadcast leaderboard actualizat
        this.room.broadcast(
          JSON.stringify({
            type: "results-update",
            payload: { players: this.state.players },
          })
        );
        break;
      }
    }
  }

  // ── Deconectare ─────────────────────────────────────────────────────────────
  onClose(conn: Party.Connection) {
    const wasHost = conn.id === this.state.hostId;

    // Șterge jucătorul
    delete this.state.players[conn.id];

    if (wasHost) {
      // Hostul a plecat — anunță toți și închide camera
      this.room.broadcast(
        JSON.stringify({ type: "host-disconnect" })
      );
      this.state.hostId = null;
      this.state.players = {};
      this.state.started = false;
    } else {
      // Guest normal a plecat — actualizează lobby
      this._broadcastLobby();
    }
  }

  // ── Helper: broadcast lobby ─────────────────────────────────────────────────
  private _broadcastLobby() {
    this.room.broadcast(
      JSON.stringify({
        type: "lobby-update",
        payload: {
          players: this.state.players,
          seed: this.state.seed,
        },
      })
    );
  }
}

// Configurare PartyKit
export const onFetch = async (req: Party.Request) => {
  return new Response("Box Box Bingo PartyKit Server", { status: 200 });
};
