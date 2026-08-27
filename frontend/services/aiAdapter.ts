import { GoogleGenAI } from '@google/genai';
import { ProviderConfig, Attachment, ProviderType, StreamTelemetryCallbacks, StreamRequestOptions, TokenUsage } from '../types.ts';

const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const LEGACY_GEMINI_MODEL = 'gemini-2.5-flash';

export const VERTEX_MODEL_OPTIONS = [
  {
    label: 'Gemini 3.7 Flash（最新推荐 · 复杂推理 / 多模态 / Agent）',
    value: 'gemini-3.7-flash'
  },
  {
    label: 'Gemini 3.6 Flash（稳定高速 · 默认推荐）',
    value: 'gemini-3.6-flash'
  },
  {
    label: 'Gemini 3.5 Flash（质量 / 成本均衡）',
    value: 'gemini-3.5-flash'
  },
  {
    label: 'Gemini 3.1 Pro Preview（高阶复杂推理）',
    value: 'gemini-3.1-pro-preview'
  },
  {
    label: 'Gemini 3.5 Flash-Lite（低成本快速）',
    value: 'gemini-3.5-flash-lite'
  },
  {
    label: 'Gemini 3.1 Flash-Lite（轻量兼容）',
    value: 'gemini-3.1-flash-lite'
  },
  {
    label: 'Gemini 2.5 Pro（高质量兼容）',
    value: 'gemini-2.5-pro'
  },
  {
    label: 'Gemini 2.5 Flash（旧项目兼容）',
    value: 'gemini-2.5-flash'
  },
  {
    label: '自定义模型 ID (手动输入) …',
    value: '__custom__'
  }
];

export const DEFAULT_PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
  vertex: {
    type: 'vertex',
    apiKey: '',
    projectId: 'my-gcp-project',
    location: 'global',
    model: DEFAULT_GEMINI_MODEL
  },
  gemini: {
    type: 'gemini',
    apiKey: '',
    model: DEFAULT_GEMINI_MODEL
  },
  openai: {
    type: 'openai',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o'
  },
  deepseek: {
    type: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  openrouter: {
    type: 'openrouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet'
  },
  anthropic: {
    type: 'anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022'
  },
  'custom-openai': {
    type: 'custom-openai',
    apiKey: '',
    baseUrl: 'https://api.openai-compatible.com/v1',
    model: 'custom-model'
  }
};

export const loadStoredProviderConfig = (): ProviderConfig => {
  try {
    const raw = localStorage.getItem('ky_provider_config');
    if (raw) {
      const cfg = JSON.parse(raw) as ProviderConfig;

      if (
        (cfg.type === 'gemini' || cfg.type === 'vertex') &&
        (!cfg.model || cfg.model === LEGACY_GEMINI_MODEL)
      ) {
        const migrated = { ...cfg, model: DEFAULT_GEMINI_MODEL };
        localStorage.setItem('ky_provider_config', JSON.stringify(migrated));
        return migrated;
      }

      return cfg;
    }
  } catch (e) {
    console.error('Failed to parse provider config', e);
  }
  return DEFAULT_PROVIDER_CONFIGS.gemini;
};

export const saveStoredProviderConfig = (cfg: ProviderConfig) => {
  localStorage.setItem('ky_provider_config', JSON.stringify(cfg));
  if (cfg.type === 'gemini' && cfg.apiKey) {
    localStorage.setItem('ky_gemini_api_key', cfg.apiKey);
    if (window.process && window.process.env) {
      window.process.env.API_KEY = cfg.apiKey;
    }
  }
};

/**
 * 100% Safe and robust token counter without fragile regex ranges
 */
export function estimateTokens(prompt = '', outputText = '', thoughtText = ''): TokenUsage {
  const countChars = (str: string) => {
    if (!str) return 0;
    let cjk = 0;
    let other = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fa5) {
        cjk++;
      } else {
        other++;
      }
    }
    return Math.round(cjk * 1.3 + other * 0.4);
  };

  const pTokens = Math.max(1, countChars(prompt) + 30);
  const cTokens = countChars(outputText);
  const tTokens = countChars(thoughtText);
  const total = pTokens + cTokens + tTokens;

  return {
    promptTokens: pTokens,
    completionTokens: cTokens,
    thoughtTokens: tTokens,
    totalTokens: total
  };
}

/**
 * Universal Stream Message API with authentic real-time telemetry, thought extraction, and Token counting
 */
export async function streamMessage(
  prompt: string,
  attachments: Attachment[] = [],
  onChunk: (chunk: string, full: string) => void,
  signal?: AbortSignal,
  customConfig?: ProviderConfig,
  telemetry?: StreamTelemetryCallbacks,
  requestOptions?: StreamRequestOptions
): Promise<string> {
  const config = customConfig || loadStoredProviderConfig();
  const requestSentAt = performance.now();
  let firstTokenReceived = false;
  let fullThought = '';
  let fullText = '';
  let tokenUsageFromApi: TokenUsage | null = null;

  telemetry?.onStatusChange?.('preparing', '正在组织输入与附件...');

  // 1. If using Google Gemini SDK or Vertex AI ADC
  if (config.type === 'gemini' || config.type === 'vertex') {
    const apiKey = config.apiKey || (window.process?.env?.API_KEY || '');
    const ai = new GoogleGenAI({ 
      apiKey: apiKey || 'mock-key', 
      vertexai: config.type === 'vertex' 
    });

    const parts: any[] = [];
    attachments.forEach(att => {
      if (att.type.startsWith('image/')) {
        const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
        if (base64Data) {
          parts.push({
            inlineData: {
              mimeType: att.type,
              data: base64Data
            }
          });
        }
      }
    });
    parts.push({ text: prompt });

    const codeExecutionEnabled = requestOptions?.enableGoogleCodeExecution === true;

    telemetry?.onStatusChange?.(
      'requesting', 
      config.type === 'vertex' 
        ? `正在通过 Vertex AI ADC 连接模型 [${config.model || DEFAULT_GEMINI_MODEL}]${codeExecutionEnabled ? '，Code Execution 已开启' : ''}...`
        : `正在连接 Google Gemini API [${config.model || DEFAULT_GEMINI_MODEL}]${codeExecutionEnabled ? '，Code Execution 已开启' : ''}...`
    );

    const responseStream = await ai.models.generateContentStream({
      model: config.model || DEFAULT_GEMINI_MODEL,
      contents: {
        role: 'user',
        parts: parts
      },
      config: codeExecutionEnabled
        ? { tools: [{ codeExecution: {} }] }
        : undefined
    });

    telemetry?.onStatusChange?.('streaming', '模型正在流式输出中...');

    for await (const chunk of responseStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }

      if (!firstTokenReceived) {
        firstTokenReceived = true;
        const ttft = Math.round(performance.now() - requestSentAt);
        telemetry?.onFirstToken?.(ttft);
      }

      // Check candidate parts for thought trace if returned by model
      const candidateParts = chunk.candidates?.[0]?.content?.parts;
      if (candidateParts) {
        for (const part of candidateParts) {
          if ((part as any).thought) {
            const tText = (part as any).text || '';
            fullThought += tText;
            telemetry?.onThoughtChunk?.(tText, fullThought);
          }
        }
      }

      // Check usageMetadata from response if available
      const usage = (chunk as any).usageMetadata;
      if (usage && usage.totalTokenCount) {
        tokenUsageFromApi = {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
          thoughtTokens: usage.thoughtsTokenCount || 0
        };
        telemetry?.onTokenUsage?.(tokenUsageFromApi);
      }

      if (chunk.text) {
        fullText += chunk.text;
        onChunk(chunk.text, fullText);

        // Real-time token update during stream
        if (!tokenUsageFromApi) {
          const liveTokens = estimateTokens(prompt, fullText, fullThought);
          telemetry?.onTokenUsage?.(liveTokens);
        }
      }
    }

    // Ensure final token metadata is always reported
    const finalTokens = tokenUsageFromApi || estimateTokens(prompt, fullText, fullThought);
    telemetry?.onTokenUsage?.(finalTokens);

    return fullText;
  }

  // Handle OpenAI / DeepSeek / OpenRouter / Custom-OpenAI via Fetch SSE
  if (
    config.type === 'openai' ||
    config.type === 'deepseek' ||
    config.type === 'openrouter' ||
    config.type === 'custom-openai'
  ) {
    const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;

    const contentParts: any[] = [];
    attachments.forEach(att => {
      if (att.type.startsWith('image/')) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: att.data }
        });
      }
    });
    contentParts.push({ type: 'text', text: prompt });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    };
    if (config.type === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin;
      headers['X-Title'] = 'KaoYan Workspace';
    }

    telemetry?.onStatusChange?.('requesting', `已发送至 [${config.type}: ${config.model}]...`);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: contentParts }],
        stream: true,
        stream_options: { include_usage: true }
      }),
      signal
    });

    if (!res.ok) {
      const errText = await res.text();
      telemetry?.onStatusChange?.('failed', `API 响应错误: ${errText}`);
      throw new Error(`[${res.status} ${res.statusText}] ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response stream not readable');

    telemetry?.onStatusChange?.('streaming', '流式返回中...');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') break;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.usage) {
              tokenUsageFromApi = {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens
              };
              telemetry?.onTokenUsage?.(tokenUsageFromApi);
            }

            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                const ttft = Math.round(performance.now() - requestSentAt);
                telemetry?.onFirstToken?.(ttft);
              }
              fullText += delta;
              onChunk(delta, fullText);

              if (!tokenUsageFromApi) {
                const liveTokens = estimateTokens(prompt, fullText, fullThought);
                telemetry?.onTokenUsage?.(liveTokens);
              }
            }
          } catch {
            // ignore non-json SSE lines
          }
        }
      }
    }

    const finalTokens = tokenUsageFromApi || estimateTokens(prompt, fullText, fullThought);
    telemetry?.onTokenUsage?.(finalTokens);

    return fullText;
  }

  // Handle Anthropic Claude
  if (config.type === 'anthropic') {
    const url = 'https://api.anthropic.com/v1/messages';
    const contentParts: any[] = [];
    attachments.forEach(att => {
      if (att.type.startsWith('image/')) {
        const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.type,
            data: base64Data
          }
        });
      }
    });
    contentParts.push({ type: 'text', text: prompt });

    telemetry?.onStatusChange?.('requesting', `已发送至 Anthropic [${config.model}]...`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: config.model || 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages: [{ role: 'user', content: contentParts }],
        stream: true
      }),
      signal
    });

    if (!res.ok) {
      const errText = await res.text();
      telemetry?.onStatusChange?.('failed', `Anthropic 错误: ${errText}`);
      throw new Error(`[${res.status} ${res.statusText}] ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response stream not readable');

    telemetry?.onStatusChange?.('streaming', 'Claude 正在流式输出...');

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'message_delta' && data.usage) {
              tokenUsageFromApi = {
                completionTokens: data.usage.output_tokens,
                totalTokens: (tokenUsageFromApi?.promptTokens || 0) + data.usage.output_tokens
              };
              telemetry?.onTokenUsage?.(tokenUsageFromApi);
            }
            if (data.type === 'message_start' && data.message?.usage) {
              tokenUsageFromApi = {
                promptTokens: data.message.usage.input_tokens,
                totalTokens: data.message.usage.input_tokens
              };
              telemetry?.onTokenUsage?.(tokenUsageFromApi);
            }
            if (data.type === 'content_block_delta' && data.delta?.text) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                const ttft = Math.round(performance.now() - requestSentAt);
                telemetry?.onFirstToken?.(ttft);
              }
              fullText += data.delta.text;
              onChunk(data.delta.text, fullText);

              if (!tokenUsageFromApi) {
                const liveTokens = estimateTokens(prompt, fullText, fullThought);
                telemetry?.onTokenUsage?.(liveTokens);
              }
            }
          } catch {}
        }
      }
    }

    const finalTokens = tokenUsageFromApi || estimateTokens(prompt, fullText, fullThought);
    telemetry?.onTokenUsage?.(finalTokens);

    return fullText;
  }

  throw new Error(`Unsupported provider: ${config.type}`);
}

/**
 * Universal Synchronous / Block Message API
 */
export async function sendMessage(
  prompt: string,
  attachments: Attachment[] = [],
  customConfig?: ProviderConfig,
  telemetry?: StreamTelemetryCallbacks
): Promise<string> {
  return await streamMessage(prompt, attachments, () => {}, undefined, customConfig, telemetry);
}

/**
 * Test Connection Function with granular error diagnostic
 */
export async function testProviderConnection(config: ProviderConfig): Promise<{ success: boolean; message: string }> {
  try {
    if (config.type === 'gemini') {
      if (!config.apiKey) return { success: false, message: 'API Key is empty' };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model || DEFAULT_GEMINI_MODEL}:generateContent?key=${config.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error?.message || `${res.status} ${res.statusText}`;
        return { success: false, message: msg };
      }
      return { success: true, message: `✓ Gemini API 连接成功 (${config.model || DEFAULT_GEMINI_MODEL})` };
    }

    if (config.type === 'vertex') {
      const model = config.model || DEFAULT_GEMINI_MODEL;
      const apiKey = config.apiKey || (window.process?.env?.API_KEY || '');
      const ai = new GoogleGenAI({
        apiKey: apiKey || 'mock-key',
        vertexai: true
      });

      await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }]
      });

      return {
        success: true,
        message: `✓ Vertex AI (ADC) 连接成功 (${model})`
      };
    }

    if (
      config.type === 'openai' ||
      config.type === 'deepseek' ||
      config.type === 'openrouter' ||
      config.type === 'custom-openai'
    ) {
      if (!config.apiKey && config.type !== 'custom-openai') {
        return { success: false, message: 'API Key is required' };
      }
      const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error?.message || `${res.status} ${res.statusText}`;
        return { success: false, message: msg };
      }
      return { success: true, message: `✓ ${config.type} 连接成功 (${config.model})` };
    }

    if (config.type === 'anthropic') {
      if (!config.apiKey) return { success: false, message: 'Anthropic API Key is required' };
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: config.model || 'claude-3-5-sonnet-20241022',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error?.message || `${res.status} ${res.statusText}`;
        return { success: false, message: msg };
      }
      return { success: true, message: `✓ Anthropic 连接成功 (${config.model})` };
    }

    return { success: false, message: 'Unknown provider' };
  } catch (err: any) {
    return { success: false, message: err.message || 'Network error / CORS blocked' };
  }
}
