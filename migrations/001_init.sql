-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  recurse_id INTEGER UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add a trigger function to prevent overlapping bookings
CREATE OR REPLACE FUNCTION check_booking_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE room_id = NEW.room_id
    AND id != NEW.id
    AND NEW.start_time < end_time
    AND NEW.end_time > start_time
  ) THEN
    RAISE EXCEPTION 'Booking overlaps with an existing booking';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for the check_booking_overlap function
DROP TRIGGER IF EXISTS booking_overlap_check ON bookings;
CREATE TRIGGER booking_overlap_check
BEFORE INSERT OR UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION check_booking_overlap();

-- Create index for faster booking lookups
CREATE INDEX IF NOT EXISTS bookings_room_time_idx ON bookings (room_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id);

-- Insert the two specific rooms we want
INSERT INTO rooms (name, description, capacity)
VALUES
  ('Green Phone Room', 'Small green phone booth for private calls', 1),
  ('Lovelace', 'Conference room named after Ada Lovelace', 4)
ON CONFLICT (name) DO NOTHING;