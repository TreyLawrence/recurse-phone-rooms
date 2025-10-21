-- Create api_keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix VARCHAR(8) NOT NULL,
  name VARCHAR(255),
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for fast API key lookups
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys (user_id);
