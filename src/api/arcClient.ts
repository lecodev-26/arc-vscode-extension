import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  ArcConnection,
  ArcQueryResult,
  ArcHealthStatus,
  ArcMetrics,
  TokenCreateRequest,
  TokenCreateResponse,
  TokenVerifyResponse,
  QueryRequest,
  MeasurementInfo
} from '../types';
import { filterValidNames } from '../utils/sqlUtils.js';
import { validateDatabaseName } from '../utils/databaseNames';
import {
  ArcAccessError,
  arcErrorMessage,
  classifyArcError,
  isScopedRefusal
} from '../utils/arcErrors.js';

export class ArcClient {
  private client: AxiosInstance;
  private connection: ArcConnection;
  private token?: string;

  constructor(connection: ArcConnection, token?: string, timeout?: number) {
    this.connection = connection;
    this.token = token;

    const baseURL = `${connection.protocol}://${connection.host}:${connection.port}`;
    console.log(`[ArcClient] Creating client with baseURL: ${baseURL}`, {
      hasToken: !!token
    });

    this.client = axios.create({
      baseURL,
      timeout: timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request interceptor to inject token
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      console.log(`[ArcClient] Request to: ${config.baseURL}${config.url}`, {
        method: config.method,
        hasAuth: !!config.headers.Authorization
      });
      return config;
    });
  }

  /**
   * Update the authentication token
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Get current connection info
   */
  getConnection(): ArcConnection {
    return this.connection;
  }

  /**
   * Health check - verify server is reachable
   */
  async healthCheck(): Promise<ArcHealthStatus> {
    try {
      console.log(`[ArcClient] Attempting health check to: ${this.client.defaults.baseURL}/health`);
      const response = await this.client.get('/health');
      console.log('[ArcClient] Health check successful:', response.data);
      return response.data;
    } catch (error) {
      console.error('[ArcClient] Health check failed:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get server metrics
   */
  async getMetrics(): Promise<ArcMetrics> {
    try {
      const response = await this.client.get('/api/v1/metrics');
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create a new authentication token
   */
  async createToken(request?: TokenCreateRequest): Promise<TokenCreateResponse> {
    try {
      const response = await this.client.post('/api/v1/auth/tokens', request || {});
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Verify an authentication token
   */
  async verifyToken(): Promise<TokenVerifyResponse> {
    try {
      const response = await this.client.get('/api/v1/auth/verify');
      return { valid: true, message: response.data.message };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return { valid: false, message: 'Token is invalid or expired' };
      }
      throw this.handleError(error);
    }
  }

  /**
   * List all tokens from Arc server
   */
  async listTokens(): Promise<any[]> {
    try {
      const response = await this.client.get('/api/v1/auth/tokens');
      const data = response.data;
      return data.tokens || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a token from Arc server by ID
   */
  async deleteServerToken(tokenId: number): Promise<void> {
    try {
      await this.client.delete(`/api/v1/auth/tokens/${tokenId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Rotate a token - generates new token value while keeping metadata
   */
  async rotateServerToken(tokenId: number): Promise<any> {
    try {
      const response = await this.client.post(`/api/v1/auth/tokens/${tokenId}/rotate`);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Execute a SQL query
   */
  async executeQuery(request: QueryRequest): Promise<ArcQueryResult> {
    try {
      const endpoint = request.format === 'arrow' ? '/api/v1/query/arrow' : '/api/v1/query';
      const payload: any = {
        sql: request.query  // Arc API expects 'sql' not 'query'
      };

      // Send database via x-arc-database header (more performant than database.table syntax)
      const headers: Record<string, string> = {};
      if (request.database) {
        headers['x-arc-database'] = request.database;
      }

      // Parse response based on format
      if (request.format === 'arrow') {
        const response = await this.client.post(endpoint, payload, {
          headers,
          responseType: 'arraybuffer'
        });

        // Arrow format returns binary IPC data -- parsed in arrowParser.ts
        const { parseArrowResponse } = await import('../utils/arrowParser.js');
        const parsed = parseArrowResponse(response.data);
        return {
          columns: parsed.columns,
          rows: parsed.rows,
          rowCount: parsed.rowCount,
          executionTime: undefined
        };
      } else {
        const response = await this.client.post(endpoint, payload, { headers });

        // JSON format - Arc returns 'data' field with rows
        const responseData = response.data;
        return {
          columns: responseData.columns || [],
          rows: responseData.data || responseData.rows || [],  // Try 'data' first, then 'rows'
          rowCount: responseData.row_count || responseData.data?.length || 0,
          executionTime: responseData.execution_time_ms
        };
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * List measurements through Arc's database-scoped endpoint. This avoids
   * guessing column positions in SHOW TABLES responses and lets Arc apply
   * per-database RBAC before returning names.
   */
  async getMeasurements(database?: string): Promise<MeasurementInfo[]> {
    try {
      const endpoint = database
        ? `/api/v1/databases/${encodeURIComponent(database)}/measurements`
        : '/api/v1/measurements';
      const response = await this.client.get(endpoint);
      const data = response.data;
      const measurements = Array.isArray(data) ? data : data?.measurements;
      if (!Array.isArray(measurements)) {
        throw new Error('Unexpected measurement listing response from Arc');
      }
      return filterValidNames(measurements.map((item: any) =>
        typeof item === 'string' ? item : item?.name
      )).map(name => ({ name }));
    } catch (error) {
      const refusal = this.asAccessError(error);
      if (refusal) throw refusal;
      if (database && axios.isAxiosError(error) && error.response?.status === 404) {
        const detail = serverErrorMessage(error.response.data);
        // Older Arc versions may not expose the database-scoped route yet.
        // Keep the previous measurements endpoint as a 404-only fallback;
        // never use it to retry an RBAC refusal from the scoped route.
        if (!detail || !/database.*not found/i.test(detail)) {
          try {
            const fallback = await this.client.get('/api/v1/measurements', { params: { database } });
            const fallbackData = fallback.data;
            const names = Array.isArray(fallbackData) ? fallbackData : fallbackData?.measurements;
            if (Array.isArray(names)) {
              return filterValidNames(names.map((item: any) =>
                typeof item === 'string' ? item : item?.name
              )).map(name => ({ name }));
            }
          } catch (fallbackError) {
            const fallbackRefusal = this.asAccessError(fallbackError);
            if (fallbackRefusal) throw fallbackRefusal;
            const fallbackDetail = axios.isAxiosError(fallbackError)
              ? serverErrorMessage(fallbackError.response?.data)
              : undefined;
            if (fallbackDetail) throw new Error(fallbackDetail);
            throw this.handleError(fallbackError);
          }
        }
        if (detail) throw new Error(detail);
      }
      if (axios.isAxiosError(error)) {
        const detail = serverErrorMessage(error.response?.data);
        if (detail) throw new Error(detail);
      }
      throw this.handleError(error);
    }
  }

  /**
   * Returns an ArcAccessError when the error is Arc refusing the request —
   * 401, or one of the three different things it answers 403 with — and
   * undefined for anything else.
   *
   * Arc's 403s are told apart by message, not by status, so this is the one
   * place that reads them (see utils/arcErrors.ts). It exists separately from
   * handleError because callers need to branch on WHICH refusal it was, not
   * just print it: a scoped token can still work once a database is named,
   * while a token with no read permission cannot.
   */
  private asAccessError(error: unknown): ArcAccessError | undefined {
    if (isScopedRefusal(error) || error instanceof ArcAccessError) {
      return error;
    }
    if (!axios.isAxiosError(error)) {
      return undefined;
    }
    const status = error.response?.status;
    if (status !== 401 && status !== 403) {
      return undefined;
    }
    return new ArcAccessError(classifyArcError(status, serverErrorMessage(error.response?.data)));
  }

  /**
   * List databases using Arc's first-class database API.
   */
  async getDatabases(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/v1/databases');
      const databases = response.data?.databases;
      if (!Array.isArray(databases)) {
        throw new Error('Unexpected database listing response from Arc');
      }
      return filterValidNames(databases.map((database: any) => database?.name));
    } catch (error) {
      // A refusal is not a connectivity problem and must not be answered with
      // a made-up database. Arc restricts list-all through the same RBAC gate
      // as SHOW DATABASES, so preserve the classifier introduced in #19.
      const refusal = this.asAccessError(error);
      if (refusal) throw refusal;
      // Older Arc versions may not expose the database resource route yet.
      // Fall back to SHOW DATABASES only for a missing route; a 401/403 from
      // either endpoint is surfaced rather than turned into a fake database.
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        try {
          const legacy = await this.client.post('/api/v1/query', { sql: 'SHOW DATABASES;' });
          const rows = legacy.data?.data || legacy.data?.rows || [];
          if (Array.isArray(rows)) {
            return filterValidNames(rows.map((row: any[]) => row[0]));
          }
        } catch (fallbackError) {
          const fallbackRefusal = this.asAccessError(fallbackError);
          if (fallbackRefusal) throw fallbackRefusal;
          console.warn('Legacy SHOW DATABASES fallback failed:', fallbackError);
        }
      }
      // Keep the existing lenient root for transport/server failures so users
      // can still retry from the Explorer on older or unavailable servers.
      if (axios.isAxiosError(error)) {
        console.warn('Failed to fetch databases, using default:', error.message);
        return ['default'];
      }
      throw this.handleError(error);
    }
  }

  /** Create a database through Arc's admin-protected database API. */
  async createDatabase(name: string): Promise<void> {
    const validation = validateDatabaseName(name);
    if (validation) throw new Error(validation);
    try {
      await this.client.post('/api/v1/databases', { name });
    } catch (error) {
      throw this.handleDatabaseMutationError(error, 'create');
    }
  }

  /**
   * Delete a database after the UI has confirmed the destructive action.
   * Arc requires both an admin token and the explicit `confirm=true` query.
   */
  async deleteDatabase(name: string): Promise<void> {
    const validation = validateDatabaseName(name);
    if (validation) throw new Error(validation);
    try {
      await this.client.delete(`/api/v1/databases/${encodeURIComponent(name)}`, {
        params: { confirm: 'true' }
      });
    } catch (error) {
      throw this.handleDatabaseMutationError(error, 'delete');
    }
  }

  private handleDatabaseMutationError(error: unknown, operation: 'create' | 'delete'): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const detail = serverErrorMessage(error.response?.data);
      if (status === 403) {
        // Delete can also be disabled server-side or target a reserved name;
        // neither is an admin-token problem. A broken permission store is a
        // server fault, not a reason to rotate the token.
        if (detail && /delete operations are disabled|reserved database/i.test(detail)) {
          return new Error(detail);
        }
        if (detail && /permission data unavailable/i.test(detail)) {
          return new Error(`${detail} This is a server-side fault; check the Arc server log.`);
        }
        if (detail && /enterprise license/i.test(detail)) return new Error(detail);
        return new Error(`${detail || `Arc refused to ${operation} the database.`} This operation requires an admin token.`);
      }
      if (detail) return new Error(detail);
      if (status === 400 || status === 404 || status === 409) {
        return new Error(`Arc could not ${operation} the database.`);
      }
    }
    return this.handleError(error);
  }

  /**
   * Write data points using Arc's MessagePack columnar format.
   *
   * Previously this built line protocol by string concatenation with no
   * escaping, so any tag or field value containing a space, comma, '=' or
   * quote produced a malformed line -- silently corrupting data, or splitting
   * a value into extra tags. msgpack carries values as typed data instead, so
   * there is nothing to escape and nothing to get wrong. It is also the format
   * CSVImporter already uses, and the faster path on the Arc side.
   *
   * Timestamps are passed through untouched: Arc auto-detects seconds,
   * milliseconds, microseconds or nanoseconds from magnitude.
   */
  async writeData(measurement: string, data: any[], database?: string): Promise<void> {
    try {
      if (data.length === 0) {
        return;
      }

      // Row-wise input -> columnar. Every column must be the same length, so
      // collect the full key set first and pad rows that omit a key with null.
      const tagKeys = new Set<string>();
      const fieldKeys = new Set<string>();
      for (const point of data) {
        Object.keys(point.tags ?? {}).forEach(k => tagKeys.add(k));
        Object.keys(point.fields ?? {}).forEach(k => fieldKeys.add(k));
      }

      const columns: Record<string, any[]> = {
        time: data.map(p => p.timestamp ?? Date.now())
      };
      for (const key of tagKeys) {
        columns[key] = data.map(p => p.tags?.[key] ?? null);
      }
      for (const key of fieldKeys) {
        // A field colliding with a tag name would otherwise overwrite it
        // silently; keep the tag and surface the conflict.
        if (key in columns) {
          throw new Error(`Column "${key}" is used as both a tag and a field`);
        }
        columns[key] = data.map(p => p.fields?.[key] ?? null);
      }

      const { encode } = await import('@msgpack/msgpack');
      const payload = encode({ m: measurement, columns });

      const writeHeaders: Record<string, string> = { 'Content-Type': 'application/msgpack' };
      if (database) {
        writeHeaders['x-arc-database'] = database;
      }

      await this.client.post('/api/v1/write/msgpack', payload, {
        headers: writeHeaders
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Handle and normalize errors
   */
  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const responseData = axiosError.response?.data as any;

      // Build detailed error message
      let message = responseData?.message || axiosError.message || 'Unknown error';

      // Add more context for common errors
      if (axiosError.code === 'ECONNREFUSED') {
        message = `Cannot connect to ${this.connection.protocol}://${this.connection.host}:${this.connection.port} - Connection refused`;
      } else if (axiosError.code === 'ENOTFOUND') {
        message = `Cannot resolve hostname: ${this.connection.host}`;
      } else if (axiosError.code === 'ETIMEDOUT') {
        message = `Connection timeout to ${this.connection.host}:${this.connection.port}`;
      } else if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
        // 401 and 403 are not one condition, and 403 is not even one
        // condition by itself: Arc answers it for a token with no read
        // permission, for a token whose grants do not cover the database
        // asked for, for a licence-gated feature, and for its own permission
        // store being unreadable — distinguishable only by message. The
        // classifier reads them (utils/arcErrors.ts) and returns a sentence
        // naming the fix, so no caller has to pattern-match here and a
        // scoped token is never reported as a bad token.
        message = arcErrorMessage(
          classifyArcError(
            axiosError.response.status,
            serverErrorMessage(responseData)
          )
        );
      } else if (axiosError.response?.status === 404) {
        message = 'Endpoint not found - Check server URL';
      }

      const err = new Error(message);
      (err as any).code = axiosError.code;
      (err as any).statusCode = axiosError.response?.status;
      (err as any).originalError = axiosError;

      console.error('[ArcClient] Error details:', {
        code: axiosError.code,
        status: axiosError.response?.status,
        url: axiosError.config?.url,
        baseURL: axiosError.config?.baseURL,
        message
      });

      return err;
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error('Unknown error occurred');
  }
}

/**
 * Arc's own message from an error body. It uses `error` on most routes and
 * `message` on a few, so both are read; a non-object body (an HTML error page
 * from a proxy, say) yields undefined rather than a misleading string.
 */
function serverErrorMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const body = data as { error?: unknown; message?: unknown };
  if (typeof body.error === 'string' && body.error !== '') {
    return body.error;
  }
  if (typeof body.message === 'string' && body.message !== '') {
    return body.message;
  }
  return undefined;
}
