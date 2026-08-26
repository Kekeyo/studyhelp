import React, { useState, useRef } from 'react';
import { 
  Play, Square, Download, CheckCircle2, AlertCircle, Loader2, Copy, 
  Check, FileText, Sparkles, ChevronDown, Award
} from 'lucide-react';
import Uploader from '../components/Uploader.tsx';
import MarkdownRenderer from '../components/MarkdownRenderer.tsx';
import { Attachment, TaskStatus, EnglishCategory, EnglishMode, EnglishAnalysisResult } from '../types.ts';
import { streamMessage, sendMessage } from '../services/aiAdapter.ts';
import { ResizableSplitPane } from '../components/ResizableSplitPane.tsx';
import { exportRenderedPdf } from '../utils/pdfExporter.ts';

const ESSAY_DETECT_PROMPT = `你是一名中国考研英语一作文阅卷名师。
请分析用户输入的内容：
1. 检测输入是【仅包含题目】还是【包含题目 + 学生所写作文】。
   - 如果仅有题目，模式为 "MODE_A"
   - 如果包含学生习作，模式为 "MODE_B"
2. 识别题目类型（应用文类型如邀请信/建议信/告示，或大作文图画/图表材料）。

请返回严格 JSON：
{
  "mode": "MODE_A" | "MODE_B",
  "categoryDescription": "...",
  "topicSummary": "..."
}`;

const ESSAY_MODE_A_V1_PROMPT = `你是一名考研英语一权威阅卷专家。
用户仅提供了作文题目。
请生成【第一版高分参考范文】：
1. 完整覆盖题设所有要点。
2. 词汇与句式自然、地道，符合考研英语一水平，杜绝生硬套模板和中式英语。
3. 给出 0-15 (小作文) 或 0-20 (大作文) 的合理评分。

输出格式：
## 范文呈现
...
## 评分与依据
评分：X / 15 (或 20)
得分点依据：...`;

const ESSAY_MODE_A_V2_PROMPT = `你是一名考研英语一权威写作名师。
请对第一版范文进行【更高分版本重构与逻辑升级】：
1. 重新思考文章的切入角度、论证顺序与段落层级，使行文更具说服力和思辨性。
2. 不做简单的生僻词替换，而是通过更精炼的衔接和层次提升文章品质。
3. 给出重写版本的评分。

输出格式：
## 高分逻辑升级范文
...
## 升级亮点与评分
评分：X / 15 (或 20)
亮点解析：...`;

const ESSAY_MODE_B_PROMPT = `你是一名考研英语一权威阅卷教师。
用户提交了题目以及自己的作文。
请完成两个窗口的内容输出：
1. 【原作文评估与精细优化】：保留学生原有观点和基本框架，重点修改语法、搭配、时态与中式表达，并给出原作文评分。
2. 【高分重写版本】：完全重新组织逻辑、论证与地道表达，展现最高分水平。

输出格式：
### 原作文评分与诊断
评分：X / 15 (或 20)
主要问题：...

### 原文精修版
...

---SPLIT---

### 高分重写版本 (Score: X)
...
重写解析：...`;

export const EnglishOne: React.FC = () => {
  const [essayCategory, setEssayCategory] = useState<EnglishCategory>(EnglishCategory.SHORT_ESSAY);
  const [textInput, setTextInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.IDLE);
  const [result, setResult] = useState<EnglishAnalysisResult>({
    detectedMode: EnglishMode.MODE_A,
    detectedType: '',
    topicSummary: '',
    version1: '',
    score1: '',
    version2: '',
    score2: ''
  });
  const [errorMsg, setErrorMsg] = useState('');
  const [copied1, setCopied1] = useState(false);
  const [copied2, setCopied2] = useState(false);

  const renderRef1 = useRef<HTMLDivElement>(null);
  const renderRef2 = useRef<HTMLDivElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

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
      setErrorMsg('请输入作文题目或上传作文图片/文件');
      return;
    }

    setErrorMsg('');
    setResult({
      detectedMode: EnglishMode.MODE_A,
      detectedType: '',
      topicSummary: '',
      version1: '',
      score1: '',
      version2: '',
      score2: ''
    });

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setStatus(TaskStatus.PARSING);
      // 1. Auto detect Mode A or Mode B
      let mode = EnglishMode.MODE_A;
      let typeDesc = '考研英语作文';
      try {
        const detectRes = await sendMessage(
          `${ESSAY_DETECT_PROMPT}\n\n当前选择分类：${essayCategory === EnglishCategory.SHORT_ESSAY ? '小作文/应用文' : '大作文'}\n内容：\n${textInput}`,
          attachments
        );
        const parsed = JSON.parse(detectRes.replace(/```json|```/g, '').trim());
        if (parsed.mode === 'MODE_B') mode = EnglishMode.MODE_B;
        if (parsed.categoryDescription) typeDesc = parsed.categoryDescription;
      } catch {}

      setResult(prev => ({ ...prev, detectedMode: mode, detectedType: typeDesc }));

      if (mode === EnglishMode.MODE_A) {
        // Mode A Flow: Generate V1 -> Generate V2
        setStatus(TaskStatus.DRAFTING);
        const v1 = await streamMessage(
          `${ESSAY_MODE_A_V1_PROMPT}\n\n题目类型：${typeDesc}\n题目要求：\n${textInput}`,
          attachments,
          (_, full) => setResult(prev => ({ ...prev, version1: full })),
          signal
        );

        setStatus(TaskStatus.FINALIZING);
        await streamMessage(
          `${ESSAY_MODE_A_V2_PROMPT}\n\n题目要求：\n${textInput}\n\n第一版范文参考：\n${v1}`,
          attachments,
          (_, full) => setResult(prev => ({ ...prev, version2: full })),
          signal
        );
      } else {
        // Mode B Flow: Review Student Work & Rewrite
        setStatus(TaskStatus.DRAFTING);
        const fullOutput = await streamMessage(
          `${ESSAY_MODE_B_PROMPT}\n\n题目与学生作文：\n${textInput}`,
          attachments,
          (_, full) => {
            const parts = full.split('---SPLIT---');
            setResult(prev => ({
              ...prev,
              version1: parts[0] || '',
              version2: parts[1] || ''
            }));
          },
          signal
        );
      }

      setStatus(TaskStatus.DONE);
    } catch (err: any) {
      if (err.message !== 'Aborted') {
        setStatus(TaskStatus.ERROR);
        setErrorMsg(err.message || '生成失败');
      }
    }
  };

  const handleExportTxt = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Safe copy helper with fallback to document.execCommand('copy')
  const safeCopy = (text: string, setCopiedState: (val: boolean) => void) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
          setCopiedState(true);
          setTimeout(() => setCopiedState(false), 2000);
        }).catch(() => {
          fallbackCopyText(text, setCopiedState);
        });
      } else {
        fallbackCopyText(text, setCopiedState);
      }
    } catch {
      fallbackCopyText(text, setCopiedState);
    }
  };

  const fallbackCopyText = (text: string, setCopiedState: (val: boolean) => void) => {
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
      setCopiedState(true);
      setTimeout(() => setCopiedState(false), 2000);
    } catch (e) {
      console.warn('Copy command fallback failed:', e);
    }
  };

  const leftInputContent = (
    <div className="w-full h-full flex flex-col gap-3.5 bg-white rounded-2xl shadow-sm border border-slate-200/80 p-4 overflow-y-auto min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-5 bg-blue-600 rounded-full"></div>
          <h2 className="font-bold text-slate-800 text-base">英语一作文工作台</h2>
        </div>
        
        {/* Category Dropdown */}
        <select
          value={essayCategory}
          onChange={(e) => setEssayCategory(e.target.value as EnglishCategory)}
          className="text-xs font-semibold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 outline-none cursor-pointer"
        >
          <option value={EnglishCategory.SHORT_ESSAY}>小作文 / 应用文</option>
          <option value={EnglishCategory.LONG_ESSAY}>大作文 (图画/图表)</option>
        </select>
      </div>

      {/* 1. TOP BOX: Text Input Area */}
      <div className="flex-1 min-h-[160px] flex flex-col relative">
        <textarea
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onPaste={handlePaste}
          placeholder={
            essayCategory === EnglishCategory.SHORT_ESSAY
              ? "输入应用文题目（如建议信、道歉信），也可同时粘贴自己写好的作文让 AI 自动批改...\n\n💡 支持直接 Ctrl+V / 粘贴作文截图"
              : "输入大作文题目/图画文字描述，支持上传图画/图表图片...\n\n💡 支持直接 Ctrl+V / 粘贴图画图表截图"
          }
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

      <div className="flex gap-2 pt-1 shrink-0">
        {status === TaskStatus.IDLE || status === TaskStatus.DONE || status === TaskStatus.ERROR ? (
          <button
            onClick={handleStartAnalysis}
            className="flex-1 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm"
          >
            <Play size={16} className="fill-current" />
            <span>智能处理</span>
          </button>
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
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start gap-2 shrink-0">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );

  const rightOutputContent = (
    <div className="w-full h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
      {status !== TaskStatus.IDLE && (
        <div className="bg-white rounded-xl px-4 py-2.5 shadow-xs border border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {status === TaskStatus.DONE ? (
              <CheckCircle2 size={17} className="text-emerald-500" />
            ) : status === TaskStatus.ERROR ? (
              <AlertCircle size={17} className="text-rose-500" />
            ) : (
              <Loader2 size={17} className="text-blue-600 animate-spin" />
            )}
            <span className="text-xs font-semibold text-slate-700">
              {result.detectedMode === EnglishMode.MODE_B
                ? '检测到包含学生作文：正在进行精细批改与高分重构...'
                : '检测到仅有题目：正在生成两阶段逻辑升级范文...'}
            </span>
          </div>
          {result.detectedType && (
            <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2.5 py-1 rounded-md">
              {result.detectedType}
            </span>
          )}
        </div>
      )}

      {/* Window 1 */}
      {result.version1 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <span className="w-2 h-4 bg-blue-600 rounded-full"></span>
              {result.detectedMode === EnglishMode.MODE_B ? '原作文评估与精修' : '第一版：高分参考作文'}
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => safeCopy(result.version1, setCopied1)}
                className="px-2 py-0.5 text-xs border rounded-lg hover:bg-slate-50 text-slate-600 flex items-center gap-1"
              >
                {copied1 ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copied1 ? '已复制' : '复制'}</span>
              </button>
              <button
                onClick={() => handleExportTxt(result.version1, '考研英语_第一版.txt')}
                className="px-2 py-0.5 text-xs border rounded-lg hover:bg-slate-50 text-slate-600 flex items-center gap-1"
              >
                <Download size={12} />
                <span>导出 TXT</span>
              </button>
              <button
                onClick={() => exportRenderedPdf('考研英语第一版作文评估与精修', renderRef1.current, result.version1)}
                className="px-2 py-0.5 text-xs border rounded-lg hover:bg-slate-50 text-slate-600 flex items-center gap-1"
              >
                <FileText size={12} />
                <span>导出 PDF</span>
              </button>
            </div>
          </div>
          <div ref={renderRef1}>
            <MarkdownRenderer content={result.version1} />
          </div>
        </div>
      )}

      {/* Window 2: Upgraded Logic / Rewrite */}
      {result.version2 && (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-blue-100 p-5 shrink-0">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <h3 className="font-extrabold text-blue-900 text-sm flex items-center gap-2">
              <Award size={16} className="text-blue-600" />
              {result.detectedMode === EnglishMode.MODE_B ? '高分完全重写版本' : '更高分版本：逻辑与表达重构'}
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => safeCopy(result.version2, setCopied2)}
                className="px-2 py-0.5 text-xs border rounded-lg hover:bg-blue-50 text-slate-600 flex items-center gap-1"
              >
                {copied2 ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copied2 ? '已复制' : '复制'}</span>
              </button>
              <button
                onClick={() => handleExportTxt(result.version2, '考研英语_高分升级版.txt')}
                className="px-2 py-0.5 text-xs border rounded-lg hover:bg-blue-50 text-slate-600 flex items-center gap-1"
              >
                <Download size={12} />
                <span>导出 TXT</span>
              </button>
              <button
                onClick={() => exportRenderedPdf('考研英语高分重写升级版作文', renderRef2.current, result.version2)}
                className="px-2 py-0.5 text-xs border rounded-lg hover:bg-blue-50 text-slate-600 flex items-center gap-1"
              >
                <FileText size={12} />
                <span>导出 PDF</span>
              </button>
            </div>
          </div>
          <div ref={renderRef2}>
            <MarkdownRenderer content={result.version2} />
          </div>
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

export default EnglishOne;
