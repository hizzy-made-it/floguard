// Import this FIRST in every estimates test: sets the env the handlers read.
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ACADEMY_SYNC_SECRET = 'test-secret';
process.env.ACADEMY_DATA_BACKEND = 'postgres';
process.env.ESTIMATE_PUBLIC_BASE_URL = 'https://crm.example.test';
