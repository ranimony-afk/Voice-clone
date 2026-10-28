import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { apiRouter } from '../../server/routes/api.ts';

test('public database migration endpoint is disabled without connecting to a database', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://127.0.0.1:1/voiceforge_test';

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/db/migrate`, {
      method: 'POST',
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'DATABASE_MIGRATION_DISABLED');
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
