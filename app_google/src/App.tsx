import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { papersData, fieldColors, Paper, fieldList } from './data';
import { Search, X, SlidersHorizontal, Info, Map as MapIcon, List, Calendar, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'map' | 'latest'>('map');
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [yearRange, setYearRange] = useState<[number, number]>([2010, 2026]);
  const [hoveredPaper, setHoveredPaper] = useState<Paper | null>(null);
  const [activeFields, setActiveFields] = useState<Set<string>>(new Set());

  // Filter data based on year range and active fields
  const filteredData = useMemo(() => {
    return papersData.filter((p) => {
      const inYearRange = p.year >= yearRange[0] && p.year <= yearRange[1];
      const inField = activeFields.size === 0 || activeFields.has(p.field);
      return inYearRange && inField;
    });
  }, [yearRange, activeFields]);

  // Latest papers of the week
  const latestPapers = useMemo(() => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    return papersData
      .filter((p) => new Date(p.publishDate) >= oneWeekAgo)
      .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());
  }, []);

  const toggleField = (field: string) => {
    const newFields = new Set(activeFields);
    if (newFields.has(field)) {
      newFields.delete(field);
    } else {
      newFields.add(field);
    }
    setActiveFields(newFields);
  };

  // Setup D3 and Canvas for Map View
  useEffect(() => {
    if (view !== 'map') return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const xExtent = d3.extent(papersData, (d) => d.x) as [number, number];
    const yExtent = d3.extent(papersData, (d) => d.y) as [number, number];

    const xScale = d3.scaleLinear().domain(xExtent).range([50, width - 50]);
    const yScale = d3.scaleLinear().domain(yExtent).range([height - 50, 50]);

    let currentTransform = d3.zoomIdentity;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(currentTransform.x, currentTransform.y);
      ctx.scale(currentTransform.k, currentTransform.k);

      filteredData.forEach((d) => {
        ctx.beginPath();
        const cx = xScale(d.x);
        const cy = yScale(d.y);
        ctx.arc(cx, cy, 2.5 / currentTransform.k, 0, 2 * Math.PI);
        ctx.fillStyle = fieldColors[d.field] || '#999';
        
        if (hoveredPaper && hoveredPaper.id === d.id) {
          ctx.fillStyle = '#000';
          ctx.arc(cx, cy, 5 / currentTransform.k, 0, 2 * Math.PI);
        } else if (selectedPaper && selectedPaper.id === d.id) {
          ctx.fillStyle = '#000';
          ctx.arc(cx, cy, 6 / currentTransform.k, 0, 2 * Math.PI);
        } else if (hoveredPaper || selectedPaper) {
          ctx.globalAlpha = 0.1;
        } else {
          ctx.globalAlpha = 0.8;
        }
        
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      ctx.restore();
    };

    draw();

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.5, 40])
      .on('zoom', (e) => {
        currentTransform = e.transform;
        draw();
      });

    d3.select(canvas).call(zoom);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const invertedX = currentTransform.invertX(mouseX);
      const invertedY = currentTransform.invertY(mouseY);

      let closest: Paper | null = null;
      let minDist = 8 / currentTransform.k;

      filteredData.forEach((d) => {
        const cx = xScale(d.x);
        const cy = yScale(d.y);
        const dist = Math.hypot(cx - invertedX, cy - invertedY);
        if (dist < minDist) {
          minDist = dist;
          closest = d;
        }
      });

      if (closest !== hoveredPaper) {
        setHoveredPaper(closest);
        canvas.style.cursor = closest ? 'pointer' : 'default';
        draw();
      }
    };

    const handleClick = () => {
      if (hoveredPaper) {
        setSelectedPaper(hoveredPaper);
      } else {
        setSelectedPaper(null);
      }
      draw();
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      canvas.width = newWidth * dpr;
      canvas.height = newHeight * dpr;
      canvas.style.width = `${newWidth}px`;
      canvas.style.height = `${newHeight}px`;
      ctx.scale(dpr, dpr);
      xScale.range([50, newWidth - 50]);
      yScale.range([newHeight - 50, 50]);
      draw();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('resize', handleResize);
      d3.select(canvas).on('.zoom', null);
    };
  }, [view, filteredData, hoveredPaper, selectedPaper]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="flex h-screen w-full bg-[#f8f9fa] font-sans overflow-hidden text-gray-800">
      {/* Navigation Rail */}
      <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-6 gap-8 z-40">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
          <Search className="w-6 h-6" />
        </div>
        
        <div className="flex flex-col gap-4">
          <button 
            onClick={() => setView('map')}
            className={`p-3 rounded-xl transition-all ${view === 'map' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'}`}
            title="Map View"
          >
            <MapIcon className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setView('latest')}
            className={`p-3 rounded-xl transition-all ${view === 'latest' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'}`}
            title="Latest Papers"
          >
            <List className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative flex-1 flex flex-col min-w-0">
        <AnimatePresence mode="wait">
          {view === 'map' ? (
            <motion.div 
              key="map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative flex-1" 
              ref={containerRef}
            >
              <canvas ref={canvasRef} className="absolute inset-0 z-0" />

              {/* Map Controls Overlay */}
              <div className="absolute top-6 left-6 z-10 flex flex-col gap-4 w-72">
                <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-xl shadow-black/5 border border-white p-5 flex flex-col gap-4">
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight text-gray-900">Paper Map</h1>
                    <p className="text-xs text-gray-500 mt-1">Exploring {filteredData.length.toLocaleString()} embeddings</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      <span>Timeline</span>
                      <span>{yearRange[0]} — {yearRange[1]}</span>
                    </div>
                    <div className="space-y-4 px-1">
                      <input
                        type="range"
                        min="2010"
                        max="2026"
                        value={yearRange[0]}
                        onChange={(e) => setYearRange([parseInt(e.target.value), yearRange[1]])}
                        className="w-full accent-blue-600 h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                      <input
                        type="range"
                        min="2010"
                        max="2026"
                        value={yearRange[1]}
                        onChange={(e) => setYearRange([yearRange[0], parseInt(e.target.value)])}
                        className="w-full accent-blue-600 h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Legend / Field Filters */}
                <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-xl shadow-black/5 border border-white p-5">
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">Filter by Field</h3>
                  <div className="flex flex-wrap gap-2">
                    {fieldList.map((field) => {
                      const isActive = activeFields.size === 0 || activeFields.has(field);
                      return (
                        <button
                          key={field}
                          onClick={() => toggleField(field)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                            isActive 
                              ? 'bg-white border-gray-200 text-gray-700 shadow-sm' 
                              : 'bg-gray-50 border-transparent text-gray-400 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: fieldColors[field] }} />
                            {field}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {activeFields.size > 0 && (
                    <button 
                      onClick={() => setActiveFields(new Set())}
                      className="mt-4 text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:text-blue-700"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              </div>

              {/* Hover Tooltip */}
              {hoveredPaper && !selectedPaper && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute z-20 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-white p-4 pointer-events-none max-w-xs"
                  style={{ 
                    left: '50%', 
                    top: '50%', 
                    transform: 'translate(-50%, -50%)' 
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: fieldColors[hoveredPaper.field] }} />
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{hoveredPaper.field}</span>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 leading-snug">{hoveredPaper.title}</div>
                  <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {hoveredPaper.year}</span>
                    <span className="flex items-center gap-1"><User className="w-3 h-3" /> {hoveredPaper.author}</span>
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="latest"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full"
            >
              <header className="mb-12">
                <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Latest this week</h1>
                <p className="text-gray-500 mt-2">The most recent contributions to the academic landscape.</p>
              </header>

              <div className="grid gap-6">
                {latestPapers.map((paper) => (
                  <motion.div 
                    key={paper.id}
                    whileHover={{ y: -4 }}
                    onClick={() => setSelectedPaper(paper)}
                    className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-black/5 transition-all cursor-pointer group"
                  >
                    <div className="flex flex-col md:flex-row md:items-start gap-6">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-4">
                          <span className="px-3 py-1 rounded-full bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-widest border border-gray-100">
                            {paper.field}
                          </span>
                          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                            {formatDate(paper.publishDate)}
                          </span>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors">
                          {paper.title}
                        </h2>
                        <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-[10px]">
                              {paper.author[0]}
                            </div>
                            {paper.author}
                          </div>
                        </div>
                        <p className="text-gray-600 leading-relaxed line-clamp-3 text-sm">
                          {paper.abstract}
                        </p>
                      </div>
                      <div className="hidden md:block">
                        <div className="w-12 h-12 rounded-full border border-gray-100 flex items-center justify-center text-gray-300 group-hover:border-blue-200 group-hover:text-blue-500 transition-all">
                          <Info className="w-6 h-6" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Detail Sidebar */}
      <AnimatePresence>
        {selectedPaper && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-[450px] bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col h-full"
          >
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Paper Details</span>
              <button 
                onClick={() => setSelectedPaper(null)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-10 overflow-y-auto flex-1 flex flex-col gap-10">
              <header>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: fieldColors[selectedPaper.field] }} />
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{selectedPaper.field}</span>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-8">
                  {selectedPaper.title}
                </h1>
                
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Author</div>
                    <div className="text-sm font-semibold text-gray-900">{selectedPaper.author}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Published</div>
                    <div className="text-sm font-semibold text-gray-900">{formatDate(selectedPaper.publishDate)}</div>
                  </div>
                </div>
              </header>

              <div className="space-y-4">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Abstract</div>
                <p className="text-base text-gray-600 leading-relaxed font-light">
                  {selectedPaper.abstract}
                </p>
              </div>

              <div className="mt-auto pt-10">
                <button className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-2xl text-sm font-bold transition-all shadow-lg shadow-black/10">
                  Access Full Publication
                </button>
                <p className="text-center text-[10px] text-gray-400 mt-4 uppercase tracking-widest">
                  DOI: 10.1038/s41586-024-00000-x
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
