const port = Number(process.env.SERVER_PORT ?? '43127');
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('SERVER_PORT must be an integer between 1 and 65535.');
}

const origins = (
  process.env.CORS_ORIGINS ?? 'http://127.0.0.1:43127,http://localhost:43127,http://localhost:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (origins.length === 0) {
  throw new Error('CORS_ORIGINS must contain at least one explicit web origin.');
}
for (const origin of origins) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
    throw new Error(
      'CORS_ORIGINS entries must be HTTP(S) origins without paths or trailing slashes.',
    );
  }
}

/** Validated environment configuration; dev override never follows request parameters. */
export const serverConfig = {
  host: process.env.SERVER_HOST ?? '0.0.0.0',
  port,
  corsOrigins: origins,
};
