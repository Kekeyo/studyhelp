import React, { useRef, useState } from 'react';
import { AlertCircle, Check, Copy, Download, FileText, Layers, Play, RotateCcw, Square } from 'lucide-react';
import Uploader from '../components/Uploader.tsx';
import MarkdownRenderer from '../components/MarkdownRenderer.tsx';
import { Attachment, TaskStatus } from '../types.ts';
import { loadStoredProviderConfig, streamMessage } from '../services/aiAdapter.ts';
import { exportRenderedPdf } from '../utils/pdfExporter.ts';
import { ResizableSplitPane } from '../components/ResizableSplitPane.tsx';

const MATH_PAPER_PROMPT = `你是一名严谨的中国考研《数学一》名师。用户上传的是一整张试卷或一张/多张题目图片。

请直接完成整卷解析与解答，不要先向用户展示拆题结果、题目标签、处理阶段、评分、Reviewer 意见、目录、总览或开场说明。你需要在内部准确识别所有独立题目（选择题、填空题、解答题及其小问），严格按试卷原有顺序连续作答，不能漏题、合题或调换顺序。

【输出顺序，必须严格执行】
从试卷的第 1 题开始处理：先对第 1 题计算核验，然后立刻输出第 1 题的完整解答；完成后才处理并输出第 2 题，依此类推。不要等待整卷都识别完才开始写，也不要先列题目清单。调用代码工具完成后，你输出给用户的第一个文字必须是“## 第 1 题”。

【代码模式，必须先算后写】
如果当前环境有 Code Execution 工具：对每道独立题在写解答前，必须先调用代码执行。使用 Python 的 sympy、numpy 或 mpmath 实际完成需要的代数化简、求根、积分、矩阵运算、数值代回或概率计算；不要伪造运行记录。若题目不适合符号计算，仍须用代码作数值抽查、边界检查或结果代回。当前环境没有代码工具时，必须如实说明并改用手算交叉核验。

【解答质量】
1. 图片、图形或表格中的边界、参数、坐标、选项必须先读清；不清晰处明确说明，不可臆造。
2. 每题给出完整、可抄写的推导，而不是只给结论。关键积分、矩阵变换、概率公式、极值判别、方程检验不得跳步。
3. 数值解要代回原式验证。代码执行只用于内部核验，不要把工具调用、代码、处理阶段或核验摘要单独展示给用户。
4. 公式使用规范 Markdown 与 LaTex：行内 $...$，独立公式 $$...$$；不要用代码块包住整份回答。

请直接按下面格式连续输出整卷答案；不要在“## 第 1 题”之前输出任何文字：

## 第 1 题
### 解答
[完整过程]
### 答
[明确结果]

## 第 2 题
...

不要输出“第一阶段”“第二阶段”“正在拆题”“代码模式”或任何题目切换控件。`;

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

export const MathOne: React.FC = () => {
  const [textInput, setTextInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.IDLE);
  const [answer, setAnswer] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
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
    setErrorMsg('');
    setStatus(TaskStatus.DRAFTING);

    const prompt = `${MATH_PAPER_PROMPT}\n\n试卷文本（扫描件以上传的页面图片为准）：\n${textInput || '无可用文字层，请完全根据上传图片识别。'}`;
    try {
      const output = await streamMessage(
        prompt,
        attachments,
        (_delta, full) => {
          setAnswer(full);
        },
        controller.signal,
        config,
        undefined,
        { enableGoogleCodeExecution: true }
      );
      setAnswer(output);
      setStatus(TaskStatus.DONE);
    } catch (error: any) {
      if (error?.message === 'Aborted') {
        setStatus(TaskStatus.IDLE);
      } else {
        setStatus(TaskStatus.ERROR);
        setErrorMsg(error?.message || '整卷解答失败，请重试。');
      }
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
        <p className="text-xs text-slate-400 px-2 pt-2">正在读取第 1 题…</p>
      )}

      {answer && (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-5 shrink-0">
          <div className="flex flex-wrap items-center justify-end gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <div className="flex items-center gap-1.5">
              <button onClick={handleCopy} className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1">
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}{copied ? '已复制' : '复制'}
              </button>
              <button onClick={handleExportMarkdown} className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1"><FileText size={13} />导出 .md</button>
              <button onClick={() => exportRenderedPdf('考研数学一整卷详细解析', answerRenderRef.current, answer)} className="px-2.5 py-1 text-xs font-medium border border-slate-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1"><Download size={13} />导出 PDF</button>
            </div>
          </div>
          <div ref={answerRenderRef}><MarkdownRenderer content={answer} /></div>
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
