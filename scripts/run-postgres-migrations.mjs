import { createPostgresPool, runPostgresMigrations } from '../server/postgresDatabase.js';

const pool = createPostgresPool({ max: 1 });
try {
  const applied = await runPostgresMigrations(pool);
  console.log(`PostgreSQL schema is at migration ${applied.at(-1) || 'none'}.`);
} finally {
  await pool.end();
}
