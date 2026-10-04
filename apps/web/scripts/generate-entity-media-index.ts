import { writeFile } from 'node:fs/promises';
import playerSnapshot from '../src/lib/server/players/fixtures/player-directory-snapshot.json';
import teamSnapshot from '../src/lib/server/teams/fixtures/team-directory-snapshot.json';

// Run `bun ./scripts/generate-entity-media-index.ts` whenever a canonical directory snapshot changes.
// Compact identity tuples deliberately omit snapshot roster assignments and other server-only metadata.
const players = playerSnapshot.map((player) => [String(player.playerId), `${player.firstName} ${player.lastName}`.trim()]);
const teams = teamSnapshot.map((team) => [team.teamId, team.canonicalName, team.abbreviation, team.shortName, team.cityName]);
await writeFile(new URL('../src/lib/entities/entity-media-index.json', import.meta.url), `${JSON.stringify({ players, teams })}\n`);
