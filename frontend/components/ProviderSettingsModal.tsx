import React, { useState, useEffect } from 'react';
import { X, Save, Sliders, CheckCircle, AlertTriangle, RefreshCw, Cpu, Edit } from 'lucide-react';
import { ProviderConfig, ProviderType } from '../types.ts';
import { 
  DEFAULT_PROVIDER_CONFIGS, 
  VERTEX_MODEL_OPTIONS,
  loadStoredProviderConfig, 
  saveStoredProviderConfig, 
  testProviderConnection 
} from '../services/aiAdapter.ts';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const PROVIDER_OPTIONS: { label: string; value: ProviderType }[] = [
  { label: 'Google Vertex AI (ADC，仅限本地)', value: 'vertex' },
  { label: 'Google Gemini API', value: 'gemini' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Anthropic Claude', value: 'anthropic' },
  { label: 'Custom OpenAI-Compatible', value: 'custom-openai' }
];

export const ProviderSettingsModal: React.FC<Props> = ({ isOpen, onClose, onSaved }) => {
  const [config, setConfig] = useState<ProviderConfig>(DEFAULT_PROVIDER_CONFIGS.gemini);
  const [selectedDropdownValue, setSelectedDropdownValue] = useState<string>('gemini-2.5-flash');
  const [isCustomVertexModel, setIsCustomVertexModel] = useState<boolean>(false);
  const [customVertexModelInput, setCustomVertexModelInput] = useState<string>('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const stored = loadStoredProviderConfig();
      setConfig(stored);
      setTestResult(null);

      // Check if Vertex model matches one of the predefined list options
      if (stored.type === 'vertex') {
        const found = VERTEX_MODEL_OPTIONS.find(opt => opt.value === stored.model && opt.value !== '__custom__');
        if (found) {
          setSelectedDropdownValue(stored.model);
          setIsCustomVertexModel(false);
          setCustomVertexModelInput('');
        } else {
          setSelectedDropdownValue('__custom__');
          setIsCustomVertexModel(true);
          setCustomVertexModelInput(stored.model || '');
        }
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleProviderChange = (type: ProviderType) => {
    const def = DEFAULT_PROVIDER_CONFIGS[type];
    setConfig(prev => ({
      ...def,
      apiKey: prev.apiKey || def.apiKey,
      baseUrl: def.baseUrl,
      model: def.model
    }));

    if (type === 'vertex') {
      const found = VERTEX_MODEL_OPTIONS.find(opt => opt.value === def.model && opt.value !== '__custom__');
      if (found) {
        setSelectedDropdownValue(def.model);
        setIsCustomVertexModel(false);
      }
    }
    setTestResult(null);
  };

  const handleVertexDropdownChange = (val: string) => {
    setSelectedDropdownValue(val);
    if (val === '__custom__') {
      setIsCustomVertexModel(true);
      const activeModel = customVertexModelInput.trim() || 'gemini-3-flash-preview';
      setConfig(prev => ({ ...prev, model: activeModel }));
    } else {
      setIsCustomVertexModel(false);
      setConfig(prev => ({ ...prev, model: val }));
    }
    setTestResult(null);
  };

  const handleCustomModelInputChange = (val: string) => {
    setCustomVertexModelInput(val);
    setConfig(prev => ({ ...prev, model: val.trim() }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testProviderConnection(config);
    setTestResult(res);
    setTesting(false);
  };

  const handleSave = () => {
    saveStoredProviderConfig(config);
    if (onSaved) onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
          <div className="flex items-center gap-2.5 text-slate-800 font-bold text-lg">
            <Sliders size={20} className="text-blue-600" />
            <span>AI Provider Settings</span>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/50 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
          {/* Provider Select */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Provider
            </label>
            <div className="relative">
              <select
                value={config.type}
                onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm cursor-pointer"
              >
                {PROVIDER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Vertex Fields */}
          {config.type === 'vertex' && (
            <div className="space-y-3 bg-blue-50/50 p-4 rounded-xl border border-blue-100">
              <div className="text-xs text-blue-700 font-medium leading-relaxed">
                Vertex AI 仅支持本地运行：需要同时启动 Node 后端，并通过 gcloud 配置 ADC。GitHub Pages 静态站点无法访问本机认证。Project ID 与 Location 由后端 <code className="bg-blue-100 px-1 py-0.5 rounded text-blue-900 font-mono">.env.local</code> 管理。
              </div>

              {/* Model Dropdown */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Model (选择或自定义模型)
                  </label>
                  <span className="text-[11px] text-blue-600 font-mono font-medium">
                    当前生效: {config.model || '未设定'}
                  </span>
                </div>
                <div className="relative">
                  <select
                    value={isCustomVertexModel ? '__custom__' : selectedDropdownValue}
                    onChange={(e) => handleVertexDropdownChange(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm cursor-pointer"
                  >
                    {VERTEX_MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Custom Model ID Input Field */}
              {isCustomVertexModel && (
                <div className="pt-1 animate-in fade-in duration-150">
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Edit size={13} className="text-blue-600" />
                    <span>输入自定义 Vertex 模型 ID</span>
                  </label>
                  <input
                    type="text"
                    value={customVertexModelInput}
                    onChange={(e) => handleCustomModelInputChange(e.target.value)}
                    placeholder="例如：gemini-3-flash-preview 或任意 Vertex AI 模型 ID"
                    className="w-full bg-white border border-blue-300 rounded-xl px-3.5 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none font-mono shadow-xs"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Google 发布新模型时，可直接在此处填入最新模型标识符，无需更新前端代码。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Gemini Fields */}
          {config.type === 'gemini' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">API Key</label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="AIzaSy..."
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">API Key 仅保存在当前浏览器的 localStorage；请勿在公共或共享设备上保存。</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="gemini-2.5-flash"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
            </div>
          )}

          {/* OpenAI / DeepSeek / Custom / OpenRouter Fields */}
          {(config.type === 'openai' || 
            config.type === 'deepseek' || 
            config.type === 'openrouter' || 
            config.type === 'custom-openai') && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">API Key</label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Base URL</label>
                <input
                  type="text"
                  value={config.baseUrl || ''}
                  onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="gpt-4o / deepseek-chat"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
            </div>
          )}

          {/* Anthropic Fields */}
          {config.type === 'anthropic' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Anthropic API Key</label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="claude-3-5-sonnet-20241022"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                />
              </div>
            </div>
          )}

          {/* Test Status feedback */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 font-medium leading-relaxed border ${
                testResult.success
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 break-all">
                <span className="font-semibold">{testResult.success ? '' : '✗ Test Failed: '}</span>
                <span>{testResult.message}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            {testing && <RefreshCw size={14} className="animate-spin text-blue-600" />}
            <span>{testing ? 'Testing Model via Backend...' : 'Test Connection'}</span>
          </button>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-2"
            >
              <Save size={16} />
              <span>Save Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
