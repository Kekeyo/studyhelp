import React, { useState, useRef } from 'react';
import { 
  Play, Square, Download, CheckCircle2, AlertCircle, Loader2, Copy, 
  Check, FileSpreadsheet, Layers, FastForward, RotateCcw, FileText,
  ArrowUp, ArrowUpToLine
} from 'lucide-react';
import Uploader from '../components/Uploader.tsx';
import MarkdownRenderer from '../components/MarkdownRenderer.tsx';
import { Attachment, TaskStatus, MathAnalysisResult, StageMetrics, ExecutionPhase, TokenUsage } from '../types.ts';
import { streamMessage, sendMessage, loadStoredProviderConfig, estimateTokens } from '../services/aiAdapter.ts';
import { RealtimeExecutionDashboard } from '../components/RealtimeExecutionDashboard.tsx';
import { ResizableSplitPane } from '../components/ResizableSplitPane.tsx';
import { exportRenderedPdf } from '../utils/pdfExporter.ts';

const MATH_SPLIT_PROMPT = `你是一名中国考研《数学一》题库整理专家。
请分析输入的文本或 PDF 题目：
1. 判断其中包含了几道独立的考研数学题目（例如：单题，或包含题目1、题目2、题目3...）。
2. 将题目按题号拆分，并给出每道题的简短标题。

请严格返回 JSON 格式：
[
  { "id": "1", "label": "题目 1", "title": "...", "text": "..." }
]`;

const MATH_DRAFT_PROMPT = `你是一名严谨的中国考研《数学一》名师。
请对该题进行【第一阶段：完整演算求解与严密推导】。

【图形参数锁定、关键点逐一计算与数值代回检验（最高原则）】：
1. 【图形提取与参数锁定】：在“## 题型与考点”后、正式做题前，必须设立【## 图像/图形信息提取】。一旦从图片中确定了积分区域 $D$ 的边界曲线方程、极坐标范围、顶点坐标、切线方程或概率分布图表特征，**必须立即锁定这些几何参数与边界约束**。后续所有计算步骤必须严格基于锁定的图形边界方程展开，严禁在后续小问中擅自改写边界或重新猜测！
2. 【候选极值/转折点逐一计算】：若涉及极值、拐点、分段换元交点，必须逐一计算全部候选点的具体数值，并结合二阶导数/Hessian矩阵/几何边界完成交叉验证。
3. 【真实代回检验与三形式一致性检查（严禁形式主义）】：
   - 任何求得的极值点、拐点、未知参数、特征值、微分方程特解数值解，**必须明确代回原方程或原定义式中重新计算验证自洽性**！
   - 严禁只口头声明通过；必须确保**因式形式、多项式展开形式、数值代入值**三者完全一致无误！
4. 【前后一致性】：各小问之间、推导步骤与最终结论之间引用的关键数值、矩阵特征值、积分上下限、导数表达式等必须 100% 保持一致，绝不允许前后出现矛盾结果！
5. 【关键性质交叉核验】：
   - 多元微积分/重积分：利用区域对称性（奇偶性、轮换对称性）做交叉计算检查。
   - 线性代数：利用矩阵迹 $\\sum \\lambda_i = \\text{tr}(A)$ 与行列式 $\\prod \\lambda_i = |A|$ 交叉检验特征值！
   - 概率论：利用全概率公式 $\\int f(x)dx = 1$、非负性、期望与方差性质交叉检验。

【Markdown 与 LaTeX 输出硬性要求（必须严格执行）】：
1. 所有回答直接输出标准 Markdown，绝对不要使用 \`\`\`markdown 或 \`\`\` 代码块包裹整个回答。
2. 数学公式规范：
   - 行内公式：统一使用 $...$（如 $f(x)$, $\\int_a^b f(x)dx$, $\\lambda_i$）
   - 独立公式：统一使用 $$...$$，独占一行
3. 【禁止裸输出任何 LaTeX 数学代码】！任何包含 \\frac, \\dfrac, \\int, \\sum, \\sqrt, \\alpha, \\beta, \\begin, \\boxed, 上下标 _、上标 ^ 等数学语法的内容，都必须完整放入 $...$ 或 $$...$$ 内。
4. cases、aligned、matrix 等环境必须整体放在同一对 $$...$$ 中，严禁把 $$ 插入公式内部。
5. 不要转义 Markdown 符号，严禁输出 \\_、\\*、\\# 等多余反斜杠！
6. 标题、正文、公式之间保留换行，输出中不得直接显示 \\int、\\frac、\\begin 等 LaTeX 源码。
7. 正确格式示例：
$$
\\left( \\int_a^b u(t)v(t)\\,\\mathrm{d}t \\right)^2 \\le \\int_a^b u^2(t)\\,\\mathrm{d}t \\int_a^b v^2(t)\\,\\mathrm{d}t
$$

分析要求：
1. 给出真实、具体的完整计算与证明推导过程（如积分换元、雅可比行列式计算、极值判别法、矩阵特征值与正交对角化运算、条件概率分布积分等），【绝不能简述带过或省略核心计算】！必须算出确切的最终数学结果。
2. 明确所属模块与考点。

输出格式：
## 题型与考点
所属模块：[高等数学 / 线性代数 / 概率论与数理统计]
核心考点：...

## 图像/图形信息提取
[详细写明从图形锁定的边界曲线方程、交点坐标与几何约束，锁定数值供后续全篇严格继承引用；若无图则写“无图形附件”]

## 详细演算与推导过程
[给出具体每一步的等式运算、积分计算、矩阵变换与代回自验过程，展示三形式一致性]

## 确切结果
[给出明确的最终数学表达式与数值结论]`;

const MATH_REVIEW_PROMPT = `你是一名独立的考研《数学一》Reviewer。
主动核对第一阶段给出的【图像与图形识别准确性、参数锁定、完整演算过程、数值代回验算真实性、三形式一致性与最终结果】：

【第二阶段开始首要核查项：图形锁定与代回真实性核查】：
1. 【读图准确性检查】：检查第一阶段对原题图形/几何区域的读图是否正确和准确？积分边界、极坐标范围、顶点坐标是否读对？
2. 【参数锁定与继承检查】：核查后续推导是否【100%严格沿用】了锁定的几何图形边界？是否存在中途重新猜测、改写边界或前后数值矛盾的漏洞？
3. 【代回验算与三形式一致性核查】：核查第一阶段求出的数值解是否实际代回原方程验证？因式形式、展开形式与数值代入计算三者是否 100% 吻合？严禁口头形式主义验算！

【计算与自洽性核查要点】：
- 前后引用的关键变量、特征值、积分限是否存在自相矛盾？
- 积分换元法中雅可比行列式/上下限是否计算正确？是否用对称性检验过？
- 矩阵特征值之和是否等于迹？特征值之积是否等于行列式？
- 概率密度积分为 1 的全概率条件是否满足？
- 是否有增根、减根、漏解？

输出格式要求（直接输出标准 Markdown，公式统一用 $...$）：
### 图像/图形识别与参数锁定核查
- 读图准确性检查：[评价读图与边界提取是否准确无误]
- 参数锁定与继承检查：[评价后续步骤是否严格继承锁定参数，有无中途篡改]

### 三形式一致性与代回真实性自检查
- 真实代回计算：[评价是否写出代回原方程的实际计算过程，非口头声明]
- 三形式一致性：[评价因式形式、展开形式与代入数值计算三者是否完全吻合]

### 全文推导与自洽性检查
评分：[0-100] / 100
前后自洽性检查：[完全一致 / 存在前后矛盾（具体指出矛盾处）]
检查结论：[指出推导计算是否正确且前后自洽，若有错误明确指出哪一步计算有误]`;

const MATH_FINAL_PROMPT = `你是一名严谨的中国考研《数学一》权威名师。
请结合原题、第一阶段推导出的完整演算与 Reviewer 核查结果，写出【考研数学一标准参考答案的完美书写过程】。

【前后一致性与格式规范】：
1. 确保前后步骤、数值与最终答案 100% 保持一致，严格沿用锁定的图形参数，无任何逻辑断层或矛盾结论。包含必要的代回验算与三形式一致性核查步骤。
2. 直接输出规范 Markdown，绝对不要使用 \`\`\`markdown 代码块包裹整个回答。
3. 数学公式规范：
   - 行内公式：统一使用 $...$
   - 独立公式：统一使用 $$...$$
4. 禁止出现任何裸 LaTeX！所有 \\dfrac、\\int、\\sum、\\alpha、\\begin、\\boxed 等内容必须完整包裹在 $...$ 或 $$...$$ 内。
5. cases、aligned、matrix 等环境必须整体放在同一对 $$...$$ 中，严禁将 $$ 拆分插入公式中间。
6. 不要转义 Markdown 符号，严禁输出 \\_、\\*、\\#。
7. 标题、正文、公式分行书写，保持结构整洁。

包含：
## (a)
### 解
[完美书写解题过程与关键验证]
### 答
[最终答案]

## (b)
### 解
...
### 答
...

## 最终结论
...`;

const MATH_CONTINUE_PROMPT = `你是一名严谨的中国考研《数学一》权威名师。
上一轮由于网络中断或 Token 达到限制，解答未输出完整。
直接输出标准 Markdown，不要使用代码块，请紧跟已有的前半部分，严格沿用前文已确定的数值与表达式，继续向下输出剩余步骤与最终结果，所有公式必须包含在 $...$ 或 $$...$$ 中，严禁裸输出 \\int, \\frac, \\begin，不要输出 \\_、\\*、\\# 等转义字符。`;

const createInitialMathStageMetrics = (): Record<ExecutionPhase, StageMetrics> => {
  const currentCfg = loadStoredProviderConfig();
  return {
    stage1_draft: {
      stageId: 'stage1_draft',
      stageName: '第一阶段：完整演算与推导',
      status: 'pending',
      modelUsed: currentCfg.model,
      thinkingLevel: currentCfg.thinkingLevel || 'normal',
      charCount: 0,
      tokensCount: 0
    },
    stage2_review: {
      stageId: 'stage2_review',
      stageName: '第二阶段：独立自检与核查',
      status: 'pending',
      modelUsed: currentCfg.model,
      thinkingLevel: currentCfg.thinkingLevel || 'normal',
      charCount: 0,
      tokensCount: 0
    },
    stage3_final: {
      stageId: 'stage3_final',
      stageName: '第三阶段：考研标准答卷书写',
      status: 'pending',
      modelUsed: currentCfg.model,
      thinkingLevel: currentCfg.thinkingLevel || 'normal',
      charCount: 0,
      tokensCount: 0
    }
  };
};

export const MathOne: React.FC = () => {
  const [textInput, setTextInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.IDLE);
  const [statusText, setStatusText] = useState('');
  const [activeStageId, setActiveStageId] = useState<ExecutionPhase | undefined>();
  const [stageMetrics, setStageMetrics] = useState<Record<ExecutionPhase, StageMetrics>>(createInitialMathStageMetrics);

  const [questions, setQuestions] = useState<Array<{ id: string; label: string; title: string; text: string }>>([]);
  const [selectedQIdx, setSelectedQIdx] = useState(0);

  const [result, setResult] = useState<MathAnalysisResult>({
    draftAnswer: '',
    reviewScore: null,
    reviewText: '',
    finalAnswer: ''
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [failedStageName, setFailedStageName] = useState<string>('');
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [copiedFinal, setCopiedFinal] = useState(false);

  // Track scroll position for persistent floating jump buttons
  const [scrollTop, setScrollTop] = useState(0);

  const rightScrollContainerRef = useRef<HTMLDivElement>(null);
  const mathStage1TopRef = useRef<HTMLDivElement>(null);
  const mathStage3TopRef = useRef<HTMLDivElement>(null);
  const draftRenderRef = useRef<HTMLDivElement>(null);
  const finalRenderRef = useRef<HTMLDivElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleScroll = () => {
    if (rightScrollContainerRef.current) {
      setScrollTop(rightScrollContainerRef.current.scrollTop);
    }
  };

  const scrollToStage1Top = () => {
    mathStage1TopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToStage3Top = () => {
    mathStage3TopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const updateStage = (stageId: ExecutionPhase, updates: Partial<StageMetrics>) => {
    setStageMetrics(prev => {
      const existing = prev[stageId];
      const mergedUsage = updates.tokenUsage || existing.tokenUsage;
      const mergedTokens = updates.tokensCount ?? updates.tokenUsage?.totalTokens ?? existing.tokensCount ?? existing.tokenUsage?.totalTokens ?? 0;
      return {
        ...prev,
        [stageId]: {
          ...existing,
          ...updates,
          tokenUsage: mergedUsage,
          tokensCount: mergedTokens
        }
      };
    });
  };

  const handleFilesAdded = (newFiles: Attachment[], extractedText?: string) => {
    setAttachments(prev => [...prev, ...newFiles]);
    if (extractedText) {
      setTextInput(prev => (prev ? `${prev}\n\n${extractedText}` : extractedText));
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    let foundImage = false;
    const pastedImages: Attachment[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        foundImage = true;
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          const promise = new Promise<Attachment>((resolve) => {
            reader.onload = (event) => {
              resolve({
                name: `剪贴板截图_${new Date().toLocaleTimeString().replace(/:/g, '')}.png`,
                type: file.type,
                data: event.target?.result as string,
                size: file.size
              });
            };
            reader.readAsDataURL(file);
          });
          const att = await promise;
          pastedImages.push(att);
        }
      }
    }

    if (foundImage) {
      e.stopPropagation();
      if (pastedImages.length > 0) {
        setAttachments(prev => [...prev, ...pastedImages]);
      }
    }
  };

  const handleStartAnalysis = async () => {
    if (!textInput.trim() && attachments.length === 0) {
      setErrorMsg('请在左侧粘贴数学题目或上传数学 PDF/图片');
      return;
    }
    setErrorMsg('');
    setFailedStageName('');
    setResult({ draftAnswer: '', reviewScore: null, reviewText: '', finalAnswer: '' });
    setStageMetrics(createInitialMathStageMetrics());
    await runWorkflow(true);
  };

  const handleResumeAnalysis = async () => {
    if (!textInput.trim() && attachments.length === 0) {
      setErrorMsg('请在左侧粘贴数学题目或上传数学 PDF/图片');
      return;
    }
    setErrorMsg('');
    setFailedStageName('');
    await runWorkflow(false);
  };

  const runWorkflow = async (fromScratch: boolean) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const cfg = loadStoredProviderConfig();

    try {
      let currentQuestionText = textInput;
      if (textInput.length > 50 && (fromScratch || questions.length === 0)) {
        setStatus(TaskStatus.PARSING);
        setStatusText('正在结构化解析数学一试卷结构...');
        try {
          const splitRes = await sendMessage(
            `${MATH_SPLIT_PROMPT}\n\n${textInput}`,
            attachments,
            cfg
          );
          const parsed = JSON.parse(splitRes.replace(/```json|```/g, '').trim());
          if (Array.isArray(parsed) && parsed.length > 1) {
            setQuestions(parsed);
            currentQuestionText = parsed[0].text;
          } else {
            setQuestions([{ id: '1', label: '题目 1', title: '单题解析', text: textInput }]);
          }
        } catch {
          setQuestions([{ id: '1', label: '题目 1', title: '数学题', text: textInput }]);
        }
      }

      let currentDraft = result.draftAnswer;
      let currentReview = result.reviewText;
      let currentFinal = result.finalAnswer;

      // ==========================================
      // Stage 1: Mathematical Calculation
      // ==========================================
      if (fromScratch || !currentDraft.trim()) {
        setActiveStageId('stage1_draft');
        setStatus(TaskStatus.DRAFTING);
        setStatusText('第一阶段：正在进行数学推导演算、各候选点计算与代回验算...');

        const s1Start = performance.now();
        const s1Prompt = `${MATH_DRAFT_PROMPT}\n\n题目内容：\n${currentQuestionText}`;

        updateStage('stage1_draft', {
          status: 'requesting',
          modelUsed: cfg.model,
          thinkingLevel: cfg.thinkingLevel || 'normal',
          requestSentAt: s1Start,
          charCount: 0,
          tokensCount: 0
        });

        currentDraft = await streamMessage(
          s1Prompt,
          attachments,
          (delta, full) => {
            const currentDuration = Math.round(performance.now() - s1Start);
            setResult(prev => ({ ...prev, draftAnswer: full }));
            const liveTokens = estimateTokens(s1Prompt, full);
            updateStage('stage1_draft', { 
              charCount: full.length,
              durationMs: currentDuration,
              tokenUsage: liveTokens,
              tokensCount: liveTokens.totalTokens
            });
          },
          signal,
          cfg,
          {
            onStatusChange: (s, detail) => {
              updateStage('stage1_draft', { status: s });
              if (detail) setStatusText(`第一阶段推导: ${detail}`);
            },
            onFirstToken: (ttft) => {
              updateStage('stage1_draft', { ttftMs: ttft });
            },
            onThoughtChunk: (chunk, fullT) => {
              updateStage('stage1_draft', { thoughtText: fullT });
            },
            onTokenUsage: (usage: TokenUsage) => {
              updateStage('stage1_draft', { 
                tokenUsage: usage,
                tokensCount: usage.totalTokens
              });
            }
          },
          { enableGoogleCodeExecution: true }
        );

        const s1Duration = Math.round(performance.now() - s1Start);
        const finalS1Tokens = estimateTokens(s1Prompt, currentDraft);
        setResult(prev => ({ ...prev, draftAnswer: currentDraft }));
        updateStage('stage1_draft', {
          status: 'completed',
          completedAt: performance.now(),
          durationMs: s1Duration,
          charCount: currentDraft.length,
          tokenUsage: finalS1Tokens,
          tokensCount: finalS1Tokens.totalTokens
        });
      }

      // ==========================================
      // Stage 2: Independent Reviewer
      // ==========================================
      if (fromScratch || !currentReview.trim()) {
        setActiveStageId('stage2_review');
        setStatus(TaskStatus.REVIEWING);
        setStatusText('第二阶段：正在核查三形式一致性、代回真实性与全问自洽性...');

        const s2Start = performance.now();
        const reviewInput = `原题：\n${currentQuestionText}\n\n第一阶段推导与答案（含图形提取与锁定参数）：\n${currentDraft}`;
        const s2Prompt = `${MATH_REVIEW_PROMPT}\n\n${reviewInput}`;

        updateStage('stage2_review', {
          status: 'requesting',
          modelUsed: cfg.model,
          thinkingLevel: cfg.thinkingLevel || 'normal',
          requestSentAt: s2Start,
          charCount: 0,
          tokensCount: 0
        });

        currentReview = await streamMessage(
          s2Prompt,
          attachments,
          (delta, full) => {
            const currentDuration = Math.round(performance.now() - s2Start);
            setResult(prev => ({ ...prev, reviewText: full }));
            const liveTokens = estimateTokens(s2Prompt, full);
            updateStage('stage2_review', { 
              charCount: full.length,
              durationMs: currentDuration,
              tokenUsage: liveTokens,
              tokensCount: liveTokens.totalTokens
            });
          },
          signal,
          cfg,
          {
            onStatusChange: (s, detail) => {
              updateStage('stage2_review', { status: s });
              if (detail) setStatusText(`第二阶段自检: ${detail}`);
            },
            onFirstToken: (ttft) => {
              updateStage('stage2_review', { ttftMs: ttft });
            },
            onThoughtChunk: (chunk, fullT) => {
              updateStage('stage2_review', { thoughtText: fullT });
            },
            onTokenUsage: (usage: TokenUsage) => {
              updateStage('stage2_review', { 
                tokenUsage: usage,
                tokensCount: usage.totalTokens
              });
            }
          }
        );

        const s2Duration = Math.round(performance.now() - s2Start);
        const scoreMatch = currentReview.match(/评分：\s*(\d+)/) || currentReview.match(/(\d+)\s*\/\s*100/);
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 95;
        const finalS2Tokens = estimateTokens(s2Prompt, currentReview);

        setResult(prev => ({ ...prev, reviewScore: score, reviewText: currentReview }));
        updateStage('stage2_review', {
          status: 'completed',
          completedAt: performance.now(),
          durationMs: s2Duration,
          charCount: currentReview.length,
          tokenUsage: finalS2Tokens,
          tokensCount: finalS2Tokens.totalTokens
        });
      }

      // ==========================================
      // Stage 3: Final Exam Solution
      // ==========================================
      setActiveStageId('stage3_final');
      setStatus(TaskStatus.FINALIZING);
      setStatusText('第三阶段：自检完成，正在调用模型生成数学一标准解答...');

      const s3Start = performance.now();
      updateStage('stage3_final', {
        status: 'requesting',
        modelUsed: cfg.model,
        thinkingLevel: cfg.thinkingLevel || 'normal',
        requestSentAt: s3Start,
        charCount: 0,
        tokensCount: 0
      });

      if (currentFinal.trim().length > 40) {
        const existing = currentFinal;
        const continueInput = `原题：\n${currentQuestionText}\n\n已写出的前半部分解答：\n${existing}\n\n请接着往下写：`;
        const s3Prompt = `${MATH_CONTINUE_PROMPT}\n\n${continueInput}`;

        const streamed = await streamMessage(
          s3Prompt,
          attachments,
          (delta, full) => {
            const combined = `${existing}\n\n${full}`;
            const currentDuration = Math.round(performance.now() - s3Start);
            setResult(prev => ({ ...prev, finalAnswer: combined }));
            const liveTokens = estimateTokens(s3Prompt, full);
            updateStage('stage3_final', { 
              charCount: combined.length,
              durationMs: currentDuration,
              tokenUsage: liveTokens,
              tokensCount: liveTokens.totalTokens
            });
          },
          signal,
          cfg,
          {
            onStatusChange: (s, detail) => {
              updateStage('stage3_final', { status: s });
              if (detail) setStatusText(`第三阶段书写: ${detail}`);
            },
            onFirstToken: (ttft) => {
              updateStage('stage3_final', { ttftMs: ttft });
            },
            onThoughtChunk: (chunk, fullT) => {
              updateStage('stage3_final', { thoughtText: fullT });
            },
            onTokenUsage: (usage: TokenUsage) => {
              updateStage('stage3_final', { 
                tokenUsage: usage,
                tokensCount: usage.totalTokens
              });
            }
          }
        );

        const s3Duration = Math.round(performance.now() - s3Start);
        const finalFullOutput = `${existing}\n\n${streamed}`;
        const finalS3Tokens = estimateTokens(s3Prompt, streamed);
        setResult(prev => ({ ...prev, finalAnswer: finalFullOutput }));
        updateStage('stage3_final', {
          status: 'completed',
          completedAt: performance.now(),
          durationMs: s3Duration,
          charCount: finalFullOutput.length,
          tokenUsage: finalS3Tokens,
          tokensCount: finalS3Tokens.totalTokens
        });
      } else {
        const finalInput = `原题：\n${currentQuestionText}\n\n第一阶段推导演算与结果：\n${currentDraft}\n\nReviewer 意见：\n${currentReview}`;
        const s3Prompt = `${MATH_FINAL_PROMPT}\n\n${finalInput}`;

        const finalStreamed = await streamMessage(
          s3Prompt,
          attachments,
          (delta, full) => {
            const currentDuration = Math.round(performance.now() - s3Start);
            setResult(prev => ({ ...prev, finalAnswer: full }));
            const liveTokens = estimateTokens(s3Prompt, full);
            updateStage('stage3_final', { 
              charCount: full.length,
              durationMs: currentDuration,
              tokenUsage: liveTokens,
              tokensCount: liveTokens.totalTokens
            });
          },
          signal,
          cfg,
          {
            onStatusChange: (s, detail) => {
              updateStage('stage3_final', { status: s });
              if (detail) setStatusText(`第三阶段书写: ${detail}`);
            },
            onFirstToken: (ttft) => {
              updateStage('stage3_final', { ttftMs: ttft });
            },
            onThoughtChunk: (chunk, fullT) => {
              updateStage('stage3_final', { thoughtText: fullT });
            },
            onTokenUsage: (usage: TokenUsage) => {
              updateStage('stage3_final', { 
                tokenUsage: usage,
                tokensCount: usage.totalTokens
              });
            }
          }
        );

        const s3Duration = Math.round(performance.now() - s3Start);
        const finalS3Tokens = estimateTokens(s3Prompt, finalStreamed);
        setResult(prev => ({ ...prev, finalAnswer: finalStreamed }));
        updateStage('stage3_final', {
          status: 'completed',
          completedAt: performance.now(),
          durationMs: s3Duration,
          charCount: finalStreamed.length,
          tokenUsage: finalS3Tokens,
          tokensCount: finalS3Tokens.totalTokens
        });
      }

      setStatus(TaskStatus.DONE);
      setStatusText('全流程考研数学一推理与解答生成完成');
    } catch (err: any) {
      if (err.message !== 'Aborted') {
        setStatus(TaskStatus.ERROR);
        const failedStage = activeStageId || 'stage1_draft';
        const stageLabel = stageMetrics[failedStage]?.stageName || '当前阶段';
        setFailedStageName(stageLabel);
        updateStage(failedStage, {
          status: 'failed',
          error: err.message
        });
        setErrorMsg(err.message || '求解中断，可点击“继续分析”');
        setStatusText(`执行失败于【${stageLabel}】`);
      }
    }
  };

  const handleSelectQuestion = (idx: number) => {
    setSelectedQIdx(idx);
    const q = questions[idx];
    if (q) {
      setTextInput(q.text);
    }
  };

  const isInterrupted = status === TaskStatus.ERROR || (status === TaskStatus.IDLE && Boolean(result.draftAnswer && !result.finalAnswer));
  const isDone = status === TaskStatus.DONE;
  const isProcessing = status === TaskStatus.PARSING || status === TaskStatus.DRAFTING || status === TaskStatus.REVIEWING || status === TaskStatus.FINALIZING;

  // Safe copy helper with fallback to document.execCommand('copy')
  const handleCopy = (text: string, isDraft = false) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
          if (isDraft) {
            setCopiedDraft(true);
            setTimeout(() => setCopiedDraft(false), 2000);
          } else {
            setCopiedFinal(true);
            setTimeout(() => setCopiedFinal(false), 2000);
          }
        }).catch(() => {
          fallbackCopy(text, isDraft);
        });
      } else {
        fallbackCopy(text, isDraft);
      }
    } catch {
      fallbackCopy(text, isDraft);
    }
  };

  const fallbackCopy = (text: string, isDraft = false) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      if (isDraft) {
        setCopiedDraft(true);
        setTimeout(() => setCopiedDraft(false), 2000);
      } else {
        setCopiedFinal(true);
        setTimeout(() => setCopiedFinal(false), 2000);
      }
    } catch (e) {
      console.warn('Copy command fallback failed:', e);
    }
  };

  const handleExportDraftMarkdown = () => {
    const content = `# 考研数学一 - 第一阶段推导与求解\n\n## 原题\n${textInput}\n\n## 第一阶段推导计算过程与结果\n${result.draftAnswer}`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `数学一_第一阶段推导_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintDraftPdf = () => {
    exportRenderedPdf(
      '考研《数学一》第一阶段推导与结果',
      draftRenderRef.current,
      result.draftAnswer
    );
  };

  const handlePrintFinalPdf = () => {
    exportRenderedPdf(
      '考研《数学一》最终标准解答',
      finalRenderRef.current,
      result.finalAnswer
    );
  };

  const leftInputContent = (
    <div className="w-full h-full flex flex-col gap-3.5 bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4 overflow-y-auto min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-5 bg-blue-600 rounded-full"></div>
          <h2 className="font-bold text-slate-800 text-base">数学一题目输入</h2>
        </div>
        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
          高数 / 线代 / 概率
        </span>
      </div>

      {/* Multi-Question Tabs if detected */}
      {questions.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0">
          {questions.map((q, idx) => (
            <button
              key={q.id}
              onClick={() => handleSelectQuestion(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedQIdx === idx
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      {/* 1. TOP BOX: Text Input Area */}
      <div className="flex-1 min-h-[160px] flex flex-col relative">
        <textarea
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onPaste={handlePaste}
          placeholder="粘贴数学一题目，如：&#10;设 f(x) 连续，计算二重积分 \iint_D (x^2 + y) dxdy...&#10;支持上传包含多题的完整 PDF 试卷。&#10;&#10;💡 支持直接 Ctrl+V / 粘贴题目截图"
          className="flex-1 w-full p-3.5 text-sm bg-slate-50/50 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-sans leading-relaxed"
        />
      </div>

      {/* 2. BOTTOM BOX: Uploader Area */}
      <div className="shrink-0">
        <Uploader
          attachments={attachments}
          onFilesAdded={handleFilesAdded}
          onRemove={(idx) => setAttachments(attachments.filter((_, i) => i !== idx))}
        />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2 pt-1 shrink-0">
        {status === TaskStatus.IDLE || isDone || status === TaskStatus.ERROR ? (
          <div className="flex items-center gap-2">
            {isInterrupted ? (
              <>
                <button
                  onClick={handleResumeAnalysis}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm"
                  title="从中断处直接接着分析"
                >
                  <FastForward size={16} className="fill-current" />
                  <span>继续分析 (断点续解)</span>
                </button>
                <button
                  onClick={handleStartAnalysis}
                  className="p-2.5 text-slate-500 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-medium transition-colors"
                  title="重新开始"
                >
                  <RotateCcw size={16} />
                </button>
              </>
            ) : (
              <button
                onClick={handleStartAnalysis}
                className="flex-1 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm"
              >
                {isDone ? <RotateCcw size={16} /> : <Play size={16} className="fill-current" />}
                <span>{isDone ? '重新开始求解' : '开始求解'}</span>
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => abortControllerRef.current?.abort()}
            className="w-full bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 text-sm"
          >
            <Square size={15} className="fill-current" />
            <span>停止</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex flex-col gap-2 shrink-0">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
            <div className="space-y-1">
              {failedStageName && (
                <div className="font-bold text-rose-900">执行中断于：{failedStageName}</div>
              )}
              <div className="break-all font-mono leading-relaxed">{errorMsg}</div>
            </div>
          </div>
          {isInterrupted && (
            <button
              onClick={handleResumeAnalysis}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors text-xs"
            >
              <FastForward size={13} />
              <span>从中断阶段继续重试</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  const rightOutputContent = (
    <div 
      ref={rightScrollContainerRef}
      onScroll={handleScroll}
      className="w-full h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1 relative"
    >
      {/* Initial Empty State Placeholder when IDLE */}
      {status === TaskStatus.IDLE && !result.draftAnswer && (
        <div className="flex-1 bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-xs">
            <Layers size={26} />
          </div>
          <h3 className="font-bold text-slate-800 text-base mb-1">数学一智能解题工作台</h3>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            输入题目并点击“开始求解”，系统将自动提取图形区域信息并给出详细考点演算与符合考研答卷标准规范的解答。
          </p>
        </div>
      )}

      {/* Real Event-Driven AI Execution Telemetry Dashboard for MathOne */}
      {(isProcessing || status === TaskStatus.DONE || status === TaskStatus.ERROR) && (
        <RealtimeExecutionDashboard
          stages={stageMetrics}
          activeStageId={activeStageId}
          statusText={statusText}
          status={status}
        />
      )}

      {/* Section 1: Stage 1 Derivation with Copy/Download/PDF Toolbar */}
      {result.draftAnswer && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 shrink-0 relative group/stage1">
          {/* Target header ref for smooth upward navigation to Math Stage 1 */}
          <div ref={mathStage1TopRef} className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">第一阶段</span>
              <h3 className="font-bold text-slate-700 text-sm">完整推导求解与图形特征提取（自检闭环）</h3>
            </div>
            {/* Stage 1 Toolbar: Copy, Download .md and Export PDF */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCopy(result.draftAnswer, true)}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                title="复制第一阶段推导内容"
              >
                {copiedDraft ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                <span>{copiedDraft ? '已复制' : '复制推导'}</span>
              </button>
              <button
                onClick={handleExportDraftMarkdown}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                title="导出第一阶段推导 .md 文件"
              >
                <FileText size={13} />
                <span>导出推导 .md</span>
              </button>
              <button
                onClick={handlePrintDraftPdf}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                title="导出第一阶段排版好的 PDF"
              >
                <Download size={13} />
                <span>导出推导 PDF</span>
              </button>
            </div>
          </div>
          <div ref={draftRenderRef}>
            <MarkdownRenderer 
              content={result.draftAnswer} 
            />
          </div>
        </div>
      )}

      {/* Section 2: Reviewer */}
      {result.reviewText && (
        <div className="bg-slate-50/80 rounded-2xl border border-slate-200 p-5 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 mb-3">
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">第二阶段：图形核验、参数锁定与自洽核查</span>
            {result.reviewScore !== null && (
              <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full border border-emerald-200">
                评分：{result.reviewScore} / 100
              </span>
            )}
          </div>
          <MarkdownRenderer 
            content={result.reviewText} 
          />
        </div>
      )}

      {/* Section 3: Final */}
      {result.finalAnswer && (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-5 shrink-0 relative">
          {/* Target header ref for smooth upward navigation to Math Stage 3 */}
          <div ref={mathStage3TopRef} className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-5 bg-blue-600 rounded-sm"></span>
              <h3 className="font-extrabold text-slate-900 text-base">考研数学一标准解答（完美书写过程）</h3>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCopy(result.finalAnswer, false)}
                className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1"
                title="复制内容"
              >
                {copiedFinal ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                <span>{copiedFinal ? '已复制' : '复制'}</span>
              </button>
              <button
                onClick={handlePrintFinalPdf}
                className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1"
                title="导出 PDF"
              >
                <Download size={13} />
                <span>导出 PDF</span>
              </button>
            </div>
          </div>
          <div ref={finalRenderRef}>
            <MarkdownRenderer 
              content={result.finalAnswer} 
            />
          </div>

          {isInterrupted && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <div>
                <button
                  onClick={handleResumeAnalysis}
                  className="px-3 py-1 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200 hover:border-blue-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <FastForward size={13} />
                  <span>继续向下输出</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Persistent Jump Buttons for MathOne */}
      {(result.draftAnswer || result.finalAnswer) && scrollTop > 120 && (
        <div className="sticky bottom-4 right-4 self-end flex items-center gap-2 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200">
          {result.draftAnswer && (
            <button
              type="button"
              onClick={scrollToStage1Top}
              className="bg-white/95 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-xs font-semibold px-3 py-2 rounded-xl shadow-lg border border-slate-200/90 hover:border-blue-300 backdrop-blur-sm transition-all flex items-center gap-1.5 group"
              title="向上跳转到第一阶段推导顶部（复制/导出）"
            >
              <div className="w-5 h-5 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <ArrowUp size={12} />
              </div>
              <span>阶段 1 顶部 (复制/导出)</span>
            </button>
          )}

          {result.finalAnswer && (
            <button
              type="button"
              onClick={scrollToStage3Top}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-1.5"
              title="向上跳转到第三阶段解答顶部（复制/导出）"
            >
              <ArrowUpToLine size={13} />
              <span>阶段 3 解答 (复制/导出)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ResizableSplitPane
      leftContent={leftInputContent}
      rightContent={rightOutputContent}
      defaultLeftWidth={420}
      minLeftWidth={300}
    />
  );
};

export default MathOne;
