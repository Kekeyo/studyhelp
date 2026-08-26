/**
 * 专业的考研数学与信号 LaTeX 渲染后 PDF 导出生成器
 * 优先调用客户端 html2pdf 生成并下载真正的 .pdf 文件；
 * 如受沙箱限制，自动无缝降级到独立 A4 排版打印窗口。
 */

export async function exportRenderedPdf(title: string, containerElement: HTMLElement | null, rawMarkdown = '') {
  const sanitizeFilename = (name: string) => {
    return name.replace(/[\\/:*?"<>|]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
  };

  const filename = sanitizeFilename(title);

  // 1. 如果支持 html2pdf，直接生成带 KaTeX 公式的矢量级 PDF 文件下载
  if (typeof (window as any).html2pdf === 'function' && containerElement) {
    try {
      // Create a clean standalone clone with full styling for PDF conversion
      const wrapper = document.createElement('div');
      wrapper.style.padding = '24px 30px';
      wrapper.style.backgroundColor = '#ffffff';
      wrapper.style.color = '#0f172a';
      wrapper.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
      wrapper.style.fontSize = '12pt';
      wrapper.style.lineHeight = '1.6';

      // Academic Header
      const header = document.createElement('div');
      header.style.borderBottom = '2px solid #2563eb';
      header.style.paddingBottom = '10px';
      header.style.marginBottom = '20px';
      header.innerHTML = `
        <div style="font-size: 18pt; font-weight: 800; color: #1e3a8a; margin: 0;">${title}</div>
        <div style="font-size: 9pt; color: #64748b; margin-top: 5px;">生成时间：${new Date().toLocaleString()} · 考研智能学习工作台标准解答</div>
      `;
      wrapper.appendChild(header);

      // Clone rendered content (contains full KaTeX SVGs and equations)
      const contentClone = containerElement.cloneNode(true) as HTMLElement;
      wrapper.appendChild(contentClone);

      const opt = {
        margin: [15, 12, 15, 12],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      await (window as any).html2pdf().set(opt).from(wrapper).save();
      return;
    } catch (e) {
      console.warn('html2pdf generation encountered an issue, falling back to window printing:', e);
    }
  }

  // 2. 降级方案：在新独立窗口中构造完整 KaTeX 样式的学术排版页面并触发打印与保存为 PDF
  try {
    const renderedHtml = containerElement ? containerElement.innerHTML : `<pre>${rawMarkdown}</pre>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error('Popup blocked');
    }

    printWindow.document.open();
    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          @page {
            size: A4 portrait;
            margin: 18mm 15mm 18mm 15mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: #0f172a;
            background: #ffffff;
            padding: 20px 24px;
            font-size: 11pt;
            line-height: 1.6;
          }
          .katex {
            font-size: 1.05em;
          }
          .katex-display {
            margin: 0.8em 0;
            overflow-x: visible;
          }
          .print-header {
            border-bottom: 2px solid #2563eb;
            padding-bottom: 8px;
            margin-bottom: 20px;
          }
          .print-header h1 {
            font-size: 18pt;
            font-weight: 800;
            color: #1e3a8a;
            margin: 0;
          }
          .print-header .meta {
            font-size: 9pt;
            color: #64748b;
            margin-top: 4px;
          }
          h2 {
            font-size: 13pt;
            font-weight: 700;
            color: #1e293b;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 4px;
            margin-top: 18px;
            margin-bottom: 10px;
          }
          h3 {
            font-size: 11pt;
            font-weight: 700;
            color: #2563eb;
            margin-top: 12px;
            margin-bottom: 6px;
          }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 15px; padding: 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; font-size: 10pt; color: #1e40af; display: flex; justify-content: space-between; align-items: center;">
          <span>提示：请在系统打印窗口的“目标打印机”中选择<b>“另存为 PDF”</b>即可保存文件。</span>
          <button onclick="window.print()" style="background: #2563eb; color: #fff; border: 0; padding: 6px 14px; border-radius: 6px; font-weight: 600; cursor: pointer;">直接保存/打印</button>
        </div>
        <div class="print-header">
          <h1>${title}</h1>
          <div class="meta">生成日期：${new Date().toLocaleString()} · 考研智能学习工作台标准解答</div>
        </div>
        <div class="prose max-w-none">
          ${renderedHtml}
        </div>
        <script>
          setTimeout(() => {
            window.focus();
            window.print();
          }, 400);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  } catch (windowErr) {
    console.error('Fallback print window error, triggering direct print:', windowErr);
    window.print();
  }
}
