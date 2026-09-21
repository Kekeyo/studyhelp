import React, { useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Copy, Download, Edit3, FileText, Layers, Play, RotateCcw, Square } from 'lucide-react';
import Uploader from '../components/Uploader.tsx';
import MarkdownRenderer from '../components/MarkdownRenderer.tsx';
import { Attachment, TaskStatus } from '../types.ts';
import { loadStoredProviderConfig, streamMessage } from '../services/aiAdapter.ts';
import { exportRenderedPdf } from '../utils/pdfExporter.ts';
import { ResizableSplitPane } from '../components/ResizableSplitPane.tsx';

const PAPER_COMPLETE_MARKER = '[[PAPER_COMPLETE]]';

/** The paper is solved directly in its original order; this is not a splitting or indexing prompt. */
const MATH_DIRECT_PAPER_PROMPT = `你是一名严谨的中国考研《数学一》名师。请直接阅读随附的整张/整卷试卷，从第一页的第 1 题开始，严格按照原卷顺序连续完成全部题目。不要先拆题、检索题号、定位页码、建立目录、输出处理阶段或向用户提问；看见试卷后就直接开始做题。

每道题在写答案前都必须优先使用可用的代码执行工具进行内部计算或核验：可用 sympy、numpy、mpmath 做代数化简、积分、矩阵运算、数值代回和边界检查。代码和工具调用只用于内部核验，最终文字绝不能提及代码、工具或运行记录。

每题都必须完整写出题目条件、选项（如有）和全部小问，再给出严谨、可抄写的详细过程；不要跳题，不要只做前半卷，也不要用省略号代替题干或推导。图片、图形、表格或选项确实无法辨认时，要如实说明具体缺失处，不能猜测。

排版按普通数学讲义：每题以原卷题号直接开始，例如 ## 1.；不要写“解：”或“解答：”。短公式放在说明所在段内，用单个 $...$。只有较长的分式推导、积分、极限、矩阵计算或完整等式链才单独占行，使用 $$...$$ 且前后各空一行。不要使用 \\begin{aligned}、\\begin{cases}、& 或 \\\\ 等多行 LaTeX 写法。每题最后一行用 **答：** 写出明确结果。

如果一次输出因长度、上下文或网络中断而未完成，下一次会要求你从断处继续；那时只接着写余下内容，绝不重复已完成内容。只有确认整卷最后一题已经完成后，才在最后单独输出 ${PAPER_COMPLETE_MARKER}。在此之前绝不能输出该标记。`;

const formatMathPaperAnswer = (raw: string): string => raw
  .replace(/\r/g, '')
  .replaceAll(PAPER_COMPLETE_MARKER, '')
  .trim();

const paperIsComplete = (raw: string): boolean => raw.includes(PAPER_COMPLETE_MARKER);

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

const appendAnswer = (completed: string, current: string): string => {
  if (!completed) return current;
  if (!current || completed.endsWith('\n') || current.startsWith('\n')) return completed + current;
  // Preserve a mid-sentence or mid-formula continuation. Add spacing only
  // when one fully answered question is immediately followed by the next one.
  if (/\*\*答：\*\*[^\n]*$/.test(completed) && /^#{1,6}\s/.test(current)) {
    return completed + '\n\n' + current;
  }
  return completed + current;
};

const isRecoverableStreamError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /incomplete json segment|failed to fetch|network(?:error| request)?|timed? ?out|too many requests|rate limit|resource exhausted|quota|\b429\b|\b5\d\d\b|temporarily unavailable|overloaded/i.test(message);
};

const waitBeforeRetry = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(new Error('Aborted'));
    return;
  }

  const onAbort = () => {
    window.clearTimeout(timer);
    reject(new Error('Aborted'));
  };
  const timer = window.setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, milliseconds);
  signal.addEventListener('abort', onAbort, { once: true });
});

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

    const wholePaperConfig = loadStoredProviderConfig();
    const wholePaperController = new AbortController();
    abortControllerRef.current = wholePaperController;
    setAnswer('');
    setIsEditing(false);
    setIsExportMenuOpen(false);
    setErrorMsg('');
    setStatus(TaskStatus.DRAFTING);

    const wholePaperText = textInput || '无可用文字层，请完全根据上传的试卷页面图片识别。';
    const initialWholePaperPrompt = `${MATH_DIRECT_PAPER_PROMPT}\n\n试卷文字（以上传页面图片为准）：\n${wholePaperText}`;
    const continuationPrompt = (existing: string) => `继续完成同一份考研数学一整卷试卷。不要重新识别、拆分、检索或复述已经完成的题目；从已有答案的最后中断位置直接往下写，按原卷顺序完成剩余题目。原始试卷页面仍在附件中，必须继续内部代码核验。仍按“## 题号.”开头、短公式行内、长公式单独成行、每题 **答：** 结尾的格式输出。只有整卷最后一题完成后才单独输出 ${PAPER_COMPLETE_MARKER}。\n\n已有答案末尾：\n${existing.slice(-8000)}`;

    try {
      let wholePaperOutput = '';
      let wholePaperComplete = false;

      // The PDF/image is always solved as one original paper. Extra requests
      // are only invisible continuations after a provider cuts its output;
      // they never index pages or create a question queue.
      for (let segment = 0; !wholePaperComplete; segment += 1) {
        if (wholePaperController.signal.aborted) throw new Error('Aborted');

        const outputBeforeSegment = wholePaperOutput;
        const prompt = outputBeforeSegment
          ? continuationPrompt(outputBeforeSegment)
          : initialWholePaperPrompt;
        let streamedSegment = '';

        try {
          const result = await streamMessage(
            prompt,
            attachments,
            (_delta, full) => {
              streamedSegment = full;
              setAnswer(formatMathPaperAnswer(appendAnswer(outputBeforeSegment, full)));
            },
            wholePaperController.signal,
            wholePaperConfig,
            undefined,
            { enableGoogleCodeExecution: true }
          );
          wholePaperOutput = appendAnswer(outputBeforeSegment, result);

          if (paperIsComplete(wholePaperOutput)) {
            wholePaperComplete = true;
            break;
          }

          await waitBeforeRetry(700, wholePaperController.signal);
        } catch (error) {
          if (wholePaperController.signal.aborted || !isRecoverableStreamError(error)) throw error;
          if (streamedSegment.trim()) {
            wholePaperOutput = appendAnswer(outputBeforeSegment, streamedSegment);
            setAnswer(formatMathPaperAnswer(wholePaperOutput));
          }

          if (paperIsComplete(wholePaperOutput)) {
            wholePaperComplete = true;
            break;
          }

          await waitBeforeRetry(Math.min(8000, 1500 * (segment + 1)), wholePaperController.signal);
        }
      }

      setAnswer(formatMathPaperAnswer(wholePaperOutput));
      setStatus(TaskStatus.DONE);
    } catch (error: any) {
      if (wholePaperController.signal.aborted || error?.message === 'Aborted') {
        setStatus(TaskStatus.IDLE);
      } else {
        setStatus(TaskStatus.ERROR);
        setErrorMsg(error?.message || '试卷解答失败，请重试。');
      }
    } finally {
      if (abortControllerRef.current === wholePaperController) abortControllerRef.current = null;
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
