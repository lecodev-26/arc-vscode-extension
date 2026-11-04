import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import MockAdapter from 'axios-mock-adapter';

import { ArcClient } from '../api/arcClient';
import { ArcAccessError } from '../utils/arcErrors';
import { validateDatabaseName } from '../utils/databaseNames';
import type { ArcConnection } from '../types';

const connection: ArcConnection = {
  id: 'test',
  name: 'test',
  protocol: 'http',
  host: 'localhost',
  port: 8000
};

function client(): { arc: ArcClient; mock: MockAdapter } {
  const arc = new ArcClient(connection, 'admin-token');
  const mock = new MockAdapter((arc as unknown as { client: never }).client);
  return { arc, mock };
}

describe('database name validation', () => {
  it('accepts Arc database identifiers', () => {
    assert.equal(validateDatabaseName('metrics'), undefined);
    assert.equal(validateDatabaseName('factory-prod_2'), undefined);
  });

  it('rejects invalid, overlong, and reserved names', () => {
    assert.match(validateDatabaseName('2metrics') ?? '', /start with a letter/);
    assert.match(validateDatabaseName('metrics/db') ?? '', /start with a letter/);
    assert.match(validateDatabaseName('a'.repeat(65)) ?? '', /1–64 characters/);
    assert.match(validateDatabaseName('system') ?? '', /reserved/);
    assert.match(validateDatabaseName('INTERNAL') ?? '', /reserved/);
  });
});

describe('ArcClient database endpoints', () => {
  it('lists first-class databases and filters invalid names', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases').reply(200, {
      databases: [{ name: 'metrics' }, { name: 'factory-prod' }, { name: '../bad' }, { name: 42 }],
      count: 4
    });
    assert.deepEqual(await arc.getDatabases(), ['metrics', 'factory-prod']);
  });

  it('falls back to SHOW DATABASES only when the resource route is unavailable', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases').reply(404, { error: 'Not Found' });
    mock.onPost('/api/v1/query').reply(200, {
      columns: ['database'],
      data: [['metrics'], ['logs']]
    });
    assert.deepEqual(await arc.getDatabases(), ['metrics', 'logs']);
  });

  it('preserves scoped-token refusals from the database list endpoint', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases').reply(403, {
      error: "access denied: no read permission for database '*'"
    });
    await assert.rejects(
      () => arc.getDatabases(),
      (error: unknown) => error instanceof ArcAccessError && error.info.kind === 'scoped'
    );
  });

  it('lists measurements through the named database endpoint', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/factory-prod/measurements').reply(200, {
      database: 'factory-prod',
      measurements: [{ name: 'cpu' }, { name: 'temperature' }],
      count: 2
    });
    assert.deepEqual(await arc.getMeasurements('factory-prod'), [
      { name: 'cpu' },
      { name: 'temperature' }
    ]);
  });

  it('uses the legacy measurements route only when the scoped route is unavailable', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/metrics/measurements').reply(404, { error: 'Not Found' });
    mock.onGet('/api/v1/measurements').reply((config) => {
      assert.equal(config.params?.database, 'metrics');
      return [200, { measurements: ['cpu', 'temperature'] }];
    });
    assert.deepEqual(await arc.getMeasurements('metrics'), [
      { name: 'cpu' },
      { name: 'temperature' }
    ]);
  });

  it('does not hide a missing database behind the legacy fallback', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/missing/measurements').reply(404, {
      error: "Database 'missing' not found"
    });
    await assert.rejects(() => arc.getMeasurements('missing'), /Database 'missing' not found/);
    assert.equal(mock.history.get.length, 1);
  });

  it('preserves per-database measurement refusals', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/metrics/measurements').reply(403, {
      error: "no permission for read on database 'metrics'"
    });
    await assert.rejects(
      () => arc.getMeasurements('metrics'),
      (error: unknown) => error instanceof ArcAccessError && error.info.database === 'metrics'
    );
  });

  it('creates databases with the first-class POST endpoint', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/databases').reply((config) => {
      assert.deepEqual(JSON.parse(config.data), { name: 'factory-prod' });
      return [201, { name: 'factory-prod', ['measurement_count']: 0 }];
    });
    await arc.createDatabase('factory-prod');
  });

  it('deletes databases only with the explicit confirmation query', async () => {
    const { arc, mock } = client();
    mock.onDelete('/api/v1/databases/factory-prod').reply((config) => {
      assert.equal(config.params?.confirm, 'true');
      return [200, { success: true }];
    });
    await arc.deleteDatabase('factory-prod');
  });

  it('does not send create requests for invalid or reserved names', async () => {
    const { arc, mock } = client();
    await assert.rejects(() => arc.createDatabase('system'), /reserved/);
    await assert.rejects(() => arc.createDatabase('bad/name'), /start with a letter/);
    assert.equal(mock.history.post.length, 0);
  });

  it('explains the admin requirement for create refusals', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/databases').reply(403, { error: 'admin permission required' });
    await assert.rejects(() => arc.createDatabase('metrics'), /admin token/);
  });

  it('does not misreport disabled deletion as an RBAC problem', async () => {
    const { arc, mock } = client();
    mock.onDelete('/api/v1/databases/metrics').reply(403, {
      error: 'Delete operations are disabled. Set delete.enabled=true in arc.toml to enable.'
    });
    await assert.rejects(
      () => arc.deleteDatabase('metrics'),
      /Delete operations are disabled\. Set delete\.enabled=true/
    );
  });

  it('surfaces Arc delete errors such as a non-primary writer response', async () => {
    const { arc, mock } = client();
    mock.onDelete('/api/v1/databases/metrics').reply(503, {
      error: 'database delete rejected: node role follower is not primary writer'
    });
    await assert.rejects(
      () => arc.deleteDatabase('metrics'),
      /node role follower is not primary writer/
    );
  });
});
