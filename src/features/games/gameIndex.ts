import type {
  GameCatalogEntry,
  GameServerDefinition,
} from '../../domain/catalog/types.ts';
import type { CustomGameRecord } from '../../domain/storage/types.ts';
import { loadBundledGameCatalog } from '../../services/catalog/loadBundledCatalog.ts';

export interface GameIndexEntry {
  name: string;
  menuName?: string;
  servers: Map<string, GameServerDefinition>;
}

export type GameIndex = Map<string, GameIndexEntry>;

function indexGame(
  index: GameIndex,
  game: Pick<GameCatalogEntry, 'id' | 'name' | 'menuName' | 'servers'>,
): void {
  index.set(game.id, {
    name: game.name,
    ...(game.menuName === undefined ? {} : { menuName: game.menuName }),
    servers: new Map(game.servers.map((server) => [server.id, server])),
  });
}

/** Combines the bundled catalog with user-created games. */
export function createGameIndex(
  customGames: readonly CustomGameRecord[] = [],
): GameIndex {
  const index: GameIndex = new Map();
  for (const game of loadBundledGameCatalog().games) {
    indexGame(index, game);
  }
  for (const game of customGames) {
    indexGame(index, game);
  }
  return index;
}
