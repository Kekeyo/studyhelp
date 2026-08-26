import React, { useState } from 'react';
import { 
  Cpu, Timer, Zap, Activity, ChevronDown, ChevronUp, 
  BrainCircuit, CheckCircle, AlertCircle, Coins
} from 'lucide-react';
import { StageMetrics, TaskStatus } from '../types.ts';

interface Props {
  stages: Record<string, StageMetrics>;
  activeStageId?: string;
  statusText?: string;
  status: TaskStatus;
}

export const RealtimeExecutionDashboard: React.FC<Props> = ({
  stages,
  activeStageId,
  statusText,
  status
}) => {
  const [showThoughtDetails, setShowThoughtDetails] = useState<Record<string, boolean>>({
    stage1_draft: true,
    stage2_review: false,
    stage3_final: false
  });

  const stageList = Object.values(stages);
  const activeStage = activeStageId ? stages[activeStageId] : undefined;

  // Accurately compute cumulative totals across all stages (sum of all finished and in-progress stages)
  const totalDurationMs = stageList.reduce((acc, s) => acc + (s.durationMs || 0), 0);
  const totalCharCount = stageList.reduce((acc, s) => acc + (s.charCount || 0), 0);
  const totalTokens = stageList.reduce((acc, s) => {
    const sTokens = s.tokenUsage?.totalTokens ?? s.tokensCount ?? (s.charCount > 0 ? Math.round(s.charCount * 0.9) : 0);
    return acc + sTokens;
  }, 0);

  const toggleThought = (stageId: string) => {
    setShowThoughtDetails(prev => ({ ...prev, [stageId]: !prev[stageId] }));
  };

  const getStatusBadge = (s: StageMetrics['status']) => {
    switch (s) {
      case 'preparing':
        return <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">输入准备完成</span>;
      case 'requesting':
        return <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium animate-pulse">请求中 · 等待首Token</span>;
      case 'streaming':
        return <span className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-medium animate-pulse">流式传输中</span>;
      case 'completed':
        return <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">已完成</span>;
      case 'failed':
        return <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full font-medium">失败</span>;
      default:
        return <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">等待中</span>;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 shrink-0 animate-in fade-in duration-150">
      {/* Top Header with live model & thinking level */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600">
            {status === TaskStatus.DONE ? (
              <CheckCircle size={18} className="text-emerald-600" />
            ) : status === TaskStatus.ERROR ? (
              <AlertCircle size={18} className="text-rose-600" />
            ) : (
              <Activity size={18} className="text-blue-600 animate-pulse" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-800">AI 多阶段推理实时监控</h4>
              {activeStage && (
                <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                  模型: {activeStage.modelUsed}
                </span>
              )}
              {activeStage && (
                <span className="text-[11px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-100 flex items-center gap-1">
                  <BrainCircuit size={12} />
                  <span>Thinking: {activeStage.thinkingLevel.toUpperCase()}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">{statusText || '正在调度考研多阶段求解器...'}</p>
          </div>
        </div>

        {/* Aggregate Cumulative Summary across ALL stages (Summed accurately) */}
        <div className="flex items-center gap-3 text-xs font-mono text-slate-700 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
          <div className="flex items-center gap-1" title={activeStage?.ttftMs ? `当前阶段首Token: ${activeStage.ttftMs}ms` : '首 Token 响应延迟'}>
            <Zap size={13} className="text-amber-500" />
            <span>TTFT: {activeStage?.ttftMs !== undefined ? `${activeStage.ttftMs}ms` : '-'}</span>
          </div>
          <div className="w-px h-3.5 bg-slate-200" />
          <div className="flex items-center gap-1" title="全阶段累计总耗时（各阶段耗时之和）">
            <Timer size={13} className="text-blue-500" />
            <span>总耗时: {(totalDurationMs / 1000).toFixed(2)}s</span>
          </div>
          <div className="w-px h-3.5 bg-slate-200" />
          <div className="flex items-center gap-1" title="全阶段累计输出总字符数">
            <Cpu size={13} className="text-emerald-500" />
            <span>总输出: {totalCharCount} 字</span>
          </div>
          <div className="w-px h-3.5 bg-slate-200" />
          <div className="flex items-center gap-1 text-indigo-700 font-bold" title="全阶段累计消耗总 Token 数（各阶段 Token 之和）">
            <Coins size={13} className="text-indigo-500" />
            <span>总消耗: {totalTokens} Tokens</span>
          </div>
        </div>
      </div>

      {/* 3 Real Event-Driven Stage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {stageList.map((stage, idx) => {
          const isActive = stage.stageId === activeStageId;
          const stageTokenCount = stage.tokenUsage?.totalTokens ?? stage.tokensCount ?? (stage.charCount > 0 ? Math.round(stage.charCount * 0.9) : 0);
          return (
            <div
              key={stage.stageId}
              className={`p-3.5 rounded-xl border transition-all ${
                isActive
                  ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/10 shadow-xs'
                  : stage.status === 'completed'
                  ? 'bg-emerald-50/30 border-emerald-200'
                  : stage.status === 'failed'
                  ? 'bg-rose-50/50 border-rose-300'
                  : 'bg-slate-50/40 border-slate-200 opacity-70'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span className={`w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center font-bold ${
                    stage.status === 'completed' ? 'bg-emerald-600' : isActive ? 'bg-blue-600' : 'bg-slate-400'
                  }`}>
                    {idx + 1}
                  </span>
                  <span>{stage.stageName}</span>
                </span>
                {getStatusBadge(stage.status)}
              </div>

              {/* Metrics metadata inside card including Token consumption */}
              <div className="space-y-1 text-[11px] font-mono text-slate-500">
                <div className="flex justify-between">
                  <span>首Token响应:</span>
                  <span className="text-slate-700 font-semibold">{stage.ttftMs ? `${stage.ttftMs}ms` : '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span>阶段耗时:</span>
                  <span className="text-slate-700 font-semibold">{stage.durationMs ? `${(stage.durationMs / 1000).toFixed(2)}s` : '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span>累计生成:</span>
                  <span className="text-slate-700 font-semibold">{stage.charCount} 字符</span>
                </div>
                <div className="flex justify-between pt-0.5 border-t border-slate-200/60 font-semibold">
                  <span className="text-indigo-600 flex items-center gap-0.5">
                    <Coins size={11} />
                    <span>消耗 Token:</span>
                  </span>
                  <span className="text-indigo-700 font-bold">
                    {stageTokenCount > 0 ? `${stageTokenCount} Tokens` : '-'}
                  </span>
                </div>
              </div>

              {/* Error indicator */}
              {stage.error && (
                <div className="mt-2 text-[11px] text-rose-700 font-mono bg-rose-50 p-2 rounded-lg border border-rose-200 break-all leading-tight">
                  {stage.error}
                </div>
              )}

              {/* Thought summary toggle button if thought text exists */}
              {stage.thoughtText && (
                <button
                  type="button"
                  onClick={() => toggleThought(stage.stageId)}
                  className="mt-2.5 w-full text-[11px] font-medium text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100/80 border border-indigo-200 rounded-lg py-1 px-2 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-1">
                    <BrainCircuit size={12} />
                    <span>模型思考摘要 ({stage.thoughtText.length} 字)</span>
                  </span>
                  {showThoughtDetails[stage.stageId] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Real-Time Model Thought Stream / Summary Box */}
      {stageList.some(s => s.thoughtText) && (
        <div className="mt-4 space-y-2">
          {stageList
            .filter(s => s.thoughtText && showThoughtDetails[s.stageId])
            .map(s => (
              <div key={s.stageId} className="bg-slate-900 text-slate-200 rounded-xl p-3.5 font-mono text-xs border border-slate-800 animate-in fade-in duration-150">
                <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2 mb-2">
                  <div className="flex items-center gap-1.5 text-indigo-400 font-semibold">
                    <BrainCircuit size={14} />
                    <span>【{s.stageName}】模型思考过程 (Thinking Trace)</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Thinking Level: {s.thinkingLevel.toUpperCase()}</span>
                </div>
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed text-slate-300 select-text">
                  {s.thoughtText}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default RealtimeExecutionDashboard;
