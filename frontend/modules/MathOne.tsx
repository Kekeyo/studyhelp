import React, { useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Copy, Download, Edit3, FileText, Layers, Play, RotateCcw, Square } from 'lucide-react';
import Uploader from '../components/Uploader.tsx';
import MarkdownRenderer from '../components/MarkdownRenderer.tsx';
import { Attachment, TaskStatus } from '../types.ts';
import { loadStoredProviderConfig, streamMessage } from '../services/aiAdapter.ts';
import { exportRenderedPdf } from '../utils/pdfExporter.ts';
import { ResizableSplitPane } from '../components/ResizableSplitPane.tsx';

/** An internal-only extraction request. Its response is never rendered. */
const MATH_SPLIT_PROMPT = `你正在为一份中国考研《数学一》试卷建立后台解题队列。请阅读提供的文本和试卷页面图片，识别试卷中的每一道独立大题，并严格保持原始顺序。

选择题、填空题和解答题都各算一道题；一道解答题内的 (1)、(2) 等小问必须保留在同一个题目对象中，不能拆开。题目跨页时 pages 要列出所有相关页。必须覆盖整卷，不能只返回前几题，也不要输出任何解释、Markdown 或代码围栏。

只返回合法 JSON 数组，格式严格如下：
[
  {"id":"1","text":"最多 20 个字的定位提示，例如：函数极限选择题","pages":[1]},
  {"id":"2","text":"最多 20 个字的定位提示，例如：二重积分计算题","pages":[1,2]}
]

pages 是从 1 开始的试卷页码。text 只能用作定位提示，绝对不要转写完整题干、选项或推导；这样可以确保整卷题号不会在队列生成时被截断。图片文字无法完全辨认时，仍须按可见题号建立对象，并把 text 写成简短的可辨认提示，不要凭空杜撰。`;

const MATH_QUESTION_PROMPT = `你是一名严谨的中国考研《数学一》名师。现在只需要完成下面这一道题，不能回答其他题，也不能写前言、题目复述、处理过程、阶段说明或代码。

在写出任何解答前，必须先在可用的代码执行工具中计算或核验本题：优先使用 sympy、numpy 或 mpmath 进行代数化简、积分、矩阵运算、数值代回、边界检查等。代码执行仅供内部核验，绝对不要在最终文字中提及代码、工具或运行记录。

解答必须严谨且可抄写：补足关键推导，不要只给结论；数值结果要代回或交叉检查。图片、图形、表格或选项不清楚时必须明确这一点，不能猜测。

排版要求：说明文字分段书写。等式、推导链、积分、求和、极限、矩阵、分式、根式或含两个以上运算符的公式必须各自独占一行，并在前后留空行，以 $$...$$ 包裹；不要把长公式塞在段落中，也不要使用代码块。

输出只能是本题的解答正文，且必须以 **解：** 开始，以 **答：** 给出最终结果结束。不要输出题号；题号会由页面统一添加。`;

interface PaperQuestion {
  id: string;
  text: string;
  pages: number[];
}

interface PaperRunCheckpoint {
  queue: PaperQuestion[];
  nextIndex: number;
  completedAnswer: string;
}

const createClipboardAttachment = (file: File): Promise<Attachment> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (event) => resolve({
    name: `剪贴板截图_${new Date().toLocaleTimeString().replace(/:/g, '')}.png`,
    type: file.type,
    data: event.target?.result as string,
    size: file.size,
    sourceId: `clipboard-${Date.now()}`
  });
  reader.onerror = () => reject(new Error('无法读取剪贴板图片'));
  reader.readAsDataURL(file);
});

/** Extract the first JSON array without trusting optional Markdown fences. */
const parsePaperQuestions = (raw: string): PaperQuestion[] => {
  const start = raw.indexOf('[');
  if (start < 0) return [];

  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(raw.slice(start, index + 1));
        if (!Array.isArray(parsed)) return [];
        return parsed
          .map((item, itemIndex): PaperQuestion | null => {
            if (!item || typeof item !== 'object') return null;
            const pages = Array.isArray(item.pages)
              ? item.pages.map(Number).filter(page => Number.isInteger(page) && page > 0)
              : [];
            const id = String(item.id ?? itemIndex + 1).trim();
            if (!id) return null;
            const text = typeof item.text === 'string' && item.text.trim()
              ? item.text.trim()
              : `试卷中的第 ${id} 题`;
            return { id, text, pages: [...new Set(pages)] };
          })
          .filter((item): item is PaperQuestion => item !== null);
      } catch {
        return [];
      }
    }
  }
  return [];
};

/** Keep a one-question model response in the same written-paper format every time. */
const formatSingleQuestionAnswer = (raw: string, questionNumber: number): string => {
  let body = raw.replace(/\r/g, '').trim();
  // A model occasionally repeats a heading despite being told not to. Remove
  // only the first line so subparts such as (1) and (2) remain untouched.
  body = body.replace(/^\s*(?:#{1,6}\s*)?(?:第\s*)?\d+\s*(?:题)?[.、．]?\s*/, '');
  body = body.replace(/^(?:\*\*)?解(?:答)?[：:]?(?:\*\*)?\s*/, '**解：**\n\n');
  if (!body.startsWith('**解：**')) body = `**解：**\n\n${body}`;
  body = body.replace(/(^|\n)\s*(?:\*\*)?答[：:]?(?:\*\*)?\s*/gm, '$1**答：** ');
  return `## ${questionNumber}.\n\n${body.trim()}`;
};

const hasFinalAnswer = (raw: string): boolean => /(?:^|\n)\s*(?:\*\*)?答[：:]/m.test(raw);

const looksCutOff = (raw: string): boolean => {
  const compact = raw.trim();
  if (!compact) return true;
  const displayMathMarkers = compact.match(/\$\$/g)?.length ?? 0;
  if (displayMathMarkers % 2 !== 0) return true;
  return /(?:[=+\-*/≤≥<>，,;:：]|\\[a-zA-Z]+|[（(\[{])\s*$/u.test(compact);
};

const attachmentsForQuestion = (attachments: Attachment[], question: PaperQuestion): Attachment[] => {
  const pageSet = new Set(question.pages);
  return attachments.filter((attachment) => {
    if (!attachment.type.startsWith('image/')) return false;
    // Directly uploaded images may contain a whole paper, so they always stay
    // available. Rendered PDF pages are narrowed to this question when known.
    return !attachment.generated || pageSet.size === 0 || pageSet.has(attachment.pageNumber ?? -1);
  });
};

const appendAnswer = (completed: string, current: string): string => completed ? `${completed}\n\n${current}` : current;

const isVertexRateLimit = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\brate_limited\b|\b429\b|RESOURCE_EXHAUSTED/i.test(message);
};

const isTransientConnectionFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /network_or_proxy|stream_interrupted|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket hang up/i.test(message);
};

const waitForRetry = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = window.setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, milliseconds);
  const onAbort = () => {
    window.clearTimeout(timer);
    reject(new Error('Aborted'));
  };
  signal.addEventListener('abort', onAbort, { once: true });
});

export const MathOne: React.FC = () => {
  const [textInput, setTextInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.IDLE);
  const [answer, setAnswer] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const answerRenderRef = useRef<HTMLDivElement>(null);
  const answerScrollContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const checkpointRef = useRef<PaperRunCheckpoint | null>(null);

  const isProcessing = status === TaskStatus.DRAFTING;
  const isDone = status === TaskStatus.DONE;
  const isInterrupted = status === TaskStatus.ERROR || (status === TaskStatus.IDLE && Boolean(answer));
  const canResume = (status === TaskStatus.ERROR || status === TaskStatus.IDLE) && checkpointRef.current !== null;

  const handleFilesAdded = (newFiles: Attachment[], extractedText?: string) => {
    setAttachments(previous => [...previous, ...newFiles]);
    if (extractedText) setTextInput(previous => previous ? `${previous}\n\n${extractedText}` : extractedText);
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImages: Attachment[] = [];
    for (const item of Array.from(event.clipboardData?.items || [])) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (file) pastedImages.push(await createClipboardAttachment(file));
    }
    if (pastedImages.length) {
      event.preventDefault();
      setAttachments(previous => [...previous, ...pastedImages]);
    }
  };

  const runDirectSolve = async (resume = false) => {
    if (!textInput.trim() && attachments.length === 0) {
      setErrorMsg('请粘贴题目，或上传整张数学一试卷 PDF / 图片。');
      return;
    }

    const config = loadStoredProviderConfig();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const checkpoint = resume ? checkpointRef.current : null;
    if (!checkpoint) {
      checkpointRef.current = null;
      setAnswer('');
    }
    setErrorMsg('');
    setProgressMsg(checkpoint ? `正在从第 ${checkpoint.nextIndex + 1}/${checkpoint.queue.length} 题继续…` : '正在识别试卷题目队列…');
    setStatus(TaskStatus.DRAFTING);

    const sourceText = textInput || '无可用文字层，请完全根据上传的试卷页面图片识别。';
    let currentProgress = checkpoint ? `正在解答第 ${checkpoint.nextIndex + 1}/${checkpoint.queue.length} 题` : '正在识别试卷题目队列';
    const withTransientRetry = async <T,>(request: () => Promise<T>): Promise<T> => {
      // Keeping the current question in memory means a retry never restarts
      // the paper. Vertex 429 needs longer exponential backoff; a proxy socket
      // reset can safely retry sooner.
      const rateLimitDelaysMs = [10_000, 20_000, 40_000];
      const networkDelaysMs = [5_000, 15_000, 30_000];
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await request();
        } catch (error) {
          const rateLimited = isVertexRateLimit(error);
          const networkFailed = isTransientConnectionFailure(error);
          const retryDelaysMs = rateLimited ? rateLimitDelaysMs : networkDelaysMs;
          if (controller.signal.aborted || (!rateLimited && !networkFailed) || attempt >= retryDelaysMs.length) throw error;
          const seconds = retryDelaysMs[attempt] / 1000;
          const cause = rateLimited ? '触发 Vertex 限流' : '本机代理/网络短暂中断';
          setProgressMsg(`${currentProgress}${cause}，${seconds} 秒后自动重试（${attempt + 1}/${retryDelaysMs.length}）…`);
          await waitForRetry(retryDelaysMs[attempt], controller.signal);
          setProgressMsg(`${currentProgress}正在自动重试…`);
        }
      }
    };
    try {
      let queue: PaperQuestion[];
      let completedAnswer: string;
      let startIndex: number;
      if (checkpoint) {
        queue = checkpoint.queue;
        completedAnswer = checkpoint.completedAnswer;
        startIndex = checkpoint.nextIndex;
      } else {
        // The queue is deliberately invisible: splitting the paper here keeps
        // a single answer request small enough to finish.
        const queueOutput = await withTransientRetry(() => streamMessage(
          `${MATH_SPLIT_PROMPT}\n\n试卷文本（扫描件以上传的页面图片为准）：\n${sourceText}`,
          attachments,
          () => {},
          controller.signal,
          config
        ));
        const questions = parsePaperQuestions(queueOutput);
        queue = questions.length > 0 ? questions : [{ id: '1', text: sourceText, pages: [] }];
        completedAnswer = '';
        startIndex = 0;
      }

      for (let index = startIndex; index < queue.length; index += 1) {
        if (controller.signal.aborted) throw new Error('Aborted');

        const question = queue[index];
        const questionNumber = index + 1;
        currentProgress = `正在解答第 ${questionNumber}/${queue.length} 题（原卷第 ${question.id} 题）`;
        setProgressMsg(`${currentProgress}…`);
        checkpointRef.current = { queue, nextIndex: index, completedAnswer };
        const relevantAttachments = attachmentsForQuestion(attachments, question);
        const questionSource = relevantAttachments.length > 0
          ? `请在随附的试卷页面中定位原卷第 ${question.id} 题；定位提示：${question.text}。只解这一题及其全部小问。`
          : `当前题目（统一编号为 ${questionNumber}，原卷题号为 ${question.id}，定位提示：${question.text}）：\n${sourceText}`;
        const questionPrompt = `${MATH_QUESTION_PROMPT}\n\n${questionSource}`;
        let questionOutput = await withTransientRetry(() => streamMessage(
          questionPrompt,
          relevantAttachments,
          (_delta, full) => {
            setAnswer(appendAnswer(completedAnswer, formatSingleQuestionAnswer(full, questionNumber)));
          },
          controller.signal,
          config,
          undefined,
          { enableGoogleCodeExecution: true }
        ));

        // Do not silently accept an answer cut off in the middle of a formula
        // or one that never reached its final result. One focused continuation
        // is far safer than letting the next question conceal the truncation.
        if (!hasFinalAnswer(questionOutput) || looksCutOff(questionOutput)) {
          const continuationPrompt = `继续完成同一道考研数学一题。下面的已有解答因输出中断或未写完而停止。请从最后一句继续，不要重复已有推导、不要输出题号，仍须只输出解答正文，并以 **答：** 给出最终结果。先使用可用代码执行工具核验尚未完成的计算；不要提及代码或工具。\n\n题目定位：原卷第 ${question.id} 题，${question.text}\n\n已有解答：\n${questionOutput}`;
          const continuation = await withTransientRetry(() => streamMessage(
            continuationPrompt,
            relevantAttachments,
            (_delta, full) => {
              const extended = `${questionOutput}\n\n${full}`;
              setAnswer(appendAnswer(completedAnswer, formatSingleQuestionAnswer(extended, questionNumber)));
            },
            controller.signal,
            config,
            undefined,
            { enableGoogleCodeExecution: true }
          ));
          questionOutput = `${questionOutput}\n\n${continuation}`;
        }

        completedAnswer = appendAnswer(completedAnswer, formatSingleQuestionAnswer(questionOutput, questionNumber));
        setAnswer(completedAnswer);
        checkpointRef.current = { queue, nextIndex: index + 1, completedAnswer };
      }

      setStatus(TaskStatus.DONE);
      setProgressMsg('整卷解答完成。');
      checkpointRef.current = null;
    } catch (error: any) {
      if (controller.signal.aborted || error?.message === 'Aborted') {
        setStatus(TaskStatus.IDLE);
      } else {
        setStatus(TaskStatus.ERROR);
        setErrorMsg(`${currentProgress}失败：${error?.message || '服务没有返回可读错误。请查看本地代理终端或 http://127.0.0.1:5001/diagnostics。'}`);
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  };

  const handleCopy = async () => {
    if (!answer) return;
    try {
      await navigator.clipboard.writeText(answer);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = answer;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleExportMarkdown = () => {
    const content = `# 考研数学一整卷详细解析\n\n${answer}`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `数学一整卷详细解析_${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleEditing = () => {
    if (isEditing) {
      setAnswer(editContent);
    } else {
      setEditContent(answer);
    }
    setIsEditing(previous => !previous);
  };

  const leftContent = (
    <div className="w-full h-full flex flex-col gap-3.5 bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4 overflow-y-auto min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-5 bg-blue-600 rounded-full" />
          <h2 className="font-bold text-slate-800 text-base">题目输入</h2>
        </div>
        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">高数 / 线代 / 概率</span>
      </div>

      <div className="flex-1 min-h-[160px] flex flex-col">
        <textarea
          value={textInput}
          onChange={(event) => setTextInput(event.target.value)}
          onPaste={handlePaste}
          placeholder={`在这里粘贴数学一题目 / Markdown，例如：
(a) 求函数的极值与最值
(b) 计算定积分或二重积分
(c) 求矩阵的特征值与特征向量

💡 支持整卷 PDF / 图片上传，以及直接 Ctrl+V / 粘贴截图图片`}
          className="flex-1 w-full p-3.5 text-sm bg-slate-50/50 border border-slate-200 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none transition-all font-sans leading-relaxed"
        />
      </div>

      <Uploader
        attachments={attachments}
        onFilesAdded={handleFilesAdded}
        onRemove={(attachment) => setAttachments(previous => previous.filter(item => attachment.sourceId ? item.sourceId !== attachment.sourceId : item !== attachment))}
      />

      <div className="pt-1 shrink-0">
        {isProcessing ? (
          <button onClick={() => abortControllerRef.current?.abort()} className="w-full bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 text-sm">
            <Square size={15} className="fill-current" />停止
          </button>
        ) : (
          <button onClick={() => runDirectSolve(canResume)} className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm">
            {canResume ? <Play size={16} className="fill-current" /> : isDone || isInterrupted ? <RotateCcw size={16} /> : <Play size={16} className="fill-current" />}
            {canResume ? `继续分析（从第 ${checkpointRef.current!.nextIndex + 1} 题）` : isDone || isInterrupted ? '重新开始分析' : '开始分析'}
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-start gap-2 shrink-0">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
          <span className="break-all leading-relaxed">{errorMsg}</span>
        </div>
      )}
    </div>
  );

  const rightContent = (
    <div className="w-full h-full min-h-0 flex flex-col gap-3 overflow-hidden pr-1">
      {isProcessing && (
        <div className="shrink-0 rounded-xl border border-blue-100 bg-white/95 px-3 py-2 text-xs text-slate-500 shadow-sm">
          {progressMsg || '正在计算并整理整卷答案…'}
        </div>
      )}

      {!answer && !isProcessing && (
        <div className="flex-1 bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-xs"><Layers size={26} /></div>
          <h3 className="font-bold text-slate-800 text-base mb-1">数学一智能解题工作台</h3>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">输入题目或上传整卷试卷后，系统将直接按原题顺序给出每道题的详细解答。</p>
        </div>
      )}

      {answer && (
        <div className="flex-1 min-h-0 bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-5 flex flex-col overflow-hidden">
          <div className="shrink-0 flex flex-wrap items-center justify-end gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <div className="flex items-center gap-1.5">
              <button onClick={handleCopy} className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1">
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}{copied ? '已复制' : '复制'}
              </button>
              <button
                onClick={toggleEditing}
                className={`px-2.5 py-1 text-xs font-medium border rounded-lg transition-colors flex items-center gap-1 ${
                  isEditing
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 hover:bg-blue-50 hover:text-blue-600'
                }`}
                title="在线编辑解答"
              >
                <Edit3 size={13} />{isEditing ? '保存预览' : '编辑'}
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsExportMenuOpen(previous => !previous)}
                  className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center gap-1"
                  aria-haspopup="menu"
                  aria-expanded={isExportMenuOpen}
                  title="导出解答"
                >
                  <Download size={13} />导出
                  <ChevronDown size={13} className={`transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-full z-10 mt-1.5 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="menu">
                    <button
                      onClick={() => { handleExportMarkdown(); setIsExportMenuOpen(false); }}
                      className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2"
                      role="menuitem"
                    >
                      <FileText size={14} />导出 .md
                    </button>
                    <button
                      onClick={() => { exportRenderedPdf('考研数学一整卷详细解析', answerRenderRef.current, answer); setIsExportMenuOpen(false); }}
                      className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2"
                      role="menuitem"
                    >
                      <Download size={14} />导出 PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {isEditing ? (
            <div className="flex-1 min-h-0 grid grid-rows-2 gap-3 overflow-hidden">
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="w-full min-h-0 h-full p-3.5 text-xs font-mono bg-slate-50 border border-blue-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none resize-none"
                aria-label="编辑解答内容"
              />
              <div className="min-h-0 p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col">
                <div className="shrink-0 text-xs font-semibold text-slate-400 mb-1.5">实时渲染预览</div>
                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <MarkdownRenderer
                    content={editContent}
                    className="prose-p:my-3 prose-ol:my-0 prose-ol:pl-6 prose-li:my-6 prose-li:pl-1"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={answerScrollContainerRef}
              className="flex-1 min-h-0 overflow-y-auto pr-1"
            >
              <div ref={answerRenderRef}>
                <MarkdownRenderer
                  content={answer}
                  className="prose-p:my-3 prose-ol:my-0 prose-ol:pl-6 prose-li:my-6 prose-li:pl-1"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ResizableSplitPane
      leftContent={leftContent}
      rightContent={rightContent}
      defaultLeftWidth={420}
      minLeftWidth={300}
    />
  );
};

export default MathOne;
