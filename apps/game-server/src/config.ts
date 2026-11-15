import { z } from 'zod';

const jsonRecordSchema = z.record(z.string(), z.number().int().positive());
const jsonStringArraySchema = z.array(z.string().min(1));

const parseJsonEnv = <T>(
  raw: string | undefined,
  schema: z.ZodType<T>,
  fallback: T,
): T => {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  return schema.parse(JSON.parse(raw));
};

const configSchema = z.object({
  port: z.number().int().positive(),
  corsOrigins: z.array(z.string()),
  mysql: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    user: z.string().min(1),
    password: z.string(),
    database: z.string().min(1),
    required: z.boolean(),
  }),
  authTokenPlayerMap: z.record(z.string(), z.number().int().positive()),
  authAdminTokens: z.array(z.string()),
});

export type GameServerConfig = z.infer<typeof configSchema>;

export const getConfig = (
  env: NodeJS.ProcessEnv = process.env,
): GameServerConfig => {
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return configSchema.parse({
    port: Number.parseInt(env.PORT ?? '3010', 10),
    corsOrigins,
    mysql: {
      host: env.MYSQL_HOST ?? '127.0.0.1',
      port: Number.parseInt(env.MYSQL_PORT ?? '3306', 10),
      user: env.MYSQL_USER ?? 'pillage',
      password: env.MYSQL_PASSWORD ?? 'pillage',
      database: env.MYSQL_DATABASE ?? 'pillage_online',
      required: (env.MYSQL_REQUIRED ?? 'false').toLowerCase() === 'true',
    },
    authTokenPlayerMap: parseJsonEnv(
      env.AUTH_TOKEN_PLAYER_MAP,
      jsonRecordSchema,
      { 'dev-token': 1 },
    ),
    authAdminTokens: parseJsonEnv(
      env.AUTH_ADMIN_TOKENS,
      jsonStringArraySchema,
      ['admin-token'],
    ),
  });
};
