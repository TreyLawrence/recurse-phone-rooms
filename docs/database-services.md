# PostgreSQL Service Configuration

This project uses PostgreSQL service configuration to simplify database connections across different environments (local development, testing, and production).

## What is pg_service.conf?

The `pg_service.conf` file allows you to define named connection profiles for PostgreSQL. Instead of specifying all connection parameters each time, you can simply reference a service name.

## Setup Instructions

1. **Copy the configuration file** to one of these locations:

   * For user-specific configuration:
     ```bash
     cp pg_service.conf ~/.pg_service.conf
     ```

   * For system-wide configuration (requires admin privileges):
     ```bash
     sudo cp pg_service.conf /etc/pg_service.conf
     ```

2. **Update the production credentials** in the config file:

   Open the file and replace the placeholder values in the `[prod]` section with your actual Railway PostgreSQL credentials.

   For security, consider keeping the password out of the file and using environment variables instead.

3. **Set the PGSERVICEFILE environment variable** (optional):

   If you want to store the file in a non-standard location:
   ```bash
   export PGSERVICEFILE=/path/to/your/pg_service.conf
   ```

## Railway Production Database

For the production database, you have two options:

1. **Store credentials in pg_service.conf** (less secure, but simpler):
   ```
   [prod]
   host=containers-us-west-xyz.railway.app
   port=5432
   dbname=railway
   user=postgres
   password=your_actual_railway_password
   sslmode=require
   ```

2. **Use environment variables** (more secure, recommended):
   ```
   [prod]
   host=containers-us-west-xyz.railway.app
   port=5432
   dbname=railway
   user=postgres
   # Password will be taken from PGPASSWORD environment variable
   sslmode=require
   ```

   Then set the password in your environment:
   ```bash
   export PGPASSWORD=your_actual_railway_password
   ```

## Using the Services

### In Command Line

```bash
# Connect to local development database
psql "service=local"

# Connect to test database
psql "service=test"

# Connect to production database
psql "service=prod"
```

### In Scripts

The application is configured to automatically use the appropriate service based on the `NODE_ENV` environment variable:

- `NODE_ENV=development` (or unset) → Uses `[local]` service
- `NODE_ENV=test` → Uses `[test]` service
- `NODE_ENV=production` → Uses `[prod]` service

If connecting to the service fails, the application will fall back to using the direct connection parameters from environment variables.

### Migrations in local vs production

- Local development: run migrations explicitly with `npm run migrate` before starting the app.
- Production (Railway): migrations are executed on start (see `railway.json` `startCommand`). New `.sql` files in `migrations/` are picked up automatically on deploy.
- Author new migrations as numbered `.sql` files and prefer idempotent SQL (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

## Troubleshooting

If you encounter connection issues:

1. Verify the service file is in the correct location:
   ```bash
   echo $PGSERVICEFILE  # Should point to your config file
   ```

2. Test the connection using psql:
   ```bash
   PGPASSWORD=your_password psql "service=local"
   ```

3. Check the logs for specific error messages.

4. For Railway production database issues, ensure your IP is whitelisted if Railway has IP restrictions enabled.