import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GripVertical } from 'lucide-react';

interface Props {
  leftContent: React.ReactNode;
  rightContent: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidthRatio?: number; // Maximum ratio of total container width (e.g. 0.65)
  className?: string;
}

export const ResizableSplitPane: React.FC<Props> = ({
  leftContent,
  rightContent,
  defaultLeftWidth = 420,
  minLeftWidth = 300,
  maxLeftWidthRatio = 0.65,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = localStorage.getItem('ky_split_left_width');
    return saved ? parseInt(saved, 10) : defaultLeftWidth;
  });
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setLeftWidth(defaultLeftWidth);
    localStorage.setItem('ky_split_left_width', String(defaultLeftWidth));
  }, [defaultLeftWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      const maxAllowedWidth = containerRect.width * maxLeftWidthRatio;

      const clampedWidth = Math.max(minLeftWidth, Math.min(newWidth, maxAllowedWidth));
      setLeftWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        localStorage.setItem('ky_split_left_width', String(leftWidth));
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, leftWidth, maxLeftWidthRatio, minLeftWidth]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full flex flex-col lg:flex-row p-4 overflow-hidden min-h-0 relative ${className}`}
    >
      {/* Left Input Workspace */}
      <div
        style={{ width: undefined }}
        className="w-full lg:shrink-0 h-full flex flex-col overflow-hidden min-h-0"
        ref={(el) => {
          if (el && window.innerWidth >= 1024) {
            el.style.width = `${leftWidth}px`;
          }
        }}
      >
        {leftContent}
      </div>

      {/* Draggable Divider Bar */}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="按住鼠标左键左右拖动调节宽度，双击恢复默认"
        className={`hidden lg:flex items-center justify-center w-3 shrink-0 mx-1 cursor-col-resize group relative z-10 transition-colors select-none ${
          isDragging ? 'bg-blue-500/20' : 'hover:bg-blue-500/10'
        }`}
      >
        <div
          className={`w-1 h-12 rounded-full transition-all flex items-center justify-center ${
            isDragging
              ? 'bg-blue-600 scale-y-125 shadow-sm'
              : 'bg-slate-300 group-hover:bg-blue-500 group-hover:scale-y-110'
          }`}
        >
          <GripVertical
            size={10}
            className={`opacity-0 group-hover:opacity-100 transition-opacity ${
              isDragging ? 'opacity-100 text-white' : 'text-slate-600'
            }`}
          />
        </div>
      </div>

      {/* Right Output Workspace */}
      <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
        {rightContent}
      </div>
    </div>
  );
};

export default ResizableSplitPane;
