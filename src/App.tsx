/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  PenTool,
  Grid3X3,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  Trash2,
  Copy,
  Check,
  Download,
  Plus,
  Compass,
  Sparkles,
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react';

type BackgroundStyle = 'blank' | 'dots' | 'grid' | 'lines';
type Mode = 'notes' | 'canvas';

interface CanvasItem {
  id: string;
  x: number;
  y: number;
  type: 'card' | 'sticky';
  color: string;
  title: string;
  content: string;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [bgStyle, setBgStyle] = useState<BackgroundStyle>('dots');
  const [mode, setMode] = useState<Mode>('notes');
  const [noteContent, setNoteContent] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [cards, setCards] = useState<CanvasItem[]>([
    {
      id: '1',
      x: 80,
      y: 80,
      type: 'sticky',
      color: 'amber',
      title: 'Blank Canvas Ready',
      content: 'Start typing in Notes mode or drag and add ideas directly on this infinite surface.'
    }
  ]);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleCopy = async () => {
    const textToCopy = mode === 'notes' 
      ? noteContent 
      : cards.map(c => `${c.title}\n${c.content}`).join('\n\n---\n\n');
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const textToExport = mode === 'notes' 
      ? noteContent 
      : JSON.stringify(cards, null, 2);
    const blob = new Blob([textToExport], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mode === 'notes' ? 'blank-app-notes.txt' : 'blank-canvas.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const addCard = (color: string = 'zinc') => {
    const newCard: CanvasItem = {
      id: Date.now().toString(),
      x: 120 + (cards.length * 30) % 300,
      y: 120 + (cards.length * 30) % 200,
      type: 'sticky',
      color,
      title: 'New Idea',
      content: 'Click here to write anything...'
    };
    setCards([...cards, newCard]);
  };

  const updateCard = (id: string, updates: Partial<CanvasItem>) => {
    setCards(cards.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteCard = (id: string) => {
    setCards(cards.filter(c => c.id !== id));
  };

  const clearCurrent = () => {
    if (mode === 'notes') {
      setNoteContent('');
    } else {
      setCards([]);
    }
  };

  // Dragging logic for canvas items
  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    const card = cards.find(c => c.id === id);
    if (!card) return;
    setActiveCardId(id);
    setDragOffset({
      x: e.clientX / (zoom / 100) - card.x,
      y: e.clientY / (zoom / 100) - card.y
    });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeCardId) return;
    const newX = Math.round(e.clientX / (zoom / 100) - dragOffset.x);
    const newY = Math.round(e.clientY / (zoom / 100) - dragOffset.y);
    updateCard(activeCardId, { x: Math.max(10, newX), y: Math.max(10, newY) });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeCardId) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Safe ignore
      }
      setActiveCardId(null);
    }
  };

  const isDark = theme === 'dark';

  const getBgStyle = () => {
    if (bgStyle === 'blank') return {};
    if (bgStyle === 'dots') {
      return {
        backgroundImage: isDark 
          ? 'radial-gradient(circle, rgba(255,255,255,0.08) 1.5px, transparent 1.5px)' 
          : 'radial-gradient(circle, rgba(0,0,0,0.08) 1.5px, transparent 1.5px)',
        backgroundSize: '24px 24px'
      };
    }
    if (bgStyle === 'grid') {
      const lineColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
      return {
        backgroundImage: `linear-gradient(to right, ${lineColor} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`,
        backgroundSize: '32px 32px'
      };
    }
    if (bgStyle === 'lines') {
      const lineColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      return {
        backgroundImage: `linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`,
        backgroundSize: '100% 32px'
      };
    }
    return {};
  };

  const wordCount = noteContent.trim() ? noteContent.trim().split(/\s+/).length : 0;
  const charCount = noteContent.length;

  return (
    <div
      className={`min-h-screen w-full flex flex-col transition-colors duration-200 select-none ${
        isDark ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'
      }`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Top Header / Status bar */}
      <header
        className={`h-14 border-b px-4 flex items-center justify-between shrink-0 ${
          isDark ? 'border-zinc-800/80 bg-zinc-950/80' : 'border-zinc-200 bg-white/80'
        } backdrop-blur-md z-20`}
      >
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 px-2.5 py-1 rounded-md bg-zinc-500/10 border border-zinc-500/20 font-medium text-xs tracking-wide">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>BLANK WORKSPACE</span>
          </div>

          <div className="h-4 w-px bg-zinc-500/20 mx-1" />

          {/* Mode Switcher */}
          <div className={`flex p-0.5 rounded-lg border text-xs font-medium ${isDark ? 'border-zinc-800 bg-zinc-900/80' : 'border-zinc-200 bg-zinc-100'}`}>
            <button
              onClick={() => setMode('notes')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md transition-all ${
                mode === 'notes'
                  ? isDark ? 'bg-zinc-800 text-white shadow-xs' : 'bg-white text-zinc-900 shadow-xs'
                  : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Notes</span>
            </button>
            <button
              onClick={() => setMode('canvas')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md transition-all ${
                mode === 'canvas'
                  ? isDark ? 'bg-zinc-800 text-white shadow-xs' : 'bg-white text-zinc-900 shadow-xs'
                  : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>Canvas Board</span>
            </button>
          </div>
        </div>

        {/* Center / Stats info */}
        <div className="hidden md:flex items-center space-x-4 text-xs text-zinc-500 font-mono">
          {mode === 'notes' ? (
            <>
              <span>{wordCount} words</span>
              <span>•</span>
              <span>{charCount} chars</span>
            </>
          ) : (
            <>
              <span>{cards.length} cards</span>
              <span>•</span>
              <span>{zoom}% zoom</span>
            </>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Pattern selector */}
          <div className={`flex items-center p-0.5 rounded-lg border text-xs ${isDark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-100'}`}>
            <button
              title="Blank"
              onClick={() => setBgStyle('blank')}
              className={`px-2 py-1 rounded transition-colors ${bgStyle === 'blank' ? (isDark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900 font-medium') : 'text-zinc-400'}`}
            >
              Plain
            </button>
            <button
              title="Dots"
              onClick={() => setBgStyle('dots')}
              className={`px-2 py-1 rounded transition-colors ${bgStyle === 'dots' ? (isDark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900 font-medium') : 'text-zinc-400'}`}
            >
              Dots
            </button>
            <button
              title="Grid"
              onClick={() => setBgStyle('grid')}
              className={`px-2 py-1 rounded transition-colors ${bgStyle === 'grid' ? (isDark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900 font-medium') : 'text-zinc-400'}`}
            >
              Grid
            </button>
            <button
              title="Lines"
              onClick={() => setBgStyle('lines')}
              className={`px-2 py-1 rounded transition-colors ${bgStyle === 'lines' ? (isDark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900 font-medium') : 'text-zinc-400'}`}
            >
              Lines
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-500/20 mx-1" />

          {/* Canvas Controls */}
          {mode === 'canvas' && (
            <>
              <button
                onClick={() => setZoom(Math.max(50, zoom - 10))}
                title="Zoom Out"
                className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom(Math.min(150, zoom + 10))}
                title="Zoom In"
                className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setZoom(100)}
                title="Reset Zoom"
                className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => addCard('zinc')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Note</span>
              </button>
            </>
          )}

          {/* Quick utility buttons */}
          <button
            onClick={handleCopy}
            title="Copy all content"
            className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={handleExport}
            title="Download file"
            className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={clearCurrent}
            title="Clear all"
            className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-red-500/10 hover:border-red-500/30 text-zinc-400 hover:text-red-400' : 'border-zinc-200 hover:bg-red-50 hover:border-red-200 text-zinc-600 hover:text-red-600'}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title="Toggle theme"
            className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className={`p-1.5 rounded-lg border transition-colors ${isDark ? 'border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'}`}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="flex-1 relative overflow-hidden" style={getBgStyle()}>
        {mode === 'notes' ? (
          <div className="w-full h-full max-w-4xl mx-auto p-8 sm:p-12 flex flex-col">
            <textarea
              autoFocus
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="This is your blank canvas. Type your notes, code, thoughts, or ideas freely..."
              className={`w-full h-full resize-none outline-hidden font-mono text-base leading-relaxed bg-transparent transition-colors placeholder:text-zinc-500/50 ${
                isDark ? 'text-zinc-100' : 'text-zinc-900'
              }`}
            />
          </div>
        ) : (
          <div
            className="w-full h-full relative overflow-auto"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: '0 0',
              minWidth: '2000px',
              minHeight: '2000px'
            }}
          >
            {cards.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-zinc-500">
                <Compass className="w-12 h-12 mb-3 stroke-1 opacity-40 animate-pulse" />
                <p className="text-sm font-medium">Canvas is completely empty</p>
                <p className="text-xs opacity-60 mt-1">Click "+ Add Note" in the top bar to place your first item.</p>
              </div>
            ) : (
              cards.map((card) => (
                <div
                  key={card.id}
                  style={{ left: `${card.x}px`, top: `${card.y}px` }}
                  className={`absolute w-72 rounded-xl p-4 shadow-lg cursor-grab active:cursor-grabbing border select-text transition-shadow ${
                    isDark
                      ? card.color === 'amber'
                        ? 'bg-amber-950/40 border-amber-800/60 text-amber-200 shadow-amber-950/20'
                        : card.color === 'emerald'
                        ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200 shadow-emerald-950/20'
                        : card.color === 'blue'
                        ? 'bg-blue-950/40 border-blue-800/60 text-blue-200 shadow-blue-950/20'
                        : 'bg-zinc-900/90 border-zinc-800 text-zinc-100 shadow-black/40'
                      : card.color === 'amber'
                      ? 'bg-amber-50 border-amber-200 text-amber-900 shadow-amber-100'
                      : card.color === 'emerald'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900 shadow-emerald-100'
                      : card.color === 'blue'
                      ? 'bg-blue-50 border-blue-200 text-blue-900 shadow-blue-100'
                      : 'bg-white border-zinc-200 text-zinc-900 shadow-zinc-200/50'
                  }`}
                >
                  <div
                    onPointerDown={(e) => handlePointerDown(e, card.id)}
                    className="flex items-center justify-between pb-2 mb-2 border-b border-black/10 dark:border-white/10"
                  >
                    <input
                      type="text"
                      value={card.title}
                      onChange={(e) => updateCard(card.id, { title: e.target.value })}
                      className="font-semibold text-sm bg-transparent outline-hidden w-full"
                    />
                    <div className="flex items-center space-x-1 pl-2">
                      <button
                        onClick={() => deleteCard(card.id)}
                        className="opacity-40 hover:opacity-100 transition-opacity p-1 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={card.content}
                    onChange={(e) => updateCard(card.id, { content: e.target.value })}
                    className="w-full text-xs leading-relaxed bg-transparent resize-none outline-hidden placeholder:text-zinc-500/40"
                    placeholder="Type anything..."
                  />
                  {/* Color dot pickers */}
                  <div className="flex items-center space-x-1.5 pt-2 mt-2 border-t border-black/5 dark:border-white/5">
                    {(['zinc', 'amber', 'emerald', 'blue'] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => updateCard(card.id, { color: c })}
                        className={`w-3.5 h-3.5 rounded-full border ${
                          c === 'zinc'
                            ? 'bg-zinc-400 border-zinc-500'
                            : c === 'amber'
                            ? 'bg-amber-400 border-amber-500'
                            : c === 'emerald'
                            ? 'bg-emerald-400 border-emerald-500'
                            : 'bg-blue-400 border-blue-500'
                        } ${card.color === c ? 'ring-2 ring-offset-1 ring-zinc-400' : ''}`}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Footer bar */}
      <footer
        className={`h-9 border-t px-4 flex items-center justify-between text-[11px] font-mono shrink-0 ${
          isDark ? 'border-zinc-800/80 bg-zinc-950/80 text-zinc-500' : 'border-zinc-200 bg-white/80 text-zinc-400'
        }`}
      >
        <div className="flex items-center space-x-3">
          <span>Blank App Studio</span>
          <span>•</span>
          <span className="text-emerald-500">Ready</span>
        </div>
        <div className="flex items-center space-x-4">
          <span>Esc / Space / Click to focus</span>
        </div>
      </footer>
    </div>
  );
}
