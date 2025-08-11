-- PostgreSQL initialization script
-- This script runs when the PostgreSQL container starts for the first time

-- Create extensions that might be useful
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create additional databases if needed (optional)
-- CREATE DATABASE chat_db_test OWNER chat_user;

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE chat_db TO chat_user;

-- Set up timezone
SET timezone = 'UTC';

-- Create some useful functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Log successful initialization
INSERT INTO pg_stat_statements_info (dealloc) VALUES (0) ON CONFLICT DO NOTHING;

-- Output confirmation
DO $$
BEGIN
    RAISE NOTICE 'Database initialization completed successfully';
    RAISE NOTICE 'Database: chat_db';
    RAISE NOTICE 'User: chat_user';
    RAISE NOTICE 'Extensions: uuid-ossp, pg_trgm';
END $$;