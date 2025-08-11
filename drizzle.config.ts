import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export default defineConfig({
  // Database connection
  out: './src/database/migrations',
  schema: './src/database/schema.ts',
  dialect: 'postgresql',

  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },

  // Migration settings
  migrations: {
    prefix: 'timestamp',
    table: '__drizzle_migrations__',
    schema: 'public',
  },

  // Development settings
  verbose: process.env.NODE_ENV === 'development',
  strict: true,

  // Introspection settings (for existing databases)
  introspect: {
    casing: 'preserve',
  },

  // Schema filter (if you have multiple schemas)
  schemaFilter: ['public'],

  // Extensions we might use
  extensionsFilters: ['postgis'],
});
