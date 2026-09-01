import fs from "fs";
import path from "path";
import type { GameState } from "./types";
import { idleState } from "./engine";

const FILE = path.join("/tmp", "mafia-sim-state.json");

let memory: GameState | null = null;

function readFile(): GameState | null {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

function writeFile(state: GameState) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch {
    // /tmp may be missing in some runtimes; memory still holds it
  }
}

export function getState(): GameState {
  if (memory) return memory;
  memory = readFile() ?? idleState();
  return memory;
}

export function setState(state: GameState): GameState {
  memory = state;
  writeFile(state);
  return memory;
}
