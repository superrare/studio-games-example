import { z } from 'zod';

export const activeEventSchema = z.object({ version: z.literal('1'), eventId: z.string().uuid() }).strict();
export const serverLeaderboardSchema = z.object({
  version: z.literal('1'),
  entries: z.array(z.object({
    rank: z.number().int().min(1).max(10),
    scoreId: z.string().uuid(),
    score: z.string().regex(/^(0|[1-9][0-9]*)$/),
    secondaryValue: z.null(),
    trustLevel: z.literal('server_verified'),
    achievedAt: z.string().datetime({ offset: true }),
    isCurrentPlayer: z.literal(false),
    player: z.object({
      kind: z.enum(['profile', 'wallet', 'guest']),
      id: z.string().nullable(),
      handle: z.string().nullable(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      chainId: z.number().int().optional(),
    }),
  })).max(10),
}).strict();

// These public read endpoints are not SDK 0.8.0 methods. They deliberately use
// this hosted app's origin; Studio proxies them to its scoring service.
export class ScoringReads {
  constructor(readonly appId: string, readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

  private async get(path: string): Promise<unknown> {
    const response = await this.request(`/api/v1/games/${encodeURIComponent(this.appId)}/scoring/${path}`, {
      headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Scoring ${path}: HTTP ${response.status}`);
    const data: unknown = await response.json();
    return data;
  }

  async activeEvent(): Promise<{ eventId: string }> {
    const { eventId } = activeEventSchema.parse(await this.get('active-event'));
    return { eventId };
  }

  async leaderboard(): Promise<z.infer<typeof serverLeaderboardSchema>['entries']> {
    return serverLeaderboardSchema.parse(await this.get('leaderboard')).entries;
  }
}
