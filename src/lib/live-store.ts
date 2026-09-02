import fs from "fs";
import path from "path";
import type { LiveGame } from "./types";

const FILE = path.join("/tmp", "mafia-live-games.json");

const memory = new Map<string, LiveGame>();
let loaded = false;

function key(code: string) {
  return code.trim().toUpperCase();
}

function readFile(): Record<string, LiveGame> {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw) as Record<string, LiveGame>;
  } catch {
    return {};
  }
}

function writeFile() {
  try {
    const obj: Record<string, LiveGame> = {};
    for (const [code, game] of memory) obj[code] = game;
    fs.writeFileSync(FILE, JSON.stringify(obj));
  } catch {
    // /tmp may be missing; memory still holds it
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const disk = readFile();
  for (const [code, game] of Object.entries(disk)) {
    const normalized = key(code);
    if (!memory.has(normalized)) {
      game.code = normalized;
      memory.set(normalized, game);
    }
  }
}

export function getLive(code: string): LiveGame | null {
  ensureLoaded();
  return memory.get(key(code)) ?? null;
}

export function setLive(game: LiveGame): LiveGame {
  ensureLoaded();
  game.code = key(game.code);
  memory.set(game.code, game);
  writeFile();
  return game;
}

export function hasLive(code: string): boolean {
  ensureLoaded();
  return memory.has(key(code));
}

export function allCodes(): string[] {
  ensureLoaded();
  return [...memory.keys()];
}
