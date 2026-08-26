export enum Subject {
  SIGNAL = 'SIGNAL',
  MATH = 'MATH',
  ENGLISH = 'ENGLISH'
}

export enum EnglishCategory {
  SHORT_ESSAY = 'SHORT_ESSAY', // 小作文 / 应用文
  LONG_ESSAY = 'LONG_ESSAY'    // 大作文
}

export enum EnglishMode {
  AUTO = 'AUTO',
  MODE_A = 'MODE_A', // 仅有题目 -> 生成参考高分范文 & 逻辑升级版
  MODE_B = 'MODE_B'  // 题目+学生作文 -> 原文批改与优化 & 高分重写
}

export type ProviderType = 
  | 'vertex'
  | 'gemini'
  | 'openai'
  | 'deepseek'
  | 'openrouter'
  | 'anthropic'
  | 'custom-openai';

export type ThinkingLevel = 'off' | 'low' | 'normal' | 'high';

export interface ProviderConfig {
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  projectId?: string;
  location?: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  thinkingBudget?: number;
}

export enum TaskStatus {
  IDLE = 'IDLE',
  PARSING = 'PARSING',
  DRAFTING = 'DRAFTING',
  REVIEWING = 'REVIEWING',
  FINALIZING = 'FINALIZING',
  DONE = 'DONE',
  ERROR = 'ERROR'
}

export type ExecutionPhase = 'stage1_draft' | 'stage2_review' | 'stage3_final';

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
}

export interface StageMetrics {
  stageId: ExecutionPhase;
  stageName: string;
  status: 'pending' | 'preparing' | 'requesting' | 'streaming' | 'completed' | 'failed';
  modelUsed: string;
  thinkingLevel: ThinkingLevel;
  requestSentAt?: number;
  ttftMs?: number; // Time to First Token (ms)
  completedAt?: number;
  durationMs?: number; // Phase duration (ms)
  charCount: number;
  thoughtText?: string;
  tokenUsage?: TokenUsage;
  tokensCount?: number; // Total tokens for this stage
  error?: string;
}

export interface StreamTelemetryCallbacks {
  onStatusChange?: (status: StageMetrics['status'], detail?: string) => void;
  onFirstToken?: (ttftMs: number) => void;
  onThoughtChunk?: (thoughtChunk: string, fullThought: string) => void;
  onMetricsUpdate?: (metrics: Partial<StageMetrics>) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
}

export interface Attachment {
  name: string;
  type: string;
  data: string; // dataUrl / base64
  size?: number;
}

export interface SubQuestion {
  id: string;
  label: string; // e.g. "(a)", "题目 1"
  text: string;
}

export interface Problem {
  id: string;
  subject: Subject;
  sourceType: 'text' | 'pdf' | 'md' | 'image';
  title?: string;
  rawText: string;
  attachments: Attachment[];
  subQuestions?: SubQuestion[];
  selectedSubIndex?: number;
  metadata?: Record<string, any>;
}

export interface SignalAnalysisResult {
  chaptersDetected?: string[];
  coreKnowledge?: string;
  draftAnswer: string;
  reviewScore: number | null;
  reviewDetails: {
    correctness?: string;
    completeness?: string;
    rigor?: string;
    issuesSummary?: string;
  };
  reviewText: string;
  finalAnswer: string;
}

export interface MathAnalysisResult {
  mathModule?: string; // 高等数学 / 线性代数 / 概率论
  corePoints?: string;
  draftAnswer: string;
  reviewScore: number | null;
  reviewText: string;
  finalAnswer: string;
}

export interface EnglishAnalysisResult {
  detectedMode: EnglishMode;
  detectedType: string;
  topicSummary: string;
  version1: string;
  score1: number | string;
  score1Rationale?: string;
  version2: string;
  score2: number | string;
  score2Rationale?: string;
}

export interface HistoryRecord {
  id: string;
  subject: Subject;
  title: string;
  createdAt: string;
  problem: Problem;
  result: any;
}
