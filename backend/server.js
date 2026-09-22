
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import 'dotenv/config';
import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.use(express.json({limit: process?.env?.API_PAYLOAD_MAX_SIZE || "7mb"}));

const PORT = process?.env?.API_BACKEND_PORT || 5001;
const API_BACKEND_HOST = process?.env?.API_BACKEND_HOST || "127.0.0.1";

const GOOGLE_CLOUD_LOCATION = process?.env?.GOOGLE_CLOUD_LOCATION;
const GOOGLE_CLOUD_PROJECT = process?.env?.GOOGLE_CLOUD_PROJECT;
if (!GOOGLE_CLOUD_PROJECT || !GOOGLE_CLOUD_LOCATION) {
  console.error("Error: Environment variables GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set.");
  process.exit(1);
}

const ALLOWED_CLIENT_ORIGINS = new Set([
  'https://kekeyo.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

// Keep a small, privacy-safe request journal in memory.  It deliberately
// excludes prompts, attachments, tokens and authorization headers; it exists
// solely to tell a local user whether a failure happened before Vertex, at
// Vertex, or while the response stream was being consumed.
const MAX_DIAGNOSTIC_EVENTS = 100;
const diagnosticEvents = [];

function recordDiagnostic(event) {
  diagnosticEvents.unshift({ at: new Date().toISOString(), ...event });
  if (diagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) diagnosticEvents.length = MAX_DIAGNOSTIC_EVENTS;
  console.log(`[StudyHelp diagnostics] ${JSON.stringify(diagnosticEvents[0])}`);
}

function safeMessage(value, fallback = '本地代理发生未知错误。') {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 700);
  if (value && typeof value.message === 'string' && value.message.trim()) return value.message.trim().slice(0, 700);
  return fallback;
}

function classifyFailure(status, error, phase = 'request') {
  if (phase === 'stream') return { category: 'stream_interrupted', retryable: true, label: '模型输出流中断' };
  if (status === 400) return { category: 'invalid_request', retryable: false, label: '请求参数或模型工具不兼容' };
  if (status === 401 || status === 403) return { category: 'adc_authentication', retryable: false, label: 'ADC 认证或项目权限失败' };
  if (status === 404) return { category: 'model_or_endpoint', retryable: false, label: '模型或接口不可用' };
  if (status === 429) return { category: 'rate_limited', retryable: true, label: 'Vertex 请求限流' };
  const code = error?.code || error?.cause?.code;
  if (code || error instanceof TypeError) return { category: 'network_or_proxy', retryable: true, label: '本机代理或网络连接失败' };
  if (status >= 500) return { category: 'vertex_unavailable', retryable: true, label: 'Vertex 上游服务暂不可用' };
  return { category: 'proxy_internal', retryable: true, label: '本地代理处理失败' };
}

function errorPayload({ requestId, status, error, phase, upstreamMessage }) {
  const classification = classifyFailure(status, error, phase);
  return {
    error: {
      requestId,
      category: classification.category,
      label: classification.label,
      message: upstreamMessage || safeMessage(error),
      retryable: classification.retryable,
      status: status || 500,
    },
  };
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_CLIENT_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'This local proxy does not allow the requesting site.' });
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-StudyHelp-Request-Id');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'studyhelp-local-vertex-proxy', diagnostics: diagnosticEvents.length });
});

app.get('/diagnostics', (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_DIAGNOSTIC_EVENTS) : 30;
  res.json({ ok: true, events: diagnosticEvents.slice(0, limit) });
});

app.get('/diagnostics/:requestId', (req, res) => {
  const event = diagnosticEvents.find(item => item.requestId === req.params.requestId);
  if (!event) return res.status(404).json({ error: { message: '未找到该诊断记录；本地代理重启后记录会清空。' } });
  res.json({ ok: true, event });
});

app.set('trust proxy', 1 /* number of proxies between user and server */);

// IMPORTANT: Vertex AI Studio Rate Limiting
// This rate limiting configuration protects your backend APIs from abuse.
// Removing it exposes your service to DoS attacks and unexpected costs.
const proxyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Set ratelimit window at 15min (in ms)
    max: 100, // Limit each IP to 100 requests per window 
    standardHeaders: true, // Return rate limit info in the "RateLimit-*" headers
    legacyHeaders: false, // no "X-RateLimit-*" headers
    message: {
      error: 'Too many requests',
      message: 'You have exceed the request limit, please try again later.'
    },
});
// Apply the rate limiter to the /api-proxy route before the main proxy logic
app.use('/api-proxy', proxyLimiter);

/**
 * Vertex returns streamGenerateContent as a JSON array, but TCP/Undici chunks
 * have no relationship to JSON-object boundaries. Extract each complete JSON
 * object and keep only the unfinished suffix for the next data event.
 */
function transformVertexJsonStream(response) {
  const events = [];
  let cursor = 0;

  const skipSeparators = () => {
    while (cursor < response.length && /[\s,\[\]]/.test(response[cursor])) cursor += 1;
    // Accept SSE framing too, in case an upstream endpoint switches formats.
    if (response.startsWith('data:', cursor)) {
      cursor += 5;
      while (cursor < response.length && /\s/.test(response[cursor])) cursor += 1;
    }
  };

  while (cursor < response.length) {
    skipSeparators();
    if (cursor >= response.length) break;

    // A partial "data:" prefix or JSON value is retained until more bytes
    // arrive rather than being treated as malformed output.
    if (response[cursor] !== '{') {
      return { result: events.join(''), remaining: response.slice(cursor) };
    }

    const objectStart = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectEnd = -1;

    for (; cursor < response.length; cursor += 1) {
      const character = response[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          objectEnd = cursor;
          break;
        }
      }
    }

    if (objectEnd < 0) {
      return { result: events.join(''), remaining: response.slice(objectStart) };
    }

    const parsedResponse = JSON.parse(response.slice(objectStart, objectEnd + 1));
    events.push(`data: ${JSON.stringify(parsedResponse)}\n\n`);
    cursor = objectEnd + 1;
  }

  return { result: events.join(''), remaining: '' };
}

const API_CLIENT_MAP = [
 {
    name: "VertexGenAi:generateContent",
    patternForProxy: "https://aiplatform.googleapis.com/{{version}}/publishers/google/models/{{model}}:generateContent",
    getApiEndpoint: (context, params) => {
      return `https://aiplatform.clients6.google.com/${params['version']}/projects/${context.projectId}/locations/${context.region}/publishers/google/models/${params['model']}:generateContent`;
    },
    isStreaming: false,
    transformFn: null,
  },
 {
    name: "VertexGenAi:predict",
    patternForProxy: "https://aiplatform.googleapis.com/{{version}}/publishers/google/models/{{model}}:predict",
    getApiEndpoint: (context, params) => {
      return `https://aiplatform.clients6.google.com/${params['version']}/projects/${context.projectId}/locations/${context.region}/publishers/google/models/${params['model']}:predict`;
    },
    isStreaming: false,
    transformFn: null,
  },
 {
    name: "VertexGenAi:streamGenerateContent",
    patternForProxy: "https://aiplatform.googleapis.com/{{version}}/publishers/google/models/{{model}}:streamGenerateContent",
    getApiEndpoint: (context, params) => {
      return `https://aiplatform.clients6.google.com/${params['version']}/projects/${context.projectId}/locations/${context.region}/publishers/google/models/${params['model']}:streamGenerateContent`;
    },
    isStreaming: true,
    transformFn: transformVertexJsonStream,
  },
].map((client) => ({ ...client, patternInfo: parsePattern(client.patternForProxy) }));

// IMPORTANT: Vertex AI Studio SSRF Protection
// The set below is the exhaustive allow-list of upstream hostnames this
// proxy may forward authenticated requests to. It is sourced at code
// generation time from the RestApiClient.getAllowedUpstreamHosts() of every
// client embedded in API_CLIENT_MAP. Removing, weakening, or widening this
// check (for example, by adding wildcards or computing entries from request
// data) re-introduces the SSRF vulnerability that allows the deployed
// service account's OAuth access token to be exfiltrated to an
// attacker-controlled host.
const ALLOWED_UPSTREAM_HOSTS = new Set([
  "aiplatform.clients6.google.com",
]);

// Uses Google Application Default Credentials (ADC).
// Users need to run "gcloud auth application-default login" in order to use the proxy.
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePattern(pattern) {
  const paramRegex = /\{\{(.*?)\}\}/g;
  const params = [];
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = paramRegex.exec(pattern)) !== null) {
    params.push(match[1]);
    const literalPart = pattern.substring(lastIndex, match.index);
    parts.push(escapeRegex(literalPart));
    parts.push(`(?<${match[1]}>[^/]+)`);
    lastIndex = paramRegex.lastIndex;
  }
  parts.push(escapeRegex(pattern.substring(lastIndex)));
  const regexString = parts.join('');

  return {regex: new RegExp(`^${regexString}$`), params};
}

function extractParams(patternInfo, url) {
  const match = url.match(patternInfo.regex);
  if (!match) return null;
  const params = {};
  patternInfo.params.forEach((paramName, index) => {
    params[paramName] = match[index + 1];
  });
  return params;
}

async function getAccessToken() {
  try {
    const authClient = await auth.getClient();
    const token = await authClient.getAccessToken();
    return token.token;
  } catch (error) {
    console.error('[Node Proxy] Authentication error:', error);
    const authError = new Error(
      error.code === 'ERR_GCLOUD_NOT_LOGGED_IN' || error.message?.includes('Could not load the default credentials')
        ? '未找到有效的 Google ADC。请执行 gcloud auth application-default login 后重试。'
        : `读取 Google ADC 失败：${safeMessage(error)}`
    );
    authError.code = error.code || 'ADC_AUTH_FAILED';
    authError.status = 401;
    throw authError;
  }
}

function getRequestHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'X-Goog-User-Project': GOOGLE_CLOUD_PROJECT,
    'Content-Type': 'application/json',
  };
}

// --- Proxy Endpoint ---
app.post('/api-proxy', async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader('X-StudyHelp-Request-Id', requestId);
  const { originalUrl, method, headers, body } = req.body;
  if (!originalUrl) {
    const payload = errorPayload({ requestId, status: 400, upstreamMessage: '请求缺少 originalUrl。' });
    recordDiagnostic({ requestId, outcome: 'failed', category: payload.error.category, status: 400, durationMs: Date.now() - startedAt });
    return res.status(400).json(payload);
  }

  // 1. Find the matching API client
  const apiClient = API_CLIENT_MAP.find(p => {
    // We store extractedParams on req for use later if needed, though getVertexUrl takes it as arg.
    req.extractedParams = extractParams(p.patternInfo, originalUrl);
    return req.extractedParams !== null;
  });

  if (!apiClient) {
    console.error(`[Node Proxy] No API client handler found for URL: ${originalUrl}`);
    const payload = errorPayload({ requestId, status: 404, upstreamMessage: '本地代理不支持该 Vertex 接口。' });
    recordDiagnostic({ requestId, outcome: 'failed', category: payload.error.category, status: 404, durationMs: Date.now() - startedAt });
    return res.status(404).json(payload);
  }

  const extractedParams = req.extractedParams;
  const requestInfo = { requestId, client: apiClient.name, model: extractedParams.model, stream: apiClient.isStreaming };
  console.log(`[Node Proxy] [${requestId}] Matched API client: ${apiClient.name}`);
  try {
    // 2. Get authenticated access token
    const accessToken = await getAccessToken();

    // 3. Construct the full API URL using env-set GOOGLE_CLOUD_PROJECT/LOCATION and extracted params
    const context = {projectId: GOOGLE_CLOUD_PROJECT, region: GOOGLE_CLOUD_LOCATION};
    const apiUrl = apiClient.getApiEndpoint(context, extractedParams);

    // IMPORTANT: Vertex AI Studio SSRF Protection
    // Parse the constructed apiUrl with the standard URL parser (not a
    // regex) and require the resulting hostname to be in the hardcoded
    // ALLOWED_UPSTREAM_HOSTS set. This neutralizes attacks that smuggle a
    // URL-grammar delimiter (e.g. '#') into a pattern parameter to redirect
    // the authenticated upstream request to an attacker-controlled host.
    let parsedApiUrl;
    try {
      parsedApiUrl = new URL(apiUrl);
    } catch (e) {
      console.error(`[Node Proxy] Invalid API URL: ${apiUrl}`);
      const payload = errorPayload({ requestId, status: 400, upstreamMessage: '本地代理构造的 Vertex 地址无效。' });
      recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: 400, durationMs: Date.now() - startedAt });
      return res.status(400).json(payload);
    }
    if (!ALLOWED_UPSTREAM_HOSTS.has(parsedApiUrl.hostname.toLowerCase())) {
      console.error(`[Node Proxy] Upstream host not allowed: ${parsedApiUrl.hostname}`);
      const payload = errorPayload({ requestId, status: 400, upstreamMessage: 'Vertex 上游主机不在本地代理白名单中。' });
      recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: 400, durationMs: Date.now() - startedAt });
      return res.status(400).json(payload);
    }
    console.log(`[Node Proxy] Forwarding to Vertex API: ${apiUrl}`);

    // 4. Prepare headers for the API call
    const apiHeaders = getRequestHeaders(accessToken);

    const apiFetchOptions = {
      method: method || 'POST',
      headers: {...apiHeaders, ...headers},
      body: body ? body : undefined,
    };

    // 5. Make the call to the API
    const apiResponse = await fetch(apiUrl, apiFetchOptions);

    // Surface upstream failures as ordinary HTTP errors. Treating an error
    // body as a successful stream would otherwise make the page appear blank.
    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      let upstreamMessage = errorBody;
      try {
        const parsed = JSON.parse(errorBody);
        upstreamMessage = parsed?.error?.message || parsed?.message || errorBody;
      } catch { /* Vertex may return plain text. */ }
      const payload = errorPayload({ requestId, status: apiResponse.status, upstreamMessage });
      recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: apiResponse.status, durationMs: Date.now() - startedAt });
      return res.status(apiResponse.status).json(payload);
    }

    // 6. Respond to the client based on stream type
    if (apiClient.isStreaming) {
      console.log(`[Node Proxy] Sending STREAMING response for ${apiClient.name}`);
      // Set headers for a streaming JSON response
      res.writeHead(apiResponse.status, {
        'Content-Type': 'text/event-stream',
        'Transfer-Encoding': 'chunked',
        'Connection': 'keep-alive',
      });
      // Immediately send headers
      res.flushHeaders();

      if (!apiResponse.body) {
        console.error('[Node Proxy] Streaming response has no body.');
        const payload = errorPayload({ requestId, status: 502, phase: 'stream', upstreamMessage: 'Vertex 返回了空的流式响应。' });
        recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: 502, durationMs: Date.now() - startedAt });
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        return res.end();
      }

      const responseBody = Readable.fromWeb(apiResponse.body);
      const decoder = new TextDecoder();
      let deltaChunk = '';
      responseBody.on('data', (encodedChunk) => {
        if (res.writableEnded) return; // Prevent writing after res.end()

        try {
          if (!apiClient.transformFn) {
            res.write(encodedChunk);
          } else {
            const decodedChunk = decoder.decode(encodedChunk, { stream: true });
            deltaChunk = deltaChunk + decodedChunk;

            const {result, remaining} = apiClient.transformFn(deltaChunk);
            deltaChunk = remaining;
            if (result) res.write(new TextEncoder().encode(result));
          }
        } catch (error) {
          console.error(`[Node Proxy] Error processing streaming response for ${apiClient.name}`);
          console.error(error);
          const payload = errorPayload({ requestId, status: 502, error, phase: 'stream' });
          recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: 502, durationMs: Date.now() - startedAt });
          if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
          responseBody.destroy(error);
        }
      });

      responseBody.on('end', () => {
        if (deltaChunk.trim()) {
          console.error('[Node Proxy] Vertex stream ended with an incomplete JSON response.');
          if (!res.writableEnded) {
            const payload = errorPayload({ requestId, status: 502, phase: 'stream', upstreamMessage: 'Vertex 输出流在完整响应前结束。' });
            recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: 502, durationMs: Date.now() - startedAt });
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          }
        } else {
          recordDiagnostic({ ...requestInfo, outcome: 'success', status: apiResponse.status, durationMs: Date.now() - startedAt });
        }
        deltaChunk = '';
        console.log(`[Node Proxy] Vertex stream finished and all data processed for ${apiClient.name}`);
        res.end();
      });

      responseBody.on('error', (streamError) => {
        console.error('[Node Proxy] Error from Vertex stream:', streamError);
        if (!res.writableEnded) {
          const payload = errorPayload({ requestId, status: 502, error: streamError, phase: 'stream' });
          recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status: 502, durationMs: Date.now() - startedAt });
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          res.end();
        }
      });

      res.on('error', (resError) => {
        console.error('[Node Proxy] Error writing to client response:', resError);
        // The source stream might need to be destroyed if an error occurs here.
        responseBody.destroy(resError);
      });
    } else {
      // Non-streaming response handling
      console.log(`[Node Proxy] Sending JSON response for ${apiClient.name}`);
      const data = await apiResponse.json();
      recordDiagnostic({ ...requestInfo, outcome: 'success', status: apiResponse.status, durationMs: Date.now() - startedAt });
      res.status(apiResponse.status).json(data);
    }
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    const payload = errorPayload({ requestId, status, error });
    console.error(`[Node Proxy] [${requestId}] Error proxying request for ${apiClient.name}:`, safeMessage(error));
    recordDiagnostic({ ...requestInfo, outcome: 'failed', category: payload.error.category, status, durationMs: Date.now() - startedAt });
    if (!res.headersSent) res.status(status).json(payload);
  }
});

const server = app.listen(PORT, API_BACKEND_HOST, () => {
  console.log(`Vertex AI Backend listening at http://localhost:${PORT}`);
});


const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (!ALLOWED_CLIENT_ORIGINS.has(request.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  if (url.pathname === '/ws-proxy') {
    
    let targetUrl = url.searchParams.get('target');
    if (!targetUrl) {
      console.log('[Node Proxy] Missing target URL');
      socket.destroy();
      return;
    }

    if (targetUrl === 'wss://aiplatform.googleapis.com//ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent') {
      const location = GOOGLE_CLOUD_LOCATION === 'global' ? 'us-central1' : GOOGLE_CLOUD_LOCATION;
      targetUrl = `wss://${location}-aiplatform.googleapis.com//ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
    } else {
      console.log('[Node Proxy] Invalid target URL');
      socket.destroy();
      return;
    }

    let accessToken;

    try {
      accessToken = await getAccessToken();
      if (!accessToken) throw new Error('No token');
    } catch (err) {
      console.log('[Node Proxy] Authentication failed');
      socket.destroy();
      return;
    }

    console.log(`[Node Proxy] Initiating upstream connection to: ${targetUrl}`);

    let upstreamWs;

    try {
      upstreamWs = new WebSocket(targetUrl, {
        headers: getRequestHeaders(accessToken)
      });
    } catch (e) {
      console.error('[Node Proxy] Invalid Upstream URL');
      socket.destroy();
      return;
    }

    const initialErrorHandler = (error) => {
      console.error('[Node Proxy] Upstream connection failed:', error);
      upstreamWs.removeEventListener('open', onUpstreamOpen);

      if (socket.writable) {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      }
    };

    upstreamWs.once('error', initialErrorHandler);

    // 5. Handle Successful Upstream Connection
    const onUpstreamOpen = () => {
      // Remove the "bootstrapping" error handler
      upstreamWs.removeListener('error', initialErrorHandler);

      // Perform the HTTP -> WebSocket upgrade for the Client
      wss.handleUpgrade(request, socket, head, (ws) => {

        upstreamWs.on('message', (data, isBinary) => {
          const logMsg = isBinary ? '<Binary Data>' : data.toString();
          console.log(`[Upstream -> Client] [${new Date().toISOString()}]: ${logMsg}`);

          if (ws.readyState === WebSocket.OPEN) {
            if (data === undefined || data === null) {
              console.warn('[Node Proxy] Attempted to send undefined/null data to client');
              return;
            }
            ws.send(data, { binary: isBinary });
          }
        });

        ws.on('message', (data, isBinary) => {
          const logMsg = isBinary ? '<Binary Data>' : data.toString();

          let dataJson = {};
          try {
            dataJson = JSON.parse(data.toString());
          } catch (error) {
            console.error('[Node Proxy] Failed to parse message from client:', error);
            ws.close(1011, 'Failed to parse message');
          }

          if (dataJson['setup']) {
            dataJson['setup']['model'] = `projects/${GOOGLE_CLOUD_PROJECT}/locations/${GOOGLE_CLOUD_LOCATION}/${dataJson['setup']['model']}`;
          }

          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(JSON.stringify(dataJson), { binary: false });
          }
        });

        upstreamWs.on('error', (error) => {
          console.error('[Node Proxy] Upstream error:', error);
          ws.close(1011, error.message);
        });

        upstreamWs.on('close', (code, reason) => {
          console.log(`[Node Proxy] Upstream closed: ${code} ${reason}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(code, reason);
          }
        });

        ws.on('error', (error) => {
          console.error('[Node Proxy] Client error:', error);
          upstreamWs.close(1011, error.message);
        });

        ws.on('close', (code, reason) => {
          console.log(`[Node Proxy] Client closed: ${code} ${reason}`);
          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.close(1000, reason);
          }
        });

        wss.emit('connection', ws, request);
      });
    };

    upstreamWs.once('open', onUpstreamOpen);

  } else {
    // Path did not match
    socket.destroy();
  }
});
