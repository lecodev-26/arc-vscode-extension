/**
 * Arc's refusals, and what the extension does with each one.
 *
 * These are the extension's first unit tests. They run under `node:test`
 * against the compiled output, so nothing here may touch the `vscode` module —
 * the classifier and the Arc HTTP client are both free of it on purpose.
 *
 * Every body below is one Arc actually sends. The 403s all share a status code
 * and differ only in message, which is exactly why they are easy to collapse
 * and worth pinning: reporting a scoped token as a bad token, or a broken
 * permission store as a scoped token, sends the user somewhere that cannot
 * fix the problem.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import MockAdapter from 'axios-mock-adapter';

import { ArcClient } from '../api/arcClient';
import { ArcAccessError, arcErrorMessage, classifyArcError, isScopedRefusal } from '../utils/arcErrors';
import { ArcConnection } from '../types';

// --- The bodies -------------------------------------------------------------

const NO_TOKEN = { success: false, error: 'Authentication required' };
const BAD_TOKEN = { success: false, error: 'Invalid or expired token' };

// Coarse refusals: the token carries no read permission at all.
const NO_READ = { success: false, error: "token does not have 'read' permission" };
const OSS_NO_READ = { success: false, error: 'Permission denied: read required' };

// The handler gates on the query path, which is what this extension uses.
const SCOPED_LIST = { success: false, error: 'access denied: no read permission to list databases' };
const SCOPED_DB = { success: false, error: "access denied: no read permission for database 'metrics'" };
const SCOPED_MEASUREMENT = { success: false, error: 'access denied: no read permission for metrics.*' };
const SCOPED_WILDCARD = { success: false, error: "access denied: no read permission for database '*'" };

// The resource-scoped read middleware, used by the database listing routes.
const SCOPED_MIDDLEWARE = { success: false, error: "no permission for read on database 'metrics'" };
const SCOPED_MIDDLEWARE_EMPTY = { success: false, error: "no permission for read on database ''" };

// Arc could not load the token's grants and refused rather than guess.
const UNAVAILABLE = { success: false, error: 'permission data unavailable' };

const LICENSE = { success: false, error: "RBAC requires an enterprise license with the 'rbac' feature enabled" };
const NOT_FOUND = { error: "Database 'ghost' not found" };

const SHOW_DATABASES_OK = { success: true, columns: ['database'], data: [['metrics'], ['logs']] };

// --- Harness ----------------------------------------------------------------

const connection: ArcConnection = {
  id: 'test',
  name: 'test',
  protocol: 'http',
  host: 'localhost',
  port: 8000
} as ArcConnection;

function client(): { arc: ArcClient; mock: MockAdapter } {
  const arc = new ArcClient(connection, 'tok');
  // Reach the instance's own axios client so the adapter intercepts the same
  // interceptors (and therefore the same Authorization header) the extension
  // uses in production.
  const mock = new MockAdapter((arc as unknown as { client: never }).client);
  return { arc, mock };
}

// --- classifyArcError -------------------------------------------------------

describe('classifyArcError', () => {
  const cases: Array<{ name: string; status: number; body: object; kind: string; database?: string }> = [
    { name: '401 with no token', status: 401, body: NO_TOKEN, kind: 'auth' },
    { name: '401 with a bad token', status: 401, body: BAD_TOKEN, kind: 'auth' },

    { name: 'SHOW DATABASES refused for a scoped token', status: 403, body: SCOPED_LIST, kind: 'scoped' },
    { name: 'SHOW TABLES FROM db refused', status: 403, body: SCOPED_DB, kind: 'scoped', database: 'metrics' },
    { name: 'measurement listing refused', status: 403, body: SCOPED_MEASUREMENT, kind: 'scoped', database: 'metrics' },
    { name: 'wildcard is not a database to suggest', status: 403, body: SCOPED_WILDCARD, kind: 'scoped' },
    { name: 'listing middleware, named database', status: 403, body: SCOPED_MIDDLEWARE, kind: 'scoped', database: 'metrics' },
    { name: 'listing middleware, no database sent', status: 403, body: SCOPED_MIDDLEWARE_EMPTY, kind: 'scoped' },

    { name: 'token has no read permission', status: 403, body: NO_READ, kind: 'forbidden' },
    { name: 'server without per-database reads', status: 403, body: OSS_NO_READ, kind: 'forbidden' },
    { name: 'grants could not be loaded', status: 403, body: UNAVAILABLE, kind: 'unavailable' },
    { name: 'licence-gated feature', status: 403, body: LICENSE, kind: 'license' },
    { name: 'unrecognised 403 falls back to forbidden', status: 403, body: { error: 'Delete operations are disabled.' }, kind: 'forbidden' },

    { name: '404', status: 404, body: NOT_FOUND, kind: 'not_found' },
    { name: '500', status: 500, body: { error: 'boom' }, kind: 'server' }
  ];

  for (const c of cases) {
    it(c.name, () => {
      const info = classifyArcError(c.status, (c.body as { error?: string }).error);
      assert.equal(info.kind, c.kind);
      assert.equal(info.status, c.status);
      assert.equal(info.database, c.database);
    });
  }

  it('reports no status as a network or server problem, never a refusal', () => {
    assert.equal(classifyArcError(undefined, undefined, 'ECONNREFUSED').kind, 'network');
    assert.equal(classifyArcError(undefined, undefined).kind, 'server');
  });

  it('does not treat a missing message as a scoping state', () => {
    assert.equal(classifyArcError(403, undefined).kind, 'forbidden');
    assert.equal(classifyArcError(403, '').kind, 'forbidden');
  });
});

// --- arcErrorMessage --------------------------------------------------------

describe('arcErrorMessage', () => {
  it('tells a scoped caller to set a database, and names it when Arc did', () => {
    const named = arcErrorMessage({ kind: 'scoped', status: 403, database: 'metrics' });
    assert.match(named, /no read access to database 'metrics'/);
    assert.match(named, /set a different database/i);

    const unnamed = arcErrorMessage({ kind: 'scoped', status: 403 });
    assert.match(unnamed, /restricted to specific databases/i);
    assert.match(unnamed, /Set the database on this connection/i);
  });

  it('keeps the four refusals distinct and never quotes a bare status', () => {
    const messages = (['auth', 'scoped', 'forbidden', 'unavailable'] as const).map(kind =>
      arcErrorMessage({ kind, status: kind === 'auth' ? 401 : 403 })
    );
    assert.equal(new Set(messages).size, messages.length);
    for (const message of messages) {
      assert.doesNotMatch(message, /\b40[13]\b/);
    }
  });

  it('does not send a token problem or a server fault after a database', () => {
    assert.doesNotMatch(arcErrorMessage({ kind: 'forbidden', status: 403 }), /database/i);
    assert.doesNotMatch(arcErrorMessage({ kind: 'unavailable', status: 403 }), /database/i);
    assert.match(arcErrorMessage({ kind: 'unavailable', status: 403 }), /server-side fault/i);
  });
});

// --- ArcClient.getDatabases -------------------------------------------------

describe('ArcClient.getDatabases', () => {
  it('returns the databases on success', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(200, SHOW_DATABASES_OK);
    assert.deepEqual(await arc.getDatabases(), ['metrics', 'logs']);
  });

  const refusals: Array<{ name: string; status: number; body: object; kind: string }> = [
    { name: 'a scoped token', status: 403, body: SCOPED_LIST, kind: 'scoped' },
    { name: 'a token with no read permission', status: 403, body: NO_READ, kind: 'forbidden' },
    { name: 'an unreadable permission store', status: 403, body: UNAVAILABLE, kind: 'unavailable' },
    { name: 'a rejected token', status: 401, body: BAD_TOKEN, kind: 'auth' }
  ];

  for (const r of refusals) {
    it(`throws rather than inventing a database for ${r.name}`, async () => {
      // The old code answered ANY axios failure with ['default'], so a
      // refusal put a database in the tree that the token might not be able
      // to read, and nothing ever said the token was refused.
      const { arc, mock } = client();
      mock.onPost('/api/v1/query').reply(r.status, r.body);

      await assert.rejects(
        () => arc.getDatabases(),
        (error: unknown) => {
          assert.ok(error instanceof ArcAccessError, `expected ArcAccessError, got ${error}`);
          assert.equal(error.info.kind, r.kind);
          assert.equal(isScopedRefusal(error), r.kind === 'scoped');
          return true;
        }
      );
    });
  }

  it('still falls back to one database when the server is unreachable', async () => {
    // A transport failure is not a refusal, and the lenient behaviour there
    // is deliberate: the tree keeps a root to retry from.
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').networkError();
    assert.deepEqual(await arc.getDatabases(), ['default']);
  });

  it('still falls back to one database on a server fault', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(500, { error: 'boom' });
    assert.deepEqual(await arc.getDatabases(), ['default']);
  });
});

// --- ArcClient.getMeasurements ----------------------------------------------

describe('ArcClient.getMeasurements', () => {
  it('returns the measurements on success', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/metrics/measurements').reply(200, {
      database: 'metrics',
      measurements: [{ name: 'cpu' }],
      count: 1
    });
    assert.deepEqual(await arc.getMeasurements('metrics'), [{ name: 'cpu' }]);
  });

  it('does not retry a refusal against /api/v1/measurements', async () => {
    // That endpoint applies the same per-database check and answers
    // identically, so the fallback would only double the requests and the
    // audit entries for a decision Arc has already made.
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/metrics/measurements').reply(403, SCOPED_DB);
    const fallback = mock.onGet('/api/v1/measurements').reply(403, SCOPED_MEASUREMENT);

    await assert.rejects(
      () => arc.getMeasurements('metrics'),
      (error: unknown) => {
        assert.ok(error instanceof ArcAccessError);
        assert.equal(error.info.kind, 'scoped');
        assert.equal(error.info.database, 'metrics');
        return true;
      }
    );

    const triedFallback = fallback.history.get.some(r => r.url === '/api/v1/measurements');
    assert.equal(triedFallback, false, '/api/v1/measurements must not be tried after a refusal');
  });

  it('falls back to /api/v1/measurements when the scoped route is unavailable', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/metrics/measurements').reply(404, { error: 'Not Found' });
    mock.onGet('/api/v1/measurements').reply(200, { measurements: ['cpu', 'mem'] });

    assert.deepEqual(await arc.getMeasurements('metrics'), [{ name: 'cpu' }, { name: 'mem' }]);
  });

  it('surfaces a refusal raised only by the compatibility fallback', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/databases/metrics/measurements').reply(404, { error: 'Not Found' });
    mock.onGet('/api/v1/measurements').reply(403, SCOPED_MEASUREMENT);

    await assert.rejects(
      () => arc.getMeasurements('metrics'),
      (error: unknown) => error instanceof ArcAccessError && error.info.kind === 'scoped'
    );
  });
});
