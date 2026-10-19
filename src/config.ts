import { z } from 'zod';

const originSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
    && !url.hostname.endsWith('.invalid');
}, 'Use an exact HTTPS origin, not a placeholder, path, or credential-bearing URL');

// Studio checks ordering at database precision; Date.parse would collapse microsecond bounds.
const leaderboardWindowSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
}).strict();

export const configurationSchema = z.object({
  appId: z.string().uuid(),
  groupId: z.string().uuid(),
  studioUrl: originSchema,
  apiUrl: originSchema,
  connectUrl: originSchema,
  appOrigin: originSchema,
  display: z.enum(['embed', 'popup']).default('embed'),
  game: z.enum(['target-rush', 'color-match']),
  leaderboardWindow: leaderboardWindowSchema.optional(),
  siblingUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hostname.endsWith('.invalid');
  }, 'siblingUrl must be a public HTTPS URL').optional(),
}).strict();
export type Configuration = z.infer<typeof configurationSchema>;

export function parseConfiguration(value: unknown, currentOrigin?: string): Configuration {
  const configuration = configurationSchema.parse(value);
  const localDevelopment = currentOrigin !== undefined
    && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(currentOrigin);
  if (currentOrigin !== undefined && !localDevelopment && configuration.appOrigin !== currentOrigin) {
    throw new Error('This game is not running at its configured Studio-approved appOrigin.');
  }
  return configuration;
}

export function scoringConfiguration(game: Configuration['game']): { maxTicks: number; roundTicks: number; game: Configuration['game'] } {
  return { maxTicks: 240, roundTicks: 200, game };
}
