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

排版必须严格按普通数学讲义书写：
1. 直接从推导正文开始，不要写“解：”或“解答：”，也不要写题号。
2. 题设、定义、偏导数等短公式必须留在说明文字所在段内，使用单个 $...$；不要为了公式而换行。例如：分别计算偏导数：$F_x=1$，$F_y=-\mathrm{e}^{y+az}$。
3. 只有较长的分式推导、积分、极限、矩阵计算，或一整条较长的等式链才单独成行。独立公式的 $$ 必须各自占一行，前后各空一行。
4. 不要使用 \\begin{aligned}、\\begin{cases}、&、\\\\ 或任何多行 LaTeX 环境；每个独立公式只写一条普通公式，防止源码泄露。
5. 每个逻辑步骤只写一个自然段；不要把每句说明都另起一行。最后一行以 **答：** 给出明确结果。

输出只能是本题的解答正文。不要输出题号；题号会由页面统一添加。`;

interface PaperQuestion {
  id: string;
  text: string;
  pages: number[];
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
  body = body.replace(/^(?:\*\*)?解(?:答)?[：:]?(?:\*\*)?\s*/, '');
  body = body.replace(/(^|\n)\s*(?:\*\*)?答[：:]?(?:\*\*)?\s*/gm, '$1**答：** ');
  return `## ${questionNumber}.${body.trim()}`;
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

export const MathOne: React.FC = () => {
  const [textInput, setTextInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.IDLE);
  const [answer, setAnswer] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const answerRenderRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isProcessing = status === TaskStatus.DRAFTING;
  const isDone = status === TaskStatus.DONE;
  const isInterrupted = status === TaskStatus.ERROR || (status === TaskStatus.IDLE && Boolean(answer));

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

  const runDirectSolve = async () => {
    if (!textInput.trim() && attachments.length === 0) {
      setErrorMsg('请粘贴题目，或上传整张数学一试卷 PDF / 图片。');
      return;
    }

    const config = loadStoredProviderConfig();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setAnswer('');
    setIsEditing(false);
    setIsExportMenuOpen(false);
    setErrorMsg('');
    setStatus(TaskStatus.DRAFTING);

    const sourceText = textInput || '无可用文字层，请完全根据上传的试卷页面图片识别。';
    try {
      // The queue is deliberately invisible: splitting the paper here keeps a
      // single answer request small enough to finish, while the reader sees one
      // ordinary, continuous answer document rather than a multi-question UI.
      const queueOutput = await streamMessage(
        `${MATH_SPLIT_PROMPT}\n\n试卷文本（扫描件以上传的页面图片为准）：\n${sourceText}`,
        attachments,
        () => {},
        controller.signal,
        config
      );

      const questions = parsePaperQuestions(queueOutput);
      // A model can occasionally refuse the JSON-only request. Retain the old
      // whole-paper fallback so an otherwise readable upload is never discarded.
      const queue = questions.length > 0
        ? questions
        : [{ id: '1', text: sourceText, pages: [] }];

      let completedAnswer = '';
      for (let index = 0; index < queue.length; index += 1) {
        if (controller.signal.aborted) throw new Error('Aborted');

        const question = queue[index];
        const questionNumber = index + 1;
        const relevantAttachments = attachmentsForQuestion(attachments, question);
        const questionSource = relevantAttachments.length > 0
          ? `请在随附的试卷页面中定位原卷第 ${question.id} 题；定位提示：${question.text}。只解这一题及其全部小问。`
          : `当前题目（统一编号为 ${questionNumber}，原卷题号为 ${question.id}，定位提示：${question.text}）：\n${sourceText}`;
        const questionPrompt = `${MATH_QUESTION_PROMPT}\n\n${questionSource}`;
        let questionOutput = await streamMessage(
          questionPrompt,
          relevantAttachments,
          (_delta, full) => {
            setAnswer(appendAnswer(completedAnswer, formatSingleQuestionAnswer(full, questionNumber)));
          },
          controller.signal,
          config,
          undefined,
          { enableGoogleCodeExecution: true }
        );

        // Do not silently accept an answer cut off in the middle of a formula
        // or one that never reached its final result. One focused continuation
        // is far safer than letting the next question conceal the truncation.
        if (!hasFinalAnswer(questionOutput) || looksCutOff(questionOutput)) {
          const continuationPrompt = `继续完成同一道考研数学一题。下面的已有解答因输出中断或未写完而停止。请从最后一句继续，不要重复已有推导、不要输出题号，仍须只输出解答正文，并以 **答：** 给出最终结果。先使用可用代码执行工具核验尚未完成的计算；不要提及代码或工具。\n\n题目定位：原卷第 ${question.id} 题，${question.text}\n\n已有解答：\n${questionOutput}`;
          const continuation = await streamMessage(
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
          );
          questionOutput = `${questionOutput}\n\n${continuation}`;
        }

        completedAnswer = appendAnswer(completedAnswer, formatSingleQuestionAnswer(questionOutput, questionNumber));
        setAnswer(completedAnswer);
      }

      setStatus(TaskStatus.DONE);
    } catch (error: any) {
      if (controller.signal.aborted || error?.message === 'Aborted') {
        setStatus(TaskStatus.IDLE);
      } else {
        setStatus(TaskStatus.ERROR);
        setErrorMsg(error?.message || '试卷解答失败，请重试。');
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
          <button onClick={runDirectSolve} className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm">
            {isDone || isInterrupted ? <RotateCcw size={16} /> : <Play size={16} className="fill-current" />}
            {isDone || isInterrupted ? '重新开始分析' : '开始分析'}
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
    <div className="w-full h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
      {!answer && !isProcessing && (
        <div className="flex-1 bg-white rounded-2xl border border-slate-200/80 p-8 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-xs"><Layers size={26} /></div>
          <h3 className="font-bold text-slate-800 text-base mb-1">数学一智能解题工作台</h3>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">输入题目或上传整卷试卷后，系统将直接按原题顺序给出每道题的详细解答。</p>
        </div>
      )}

      {isProcessing && !answer && (
        <p className="text-xs text-slate-400 px-2 pt-2">正在计算并整理整卷答案…</p>
      )}

      {answer && (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-5 shrink-0">
          <div className="flex flex-wrap items-center justify-end gap-1.5 border-b border-slate-100 pb-3 mb-4">
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
            <div className="space-y-3">
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="w-full h-80 p-3.5 text-xs font-mono bg-slate-50 border border-blue-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none"
                aria-label="编辑解答内容"
              />
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs font-semibold text-slate-400 mb-1.5">实时渲染预览</div>
                <MarkdownRenderer
                  content={editContent}
                  className="prose-p:my-3 prose-ol:my-0 prose-ol:pl-6 prose-li:my-6 prose-li:pl-1"
                />
              </div>
            </div>
          ) : (
            <div ref={answerRenderRef}>
            <MarkdownRenderer
              content={answer}
              className="prose-p:my-3 prose-ol:my-0 prose-ol:pl-6 prose-li:my-6 prose-li:pl-1"
            />
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
