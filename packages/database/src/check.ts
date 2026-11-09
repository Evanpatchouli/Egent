import { prisma, initializeDatabase } from './index.js';
await initializeDatabase();

try {
  const rows = await prisma.$queryRaw<Array<{ ok: number | bigint }>>`SELECT 1 AS ok`;
  if (Number(rows[0]?.ok) !== 1) {
    throw new Error('Unexpected database health check result.');
  }
  console.log('SQLite connection verified through Prisma: SELECT 1 = 1');
} catch (error: unknown) {
  // Report the error category without risking printing a connection URL or password.
  console.error(
    'Database check failed. Verify the local data directory and SQLite file permissions.',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
