import React, { useCallback, useState } from 'react';
import { UploadCloud, X, FileText, Image as ImageIcon, FileCode, ZoomIn, Eye } from 'lucide-react';
import { Attachment } from '../types.ts';

interface Props {
  onFilesAdded: (files: Attachment[], extractedText?: string) => void;
  attachments: Attachment[];
  onRemove: (index: number) => void;
}

export const Uploader: React.FC<Props> = ({ onFilesAdded, attachments, onRemove }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [parsingPdf, setParsingPdf] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const extractPdfText = async (file: File): Promise<string> => {
    try {
      if (!(window as any).pdfjsLib) return '';
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await (window as any).pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += `\n--- 第 ${i} 页 ---\n` + pageText;
      }
      return fullText;
    } catch (e) {
      console.warn('PDF.js text parse warning:', e);
      return '';
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    let accumulatedText = '';

    setParsingPdf(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
      const isMd = file.name.endsWith('.md') || file.name.endsWith('.markdown');
      const isTxt = file.type === 'text/plain' || file.name.endsWith('.txt');

      if (isPdf) {
        const pdfText = await extractPdfText(file);
        if (pdfText) {
          accumulatedText += `\n[已解析 PDF: ${file.name}]\n${pdfText}\n`;
        }
      } else if (isMd || isTxt) {
        const text = await file.text();
        accumulatedText += `\n[已读取文件: ${file.name}]\n${text}\n`;
      }

      const reader = new FileReader();
      const dataPromise = new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
      });

      const data = await dataPromise;
      newAttachments.push({
        name: file.name,
        type: file.type || (isMd ? 'text/markdown' : 'text/plain'),
        data: data,
        size: file.size
      });
    }
    setParsingPdf(false);
    onFilesAdded(newAttachments, accumulatedText);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      // Reset input value so re-selecting same file triggers onChange
      e.target.value = '';
    }
  };

  return (
    <div className="w-full">
      {/* Upload Dropzone */}
      <div
        className={`border-2 border-dashed rounded-xl p-3.5 text-center transition-all ${
          isDragging 
            ? 'border-blue-500 bg-blue-50/70 scale-[0.99]' 
            : 'border-slate-200 hover:border-blue-400 bg-slate-50/50 hover:bg-white'
        }`}
        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.md,.txt,.png,.jpg,.jpeg,.webp"
          className="hidden"
          id="file-upload-input"
          onChange={handleChange}
        />
        <label htmlFor="file-upload-input" className="cursor-pointer flex items-center justify-center gap-3">
          <div className="p-2 bg-blue-100 text-blue-700 rounded-xl shadow-xs">
            <UploadCloud size={18} />
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold text-slate-700">拖入 Markdown / PDF / 图片附件</p>
            <p className="text-[11px] text-slate-400">点击选择或直接在上方粘贴图片截图</p>
          </div>
        </label>
      </div>

      {parsingPdf && (
        <p className="text-xs text-blue-600 mt-2 animate-pulse font-medium">正在解析 PDF 页面文本内容...</p>
      )}

      {/* Attachment List with Image Thumbnails */}
      {attachments.length > 0 && (
        <div className="mt-3 space-y-2">
          {attachments.map((att, idx) => {
            const isImg = att.type.startsWith('image/');
            return (
              <div 
                key={idx} 
                className="flex items-center justify-between p-2 bg-white border border-slate-200/90 rounded-xl shadow-xs text-xs hover:border-slate-300 transition-colors group"
              >
                <div className="flex items-center space-x-2.5 overflow-hidden">
                  {/* Thumbnail Preview for Images */}
                  {isImg ? (
                    <div 
                      onClick={() => setPreviewImage(att.data)}
                      className="relative w-10 h-10 rounded-lg overflow-hidden border border-slate-200 shrink-0 cursor-pointer group/img bg-slate-100"
                      title="点击放大查看"
                    >
                      <img 
                        src={att.data} 
                        alt={att.name} 
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover/img:opacity-100 flex items-center justify-center text-white transition-opacity">
                        <Eye size={13} />
                      </div>
                    </div>
                  ) : att.name.endsWith('.md') ? (
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100">
                      <FileCode size={18} className="text-emerald-600" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 border border-slate-200">
                      <FileText size={18} className="text-slate-600" />
                    </div>
                  )}

                  <div className="truncate">
                    <div className="font-medium text-slate-700 truncate max-w-[190px]" title={att.name}>
                      {att.name}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                      {isImg && <span className="text-blue-600 font-medium">图片</span>}
                      <span>{att.size ? `${(att.size / 1024).toFixed(1)} KB` : '附件'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {isImg && (
                    <button
                      type="button"
                      onClick={() => setPreviewImage(att.data)}
                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="放大查看图片"
                    >
                      <ZoomIn size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(idx)}
                    className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                    title="移除附件"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Image Lightbox Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white p-2 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-3 right-3 bg-slate-900/70 hover:bg-slate-900 text-white p-2 rounded-full transition-colors z-10"
              title="关闭"
            >
              <X size={18} />
            </button>
            <img 
              src={previewImage} 
              alt="放大查看" 
              className="max-h-[80vh] max-w-full rounded-xl object-contain mx-auto" 
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Uploader;
