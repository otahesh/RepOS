import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const db = new Pool({ connectionString: process.env.DATABASE_URL });
