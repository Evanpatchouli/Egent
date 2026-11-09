import { initializeDatabase, prisma } from './index.js';
await initializeDatabase();
await prisma.$disconnect();
console.log('Local SQLite schema ready');
