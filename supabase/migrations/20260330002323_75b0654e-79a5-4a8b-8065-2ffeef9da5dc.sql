
-- Move pg_trgm back to public - it's required for the <-> operator used by global_search and GIN indexes
ALTER EXTENSION pg_trgm SET SCHEMA public;
