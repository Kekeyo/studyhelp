import React, { useCallback, useState } from 'react';
import { UploadCloud, X, FileText, FileCode, ZoomIn, Eye, Files } from 'lucide-react';
import { Attachment } from '../types.ts';

interface Props {
  onFilesAdded: (files: Attachment[], extractedText?: string) => void;
  attachments: Attachment[];
  onRemove: (attachment: Attachment) => void;
}

const isPdfFile = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const toDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (event) => resolve(event.target?.result as string);
  reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
  reader.readAsDataURL(file);
});

const dataUrlByteSize = (dataUrl: string) => Math.ceil((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 0.75);

export const Uploader: React.FC<Props> = ({ onFilesAdded, attachments, onRemove }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);
  const [parsingMessage, setParsingMessage] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const extractPdfText = async (pdf: any): Promise<string> => {
    let fullText = '';
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ').trim();
      if (pageText) fullText += `\n--- 第 ${pageNumber} 页 ---\n${pageText}\n`;
    }
    return fullText;
  };

  /** Turn each PDF page into the visual input used by the multimodal model. */
  const renderPdfPages = async (file: File, sourceId: string): Promise<{ pages: Attachment[]; text: string }> => {
    if (!(window as any).pdfjsLib) throw new Error('PDF 解析组件尚未加载，请稍后重试或刷新页面。');

    const pdf = await (window as any).pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const text = await extractPdfText(pdf);
    const pages: Attachment[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      setParsingMessage(`正在读取整卷：渲染第 ${pageNumber}/${pdf.numPages} 页…`);
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      // Keep formulas legible without needlessly exceeding inline request limits.
      const scale = Math.min(2, Math.max(1.35, 1440 / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error(`无法渲染 PDF 第 ${pageNumber} 页。`);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
      const data = canvas.toDataURL('image/jpeg', 0.86);
      pages.push({
        name: `${file.name} · 第 ${pageNumber} 页`,
        type: 'image/jpeg',
        data,
        size: dataUrlByteSize(data),
        sourceId,
        sourceName: file.name,
        pageNumber,
        generated: true
      });
    }
    return { pages, text };
  };

  const processFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    let accumulatedText = '';
    setParsingPdf(true);

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const sourceId = `${file.name}-${file.lastModified}-${index}-${Date.now()}`;
        const lowerName = file.name.toLowerCase();
        const isPdf = isPdfFile(file);
        const isMd = lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
        const isTxt = file.type === 'text/plain' || lowerName.endsWith('.txt');

        if (isPdf) {
          setParsingMessage(`正在提取并渲染整卷 PDF：${file.name}…`);
          const { pages, text } = await renderPdfPages(file, sourceId);
          // The source row stays visible; its generated page images are sent to the model.
          newAttachments.push({ name: file.name, type: 'application/pdf', data: '', size: file.size, sourceId, sourceName: file.name }, ...pages);
          if (text) accumulatedText += `\n[已读取 PDF：${file.name}]\n${text}\n`;
          continue;
        }

        if (isMd || isTxt) accumulatedText += `\n[已读取文件：${file.name}]\n${await file.text()}\n`;
        const data = await toDataUrl(file);
        newAttachments.push({
          name: file.name,
          type: file.type || (isMd ? 'text/markdown' : 'text/plain'),
          data,
          size: file.size,
          sourceId,
          sourceName: file.name
        });
      }
      onFilesAdded(newAttachments, accumulatedText);
    } catch (error) {
      console.error('File processing failed:', error);
      window.alert(error instanceof Error ? error.message : '附件处理失败，请重试。');
    } finally {
      setParsingPdf(false);
      setParsingMessage('');
    }
  };

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer.files?.length) void processFiles(event.dataTransfer.files);
  }, []);

  const visibleAttachments = attachments.filter(attachment => !attachment.generated);

  return (
    <div className="w-full">
      <div
        className={`border-2 border-dashed rounded-xl p-3.5 text-center transition-all ${isDragging ? 'border-blue-500 bg-blue-50/70 scale-[0.99]' : 'border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-white'}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.md,.txt,.png,.jpg,.jpeg,.webp"
          className="hidden"
          id="file-upload-input"
          onChange={(event) => {
            if (event.target.files?.length) void processFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <label htmlFor="file-upload-input" className="cursor-pointer flex items-center justify-center gap-3">
          <div className="p-2 bg-blue-100 text-blue-700 rounded-xl shadow-xs"><UploadCloud size={18} /></div>
          <div className="text-left">
            <p className="text-xs font-semibold text-slate-700">上传整张试卷 PDF / JPG / PNG</p>
            <p className="text-[11px] text-slate-400">PDF 自动逐页转为清晰试卷图，再按题号逐题求解</p>
          </div>
        </label>
      </div>

      {parsingPdf && <p className="text-xs text-blue-600 mt-2 animate-pulse font-medium">{parsingMessage || '正在准备试卷附件…'}</p>}

      {visibleAttachments.length > 0 && (
        <div className="mt-3 space-y-2">
          {visibleAttachments.map((attachment) => {
            const isImage = attachment.type.startsWith('image/');
            const pageCount = attachments.filter(item => item.generated && item.sourceId === attachment.sourceId).length;
            return (
              <div key={attachment.sourceId || attachment.name} className="flex items-center justify-between p-2 bg-white border border-slate-200/90 rounded-xl shadow-xs text-xs hover:border-slate-300 transition-colors group">
                <div className="flex items-center space-x-2.5 overflow-hidden">
                  {isImage ? (
                    <button type="button" onClick={() => setPreviewImage(attachment.data)} className="relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-slate-100" title="点击放大查看">
                      <img src={attachment.data} alt={attachment.name} className="w-full h-full object-cover" />
                      <span className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"><Eye size={13} /></span>
                    </button>
                  ) : attachment.name.toLowerCase().endsWith('.md') ? (
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100"><FileCode size={18} className="text-emerald-600" /></div>
                  ) : attachment.type === 'application/pdf' ? (
                    <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center shrink-0 border border-rose-100"><Files size={18} className="text-rose-600" /></div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200"><FileText size={18} className="text-slate-600" /></div>
                  )}
                  <div className="truncate">
                    <div className="font-medium text-slate-700 truncate max-w-[190px]" title={attachment.name}>{attachment.name}</div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                      {isImage && <span className="text-blue-600 font-medium">图片</span>}
                      {pageCount > 0 && <span className="text-blue-600 font-medium">已生成 {pageCount} 页阅卷图</span>}
                      <span>{attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : '附件'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {isImage && <button type="button" onClick={() => setPreviewImage(attachment.data)} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="放大查看图片"><ZoomIn size={15} /></button>}
                  <button type="button" onClick={() => onRemove(attachment)} className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="移除附件"><X size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-2 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden" onClick={event => event.stopPropagation()}>
            <button onClick={() => setPreviewImage(null)} className="absolute top-3 right-3 bg-slate-900/70 hover:bg-slate-900 text-white p-2 rounded-full transition-colors z-10" title="关闭"><X size={18} /></button>
            <img src={previewImage} alt="放大查看" className="max-h-[80vh] max-w-full rounded-xl object-contain mx-auto" />
          </div>
        </div>
      )}
    </div>
  );
};

export default Uploader;
