import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface Props {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

// Pre-process LaTeX delimiters cleanly without touching physical DOM
function preprocessMath(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // 1. Unwrap entire-response code fences if model wrapped the whole answer in ```markdown ... ```
  const codeFenceMatch = text.trim().match(/^```(?:markdown|latex|tex)?\s*([\s\S]*?)\s*```$/i);
  if (codeFenceMatch && codeFenceMatch[1]) {
    text = codeFenceMatch[1];
  }

  // 2. Clean stray escaped markdown characters that model may emit (\_, \*, \#)
  text = text
    .replace(/\\#/g, '#')
    .replace(/\\([*~])/g, '$1')
    .replace(/\\_([a-zA-Z0-9])/g, '_$1');

  // 3. Convert standard LaTeX bracket delimiters \( ... \) and \[ ... \] into $ and $$
  text = text
    .replace(/\\\[\s*/g, '\n\n$$\n')
    .replace(/\s*\\\]/g, '\n$$\n\n')
    .replace(/\\\(\s*/g, '$')
    .replace(/\s*\\\)/g, '$');

  return text;
}

const MarkdownRenderer: React.FC<Props> = ({ content, className = '' }) => {
  const normalizedContent = useMemo(() => preprocessMath(content), [content]);

  return (
    <div className={`prose prose-slate max-w-none prose-headings:text-slate-800 prose-headings:font-bold prose-h2:text-lg prose-h2:border-b prose-h2:border-slate-100 prose-h2:pb-2 prose-h3:text-base prose-p:leading-relaxed prose-pre:bg-slate-900 prose-pre:text-slate-100 text-slate-800 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
