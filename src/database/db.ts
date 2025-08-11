import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool settings
  max: 20, // Maximum number of connections
  min: 5, // Minimum number of connections
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
  idleTimeoutMillis: 30000, // Close an idle connection after 30 seconds
  maxUses: 7500, // Close connection after this many uses (prevents memory leaks)
});

// Create Drizzle instance
export const db = drizzle(pool, { schema });

// Connection health check
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connection established');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
  try {
    await pool.end();
    console.log('🔒 Database connection pool closed');
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
}

// Export pool for direct access if needed
export { pool };

// Helper function to run migrations programmatically
export async function runMigrations() {
  try {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db, { migrationsFolder: './src/database/migrations' });
    console.log('✅ Database migrations completed');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  }
}
