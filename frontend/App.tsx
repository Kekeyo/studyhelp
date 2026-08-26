import React, { useState } from 'react';
import { BookOpen, ChevronDown, Settings } from 'lucide-react';
import { Subject } from './types.ts';
import SignalSystem from './modules/SignalSystem.tsx';
import MathOne from './modules/MathOne.tsx';
import EnglishOne from './modules/EnglishOne.tsx';
import { ProviderSettingsModal } from './components/ProviderSettingsModal.tsx';

export const App: React.FC = () => {
  const [currentSubject, setCurrentSubject] = useState<Subject>(Subject.SIGNAL);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50 flex flex-col font-sans select-none">
      {/* Top Academic Header */}
      <header className="bg-white border-b border-slate-200/90 h-16 shrink-0 flex items-center justify-between px-6 shadow-xs z-30">
        <div className="flex items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-2.5 text-blue-800 font-extrabold text-lg tracking-tight">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">
              <BookOpen size={18} />
            </div>
            <span>学习工作台</span>
          </div>

          {/* Subject Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2.5 bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/60 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 transition-all"
            >
              <span className="text-slate-400">当前科目：</span>
              <span className="text-blue-700 font-bold">
                {currentSubject === Subject.SIGNAL && '信号与系统'}
                {currentSubject === Subject.MATH && '数学一'}
                {currentSubject === Subject.ENGLISH && '英语一'}
              </span>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute top-full left-0 mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl p-1.5 flex flex-col gap-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <button
                    onClick={() => { setCurrentSubject(Subject.SIGNAL); setDropdownOpen(false); }}
                    className={`text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between ${
                      currentSubject === Subject.SIGNAL 
                        ? 'bg-blue-50 text-blue-700' 
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>信号与系统</span>
                    {currentSubject === Subject.SIGNAL && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
                  </button>
                  <button
                    onClick={() => { setCurrentSubject(Subject.MATH); setDropdownOpen(false); }}
                    className={`text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between ${
                      currentSubject === Subject.MATH 
                        ? 'bg-blue-50 text-blue-700' 
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>数学一</span>
                    {currentSubject === Subject.MATH && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
                  </button>
                  <button
                    onClick={() => { setCurrentSubject(Subject.ENGLISH); setDropdownOpen(false); }}
                    className={`text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between ${
                      currentSubject === Subject.ENGLISH 
                        ? 'bg-blue-50 text-blue-700' 
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>英语一</span>
                    {currentSubject === Subject.ENGLISH && <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Settings */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3.5 py-2 rounded-xl transition-all text-xs font-semibold shadow-xs"
        >
          <Settings size={15} className="text-slate-500" />
          <span>AI Provider Settings</span>
        </button>
      </header>

      {/* Main Isolated Workspace */}
      <main className="flex-1 min-h-0 w-full overflow-hidden select-text relative">
        <div className={currentSubject === Subject.SIGNAL ? 'h-full w-full' : 'hidden'}>
          <SignalSystem />
        </div>
        <div className={currentSubject === Subject.MATH ? 'h-full w-full' : 'hidden'}>
          <MathOne />
        </div>
        <div className={currentSubject === Subject.ENGLISH ? 'h-full w-full' : 'hidden'}>
          <EnglishOne />
        </div>
      </main>

      {/* AI Provider Settings Modal */}
      <ProviderSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default App;
