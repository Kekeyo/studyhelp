import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, Square, Edit3, Download, CheckCircle2, AlertCircle, Loader2, 
  Copy, BookOpen, Sparkles, Check, FileText, FastForward, RotateCcw,
  ArrowUp, ArrowUpToLine, ChevronUp
} from 'lucide-react';
import Uploader from '../components/Uploader.tsx';
import MarkdownRenderer from '../components/MarkdownRenderer.tsx';
import { Attachment, TaskStatus, SignalAnalysisResult, StageMetrics, ExecutionPhase, TokenUsage } from '../types.ts';
import { streamMessage, sendMessage, loadStoredProviderConfig, estimateTokens } from '../services/aiAdapter.ts';
import { RealtimeExecutionDashboard } from '../components/RealtimeExecutionDashboard.tsx';
import { ResizableSplitPane } from '../components/ResizableSplitPane.tsx';
import { exportRenderedPdf } from '../utils/pdfExporter.ts';

const DRAFT_PROMPT = `你是一名严谨的中国考研《信号与系统》专业教师。默认参考奥本海默《Signals and Systems》理论体系。
请对题目进行【第一阶段：完整独立计算求解与推导】。

【波形折点计算与交叉验证硬性规则（凡画图/求波形题必做）】：
1. 【逐个计算全部候选折点】：凡题目要求画出或求解卷积、自相关、互相关或系统输出响应波形，**必须列出全部候选折点（包括起始点、峰值点、转折点、截止点）的具体数值与坐标 $(t_k, y(t_k))$**，严禁只画示意草图而无确切折点值！
2. 【镜像与对称性双重交叉验证】：
   - 必须至少用【全部整数节点/关键折点数值计算】+【自相关偶对称性 $\\phi_{xx}(t)=\\phi_{xx}(-t)$ / 互相关镜像关系 $\\phi_{xy}(t)=\\phi_{yx}(-t)$】进行双重交叉核验。
   - 验证不通过时，绝对不得输出波形或结论，必须重新计算修正各分段积分！

【数值代回与真实验算防伪规则（严禁形式主义验算）】：
1. 【禁止空洞声称通过】：自检验算不得只写“经检验符合”等形式口号。代入后的数值必须写出实际运算步骤，并与原表达式进行独立数值比较。
2. 【三形式一致性检查】：**因式分解形式、展开多项式形式、数值代入计算值**三者之中任一不一致，禁止声称“验算通过”，必须重新计算纠偏！
3. 【最终数值解代回原方程】：求得的跳变点、最优脉冲参数等，必须实际代入原积分方程计算内积，明确展示其确实精确等于 0：
   $$
   \\int_0^4 x_0(t)x_1(t)\\,\\mathrm{d}t = \\cdots = 0
   $$

【Markdown 与 LaTeX 输出硬性要求】：
1. 直接输出规范 Markdown，不要使用 \`\`\`markdown 或 \`\`\` 代码块包裹整个回答。
2. 普通文字使用标准 Markdown。
3. 行内公式必须完整使用 $...$ 包裹（如 $x(t)=e^{-t}u(t)$, $\\phi_{xx}(t)$, $t \\in [0, 2]$）。
4. 独立公式、长公式和推导公式必须完整使用 $$...$$ 包裹，独占一行。
5. 【禁止裸输出任何 LaTeX 数学代码】！凡出现 \\frac, \\dfrac, \\int, \\sum, \\phi, \\alpha, \\sqrt, \\boxed, \\begin, \\le, \\ge, 上标 ^、下标 _ 等数学语法，必须完整位于 $...$ 或 $$...$$ 内。
6. cases、aligned、matrix 等环境必须整体放在同一对 $$...$$ 中。
7. 不要对 Markdown 符号进行多余转义，禁止输出 \\_、\\*、\\# 等形式。
8. 标题、正文、公式之间保持正常换行。

【输出结构规范】：
## 题目识别
题型：...
涉及章节：第 X 章 X.X 节

## 核心定理与公式
...

## 图像识别与条件提取
[详细写明从图片锁定的各信号波形关键坐标、跳变时刻、幅值及分段函数解析式，锁定数值供后续全篇严格继承引用；若无图则写“本题无图像附件”]

## (a)
### 解
[包含全部候选折点逐一计算、关键整数点与自相关/互相关镜像对称性交叉验证]
### 答
...

## (b)
### 解
[包含待定参数求出后实际代回原积分方程计算内积等于0的真实演算，验证三形式一致性]
### 答
...`;

const REVIEW_PROMPT = `你是一名独立、苛刻的考研《信号与系统》Answer Reviewer。
你的任务是在第二阶段一开始对第一阶段的图像识别、波形折点计算、数值代回真实性与推导进行严格核查：

【第二阶段首要核查项：波形折点与真实代回验算核查】：
1. 【全部候选折点核查】：波形题是否逐一计算出了全部候选折点（起止点、峰值、转折点）的具体数值？是否用自相关偶对称或互相关镜像关系做过交叉验证？
2. 【代回验算真实性核查】：自检验算是真实验算还是口头走过场？代入后的具体数值与因式形式、展开形式三者是否完全一致？
3. 【读图与参数锁定核查】：第一阶段读图是否准确？后续各小问是否严格沿用锁定参数？有无前后数值矛盾？

输出格式要求（直接输出标准 Markdown，公式统一用 $...$）：
### 图像识别与参数锁定核查
- 读图准确性检查：[评价读图是否正确和准确]
- 参数锁定与继承检查：[评价后续小问是否严格沿用锁定参数，有无中途改写或前后矛盾]

### 波形折点与三形式一致性自检查
- 候选折点与对称性验证：[评价是否逐一计算全部折点并用镜像对称性交叉验证通过]
- 数值代回真实性：[评价代入原方程后是否完成实际计算，因式/展开/数值三者是否一致]

### 综合核查与评分
评分：[0-100之间的整数] / 100
前后自洽性：[完全一致 / 存在前后矛盾（具体指出矛盾处）]
核查结论：[指出推导与计算是否完全正确；若有误，精确指出哪一步算错或前后不一致]`;

const FINAL_PROMPT = `你是一名严谨的中国考研《信号与系统》权威名师。
请结合原题、第一阶段给出的完整推导过程以及 Reviewer 的自检核查，给出【考研标准答卷的完美书写过程】。

【波形折点与数值代回验算书写规范】：
1. 若题目涉及波形，必须完整标明各分段区间的具体解析式、全部关键折点坐标 $(t_k, y(t_k))$ 以及镜像对称依据，呈现考研大题最严密的波形特征。
2. 任何待定参数的解题必须包含代回原方程的实际计算过程（如内积验证积分确实精确等于 0），确保因式形式、展开形式和数值代入三者完全吻合自洽。

【Markdown 与 LaTeX 输出硬性格式要求（强制执行）】：
1. 普通文字使用标准 Markdown。直接输出 Markdown 正文，绝对不要使用 \`\`\`markdown 代码块包裹答案。
2. 行内公式必须完整使用 $...$ 包裹，例如：$x(t)=e^{-t}u(t)$。
3. 独立公式、长公式和推导公式必须完整使用 $$...$$ 包裹，独占一行。
4. 【禁止裸输出任何 LaTeX 数学代码】！凡出现 \\frac, \\dfrac, \\int, \\sum, \\phi, \\alpha, \\sqrt, \\boxed, \\begin, \\le, \\ge, 上标 ^、下标 _ 等数学内容，都必须位于 $...$ 或 $$...$$ 内。
5. cases、aligned、matrix 等环境必须整体放在同一对 $$...$$ 中，例如：
$$
x(t) = \\begin{cases}
t, & 0 \\le t \\le 2, \\\\
0, & \\text{其他}.
\\end{cases}
$$
6. 不得把 $ 或 $$ 插入一个 LaTeX 公式内部，不得出现数学环境只包住半个公式的情况。
7. 不要对 Markdown 符号进行多余转义，禁止输出 \\_、\\*、\\# 等形式。
8. Markdown 标题必须单独成行：
## (a)
### 解
### 答
9. 标题、正文和独立公式之间保持正常换行。
10. 输出前自行检查：最终内容中不得出现未被数学定界符包裹的 \\int、\\frac、\\phi、\\begin{...} 等 LaTeX 源码。

【输出格式】：
## (a)
### 解
[完美书写解题过程、全部折点计算与等式变换，数学内容完整在数学定界符内]
### 答
[最终答案]

## (b)
### 解
[包含真实代回验算过程与一致性核对]
### 答
...

## 最终结论
...`;

const CONTINUE_FINAL_PROMPT = `你是一名严谨的中国考研《信号与系统》权威名师。
上一轮解答未输出完整。请紧跟已有的前半部分，严格沿用已锁定的图像参数、全部折点与推导结论，直接继续向下输出剩余小问的完美书写过程与最终结论。
硬性要求：
1. 直接输出标准 Markdown，禁止使用代码块。
2. 行内公式统一使用 $...$，独立公式统一使用 $$...$$。
3. 严禁裸输出 \\int, \\frac, \\begin，严禁将 $$ 插入公式中间，不要输出 \\_、\\*、\\# 等转义字符。
4. 标题必须单独成行，与正文、公式之间保持换行。`;

const createInitialStageMetrics = (): Record<ExecutionPhase, StageMetrics> => {
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

export const SignalSystem: React.FC = () => {
  const [textInput, setTextInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.IDLE);
  const [statusText, setStatusText] = useState('');
  const [activeStageId, setActiveStageId] = useState<ExecutionPhase | undefined>();
  const [stageMetrics, setStageMetrics] = useState<Record<ExecutionPhase, StageMetrics>>(createInitialStageMetrics);

  const [result, setResult] = useState<SignalAnalysisResult>({
    draftAnswer: '',
    reviewScore: null,
    reviewDetails: {},
    reviewText: '',
    finalAnswer: ''
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [failedStageName, setFailedStageName] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [copiedFinal, setCopiedFinal] = useState(false);

  // Track scroll position to conditionally display floating jump buttons
  const [scrollTop, setScrollTop] = useState(0);

  // References to the stage top header elements and rendered markdown containers for smooth scrolling and PDF export
  const rightScrollContainerRef = useRef<HTMLDivElement>(null);
  const stage1TopRef = useRef<HTMLDivElement>(null);
  const stage3TopRef = useRef<HTMLDivElement>(null);
  const draftRenderRef = useRef<HTMLDivElement>(null);
  const finalRenderRef = useRef<HTMLDivElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleScroll = () => {
    if (rightScrollContainerRef.current) {
      setScrollTop(rightScrollContainerRef.current.scrollTop);
    }
  };

  const scrollToStage1Top = () => {
    stage1TopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToStage3Top = () => {
    stage3TopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      setErrorMsg('请在左侧输入题目或上传相关文件 / 题目图片');
      return;
    }

    setErrorMsg('');
    setFailedStageName('');
    setResult({
      draftAnswer: '',
      reviewScore: null,
      reviewDetails: {},
      reviewText: '',
      finalAnswer: ''
    });
    setStageMetrics(createInitialStageMetrics());
    
    await runWorkflow(true);
  };

  const handleResumeAnalysis = async () => {
    if (!textInput.trim() && attachments.length === 0) {
      setErrorMsg('请在左侧输入题目或上传相关文件 / 题目图片');
      return;
    }
    setErrorMsg('');
    setFailedStageName('');
    await runWorkflow(false);
  };

  const runWorkflow = async (fromScratch: boolean) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const fullQuestion = `【考研信号与系统题目】:\n${textInput}`;
    const cfg = loadStoredProviderConfig();

    try {
      let currentDraft = result.draftAnswer;
      let currentReview = result.reviewText;
      let currentFinal = result.finalAnswer;

      // ==========================================
      // Stage 1: Full Mathematical Derivation with Breakpoint Verification
      // ==========================================
      if (fromScratch || !currentDraft.trim()) {
        setActiveStageId('stage1_draft');
        setStatus(TaskStatus.DRAFTING);
        setStatusText('第一阶段：输入准备完成，正在锁定图像并推导全部候选折点与代回验算...');
        
        const s1Start = performance.now();
        const s1Prompt = `${DRAFT_PROMPT}\n\n${fullQuestion}`;
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
              if (detail) setStatusText(`第一阶段: ${detail}`);
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
          }
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
      // Stage 2: Independent Reviewer with Image Evaluation & Consistency Check
      // ==========================================
      if (fromScratch || !currentReview.trim()) {
        setActiveStageId('stage2_review');
        setStatus(TaskStatus.REVIEWING);
        setStatusText('第二阶段：正在核查波形全部折点、三形式一致性与真实代回验算...');
        
        const s2Start = performance.now();
        const reviewInput = `原题内容：\n${fullQuestion}\n\n第一阶段推导与答案（含图像识别与锁定参数）：\n${currentDraft}`;
        const s2Prompt = `${REVIEW_PROMPT}\n\n${reviewInput}`;

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
              if (detail) setStatusText(`第二阶段核查: ${detail}`);
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

        setResult(prev => ({
          ...prev,
          reviewScore: score,
          reviewText: currentReview
        }));
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
      setStatusText('第三阶段：自检完成，正在调用模型生成标准答卷...');

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
        // Resume mode
        const resumeInput = `原题内容：\n${fullQuestion}\n\n第一阶段完整演算：\n${currentDraft}\n\n【已输出的前半部分解答如下】:\n${currentFinal}\n\n请紧跟上述内容之后，严格按照标准 Markdown + LaTeX 输出剩余推导（普通文字 Markdown，行内公式 $...$，独立公式 $$...$$，不要使用代码块，严禁裸输出 LaTeX）：`;
        const existingPrefix = currentFinal;
        const s3Prompt = `${CONTINUE_FINAL_PROMPT}\n\n${resumeInput}`;

        const streamed = await streamMessage(
          s3Prompt,
          attachments,
          (delta, full) => {
            const combined = `${existingPrefix}\n\n${full}`;
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
        const finalFullOutput = `${existingPrefix}\n\n${streamed}`;
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
        const finalInput = `原题内容：\n${fullQuestion}\n\n第一阶段推导计算过程与结果：\n${currentDraft}\n\nReviewer 核查结论：\n${currentReview}`;
        const s3Prompt = `${FINAL_PROMPT}\n\n${finalInput}`;

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
      setStatusText('全流程 AI 推理与标准解答生成完成');
    } catch (err: any) {
      if (err.message === 'Aborted') {
        setStatus(TaskStatus.IDLE);
        setStatusText('已暂停/停止生成');
      } else {
        setStatus(TaskStatus.ERROR);
        const failedStage = activeStageId || 'stage1_draft';
        const stageLabel = stageMetrics[failedStage]?.stageName || '当前阶段';
        setFailedStageName(stageLabel);
        updateStage(failedStage, {
          status: 'failed',
          error: err.message
        });
        setErrorMsg(err.message || '请求处理中断，请检查 API Token 或网络后点击“继续分析”');
        setStatusText(`执行失败于【${stageLabel}】`);
      }
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

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
    const content = `# 考研信号与系统 - 第一阶段推导与求解\n\n## 原题\n${textInput}\n\n## 第一阶段推导计算过程与结果\n${result.draftAnswer}`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `信号与系统_第一阶段推导_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    const content = `# 考研信号与系统解答\n\n## 原题\n${textInput}\n\n## 第一阶段完整推导与求解\n${result.draftAnswer}\n\n## 第二阶段核查评分 (${result.reviewScore}/100)\n${result.reviewText}\n\n${result.finalAnswer}`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `信号与系统_解答_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Robust PDF export that prints the fully rendered KaTeX DOM without clipping
  const handlePrintDraftPdf = () => {
    exportRenderedPdf(
      '考研《信号与系统》第一阶段推导与结果',
      draftRenderRef.current,
      result.draftAnswer
    );
  };

  const handlePrintFinalPdf = () => {
    exportRenderedPdf(
      '考研《信号与系统》最终标准解答',
      finalRenderRef.current,
      result.finalAnswer
    );
  };

  const isInterrupted = status === TaskStatus.ERROR || (status === TaskStatus.IDLE && Boolean(result.draftAnswer && !result.finalAnswer));
  const isDone = status === TaskStatus.DONE;
  const isProcessing = status === TaskStatus.PARSING || status === TaskStatus.DRAFTING || status === TaskStatus.REVIEWING || status === TaskStatus.FINALIZING;

  const leftInputContent = (
    <div className="w-full h-full flex flex-col gap-3.5 bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4 overflow-y-auto min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-5 bg-blue-600 rounded-full"></div>
          <h2 className="font-bold text-slate-800 text-base">题目输入</h2>
        </div>
        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
          奥本海默体系
        </span>
      </div>

      {/* 1. TOP BOX: Text Input Area */}
      <div className="flex-1 min-h-[160px] flex flex-col relative">
        <textarea
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onPaste={handlePaste}
          placeholder="在这里粘贴题目文本 / Markdown，例如：&#10;(a) 求 x(t) = e^{-2t}u(t) 的傅里叶变换&#10;(b) 求系统输出响应 y(t)&#10;(c) 判断系统因果性与稳定性...&#10;&#10;💡 支持直接 Ctrl+V / 粘贴截图图片"
          className="flex-1 w-full p-3.5 text-sm bg-slate-50/50 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-sans leading-relaxed"
        />
      </div>

      {/* 2. BOTTOM BOX: File Uploader Area */}
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
                  className="flex-1 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow text-sm"
                  title="从中断处直接接着分析"
                >
                  <FastForward size={16} className="fill-current" />
                  <span>继续分析 (断点续解)</span>
                </button>
                <button
                  onClick={handleStartAnalysis}
                  className="p-2.5 text-slate-500 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 rounded-xl font-medium transition-colors"
                  title="重新从第一阶段开始"
                >
                  <RotateCcw size={16} />
                </button>
              </>
            ) : (
              <button
                onClick={handleStartAnalysis}
                className="flex-1 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm hover:shadow text-sm"
              >
                {isDone ? <RotateCcw size={16} /> : <Play size={16} className="fill-current" />}
                <span>{isDone ? '重新开始分析' : '开始分析'}</span>
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={handleStop}
            className="w-full bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all text-sm"
          >
            <Square size={15} className="fill-current" />
            <span>停止生成</span>
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
              className="mt-0.5 w-full bg-rose-600 hover:bg-rose-700 text-white py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-xs text-xs"
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
      {/* Top Floating Mini Status Bar */}
      {status !== TaskStatus.IDLE && (result.draftAnswer || result.finalAnswer) && (
        <div className="bg-white rounded-xl px-4 py-2.5 shadow-xs border border-slate-200/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {status === TaskStatus.DONE ? (
              <CheckCircle2 size={17} className="text-emerald-500" />
            ) : status === TaskStatus.ERROR ? (
              <AlertCircle size={17} className="text-rose-500" />
            ) : (
              <Loader2 size={17} className="text-blue-600 animate-spin" />
            )}
            <span className="text-xs font-semibold text-slate-700">{statusText}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
            <span className={status === TaskStatus.DRAFTING ? 'text-blue-600 font-bold' : ''}>1.推导求解</span>
            <span>→</span>
            <span className={status === TaskStatus.REVIEWING ? 'text-blue-600 font-bold' : ''}>2.核查评分</span>
            <span>→</span>
            <span className={status === TaskStatus.FINALIZING ? 'text-blue-600 font-bold' : ''}>3.标准书写</span>
          </div>
        </div>
      )}

      {/* Initial Empty State Placeholder when IDLE */}
      {status === TaskStatus.IDLE && !result.draftAnswer && (
        <div className="flex-1 bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-xs">
            <BookOpen size={26} />
          </div>
          <h3 className="font-bold text-slate-800 text-base mb-1">信号与系统核心解题工作台</h3>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            输入题目并点击“开始分析”，系统将在第一阶段给出完整推导、图像识别特征与自检，消除前后矛盾，并在最终阶段呈现完美的考研标准书写答卷。
          </p>
        </div>
      )}

      {/* Real Event-Driven AI Execution Telemetry Dashboard */}
      {(isProcessing || status === TaskStatus.DONE || status === TaskStatus.ERROR) && (
        <RealtimeExecutionDashboard
          stages={stageMetrics}
          activeStageId={activeStageId}
          statusText={statusText}
          status={status}
        />
      )}

      {/* Section 1: Stage 1 Derivation and Computation with Copy/Download/PDF Toolbar */}
      {result.draftAnswer && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 transition-all shrink-0 relative group/stage1">
          {/* Target header ref for smooth upward navigation */}
          <div ref={stage1TopRef} className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">第一阶段</span>
              <h3 className="font-bold text-slate-700 text-sm">完整推导求解与图像特征提取（自检闭环）</h3>
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

      {/* Section 2: Reviewer Inspection & Score */}
      {result.reviewText && (
        <div className="bg-slate-50/80 rounded-2xl border border-slate-200 p-5 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 mb-3">
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">第二阶段</span>
            <h3 className="font-bold text-slate-800 text-sm">独立过程核查、图像参数锁定与自洽性评分</h3>
          </div>
          <MarkdownRenderer 
            content={result.reviewText} 
          />
        </div>
      )}

      {/* Section 3: Final Standard Solution */}
      {result.finalAnswer && (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-5 relative shrink-0">
          {/* Target header ref for smooth upward navigation to Stage 3 */}
          <div ref={stage3TopRef} className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-5 bg-blue-600 rounded-sm"></div>
              <h3 className="font-extrabold text-slate-900 text-base">最终考研标准解答（完美书写过程）</h3>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleCopy(result.finalAnswer, false)}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                title="复制内容"
              >
                {copiedFinal ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                <span>{copiedFinal ? '已复制' : '复制'}</span>
              </button>
              <button
                onClick={() => {
                  if (isEditing) {
                    setResult(prev => ({ ...prev, finalAnswer: editContent }));
                  } else {
                    setEditContent(result.finalAnswer);
                  }
                  setIsEditing(!isEditing);
                }}
                className={`px-2.5 py-1 text-xs font-medium border rounded-lg transition-colors flex items-center gap-1 ${
                  isEditing 
                    ? 'bg-blue-600 text-white border-blue-600' 
                    : 'text-slate-600 hover:text-blue-600 hover:bg-blue-50 border-slate-200'
                }`}
                title="在线编辑"
              >
                <Edit3 size={13} />
                <span>{isEditing ? '保存预览' : '编辑'}</span>
              </button>
              <button
                onClick={handleExportMarkdown}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                title="导出 Markdown"
              >
                <FileText size={13} />
                <span>导出 .md</span>
              </button>
              <button
                onClick={handlePrintFinalPdf}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors flex items-center gap-1"
                title="导出渲染好的 PDF"
              >
                <Download size={13} />
                <span>导出 PDF</span>
              </button>
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-3">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-80 p-3.5 text-xs font-mono bg-slate-50 border border-blue-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none"
              />
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs font-semibold text-slate-400 mb-1.5">实时渲染预览</div>
                <MarkdownRenderer content={editContent} />
              </div>
            </div>
          ) : (
            <div ref={finalRenderRef}>
              <MarkdownRenderer 
                content={result.finalAnswer} 
              />
            </div>
          )}

          {isInterrupted && (
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">如果解答未写完或被截断，可点击继续向下推导：</span>
              <button
                onClick={handleResumeAnalysis}
                className="px-3 py-1 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-600 border border-slate-200 hover:border-blue-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <FastForward size={13} />
                <span>继续向下输出</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Persistent Jump Buttons pinned at the bottom-right of the viewport area */}
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

export default SignalSystem;
