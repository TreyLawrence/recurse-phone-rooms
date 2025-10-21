# Recurse Center Phone Booking System

A simple application for Recurse Center participants to book phone rooms for calls, interviews, or meetings. This system provides an intuitive interface for viewing and booking available rooms while preventing scheduling conflicts.

## Features

- OAuth authentication with Recurse Center
- View available phone rooms with color-coded display
- Book time slots for phone rooms with drag-and-drop interface
- See existing bookings in a weekly calendar view
- Prevent double-bookings with built-in validation
- Authentication-protected API endpoints for secure booking management
- API key management for programmatic access to the booking system

## Technology Stack

- **Frontend**: Svelte with TypeScript
- **Styling**: Tailwind CSS for responsive design
- **Calendar**: Custom calendar implementation with time slot selection
- **Backend**: Express.js REST API
- **Database**: PostgreSQL
- **Development**: Vite for fast development and building
- **Testing**: Playwright for end-to-end tests, custom API tests

## Prerequisites

- Node.js (v16+)
- PostgreSQL database
- Recurse Center OAuth application credentials

## Setup

1. Clone the repository:

```bash
git clone https://github.com/TreyLawrence/recurse-bookings.git
cd recurse-bookings
```

2. Install dependencies:

```bash
npm install
```

3. Create a Recurse Center OAuth application:
   - Go to https://www.recurse.com/settings/apps
   - Create a new OAuth application
   - Set the redirect URI to `http://localhost:5173/oauth/callback`
   - Note your client ID and client secret

4. Configure your environment variables:
   - Copy `.env` to `.env.local` (which will not be committed to git)
   - Fill in your database details and Recurse Center OAuth credentials

```
VITE_DB_USER=your_db_user
VITE_DB_HOST=your_db_host
VITE_DB_NAME=your_database_name
VITE_DB_PASSWORD=your_db_password
VITE_DB_PORT=5432
VITE_DB_SSL=true

# Recurse Center OAuth
VITE_RECURSE_CLIENT_ID=your_recurse_client_id
VITE_RECURSE_CLIENT_SECRET=your_recurse_client_secret
VITE_OAUTH_REDIRECT_URI=http://localhost:5173/oauth/callback
```

5. Set up PostgreSQL service configuration (optional but recommended):

```bash
npm run setup:pg-service
```

This creates a configuration file that simplifies database connections across different environments (local development, testing, and production). The script will:
   - Create a ~/.pg_service.conf file from the template
   - Test connections to the local and test databases
   - Provide guidance for setting up production credentials

For more information about the PostgreSQL service configuration, see [docs/database-services.md](docs/database-services.md).

6. Run the database migrations:

```bash
npm run migrate
```

### Migrations workflow (contributors)

- Add schema changes as new, numbered `.sql` files in `migrations/` (e.g., `003_add_table_x.sql`).
- Keep migrations idempotent using `IF NOT EXISTS`/`ON CONFLICT DO NOTHING` so re-runs are safe.
- Apply locally with:

```bash
npm run migrate
```

- Start the app after migrating:

```bash
npm run dev:all
```

- Tests/CI run against a fresh DB with migrations applied.

7. Start the development server:

```bash
npm run dev:all
```

8. Open http://localhost:5173 in your browser

## Project Structure

```
recurse-bookings/
├── src/                  # Frontend Svelte application
│   ├── lib/              # Shared utility code
│   │   ├── auth.ts       # Authentication utilities
│   │   └── browserDb.ts  # Database API client
│   ├── routes/           # Svelte components for routes
│   └── App.svelte        # Main application component
├── server/               # Backend Express API
│   ├── index.js          # Main server file and API routes
│   └── db.js             # Database connection and queries
├── migrations/           # Database migration scripts
├── tests/                # Test files
│   ├── api/              # API tests
│   └── e2e/              # End-to-end tests with Playwright
└── playwright.config.ts  # Playwright configuration
```

## Database Schema

The application uses four main tables:

- `users`: Stores user information from Recurse Center (id, email, name, recurse_id, access_token)
- `rooms`: Lists available phone rooms (id, name, description, capacity)
- `bookings`: Tracks room reservations (id, user_id, room_id, start_time, end_time, notes)
- `api_keys`: Manages API keys for programmatic access (id, user_id, key_hash, key_prefix, name, last_used_at, created_at)

## Testing

The application includes both API tests and end-to-end tests:

### Running API Tests

```bash
npx playwright test tests/api/
```

These tests verify the backend API functionality including booking creation, availability checking, and permission validation.

### Running End-to-End Tests

```bash
npx playwright test tests/e2e/
```

End-to-end tests use Playwright to simulate user interactions in a browser environment, testing the entire application flow.

## Development

### Available Scripts

- `npm run dev:all`: Start both the frontend and backend servers
- `npm run dev`: Start only the frontend development server
- `npm run server`: Start only the backend server
- `npm run build`: Build for production
- `npm run preview`: Preview the production build
- `npm run check`: Type-check the code
- `npm run migrate`: Run database migrations
- `npm test`: Run all tests
- `npm run test:ui`: Run tests with Playwright UI mode

## Deploying to Production

1. Set up a PostgreSQL database
2. Update the Recurse Center OAuth redirect URI to your production URL
3. Set environment variables for production
4. Build the application: `npm run build`
5. Deploy the built files from the `dist` directory to your hosting service

### Railway deploys and migrations

- Production runs on Railway. The service is configured to run migrations on start via `railway.json`:

```
"startCommand": "npm run migrate && node server/index.js"
```

- On `railway up` (or after squash/merge to main if you deploy from main), Railway will:
  - Build the app
  - Execute all `.sql` files in `migrations/` in alphanumeric order
  - Start the server

- Local development does NOT auto-run migrations; contributors should run `npm run migrate` explicitly.

## API Keys

API keys allow you to access the booking system programmatically without using the OAuth flow. This is useful for building integrations, automations, or command-line tools.

### Creating an API Key

To create an API key, send a POST request to `/api/api-keys` with an optional name:

```bash
curl -X POST http://localhost:3000/api/api-keys \
  -H "Cookie: auth_token=YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Integration"}'
```

The response will include your API key (returned only once):

```json
{
  "id": 1,
  "key": "a1b2c3d4e5f6...",
  "name": "My Integration",
  "prefix": "a1b2c3d4",
  "created_at": "2025-10-17T12:00:00Z"
}
```

**Important:** Save the `key` value immediately. It cannot be retrieved again.

### Using an API Key

Include your API key in the `Authorization` header as a Bearer token:

```bash
curl http://localhost:3000/api/rooms \
  -H "Authorization: Bearer YOUR_API_KEY"
```

API keys work with all authenticated endpoints, including:
- `GET /api/rooms` - List all rooms
- `GET /api/bookings` - List bookings (with filters)
- `POST /api/bookings` - Create a new booking
- `DELETE /api/bookings/:id` - Delete a booking

### Managing API Keys

**List your API keys:**

```bash
curl http://localhost:3000/api/api-keys \
  -H "Cookie: auth_token=YOUR_AUTH_TOKEN"
```

Response:

```json
[
  {
    "id": 1,
    "key_prefix": "a1b2c3d4",
    "name": "My Integration",
    "last_used_at": "2025-10-17T13:30:00Z",
    "created_at": "2025-10-17T12:00:00Z"
  }
]
```

**Delete an API key:**

```bash
curl -X DELETE http://localhost:3000/api/api-keys/1 \
  -H "Cookie: auth_token=YOUR_AUTH_TOKEN"
```

## License

MIT
# Test change
