import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from './components/Mermaid';
import { 
  BrainCircuit, 
  ChevronRight, 
  Loader2, 
  FileText, 
  Image as ImageIcon, 
  ClipboardCheck, 
  ShieldCheck,
  Layout,
  Plus,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Upload,
  X,
  FileUp,
  RefreshCw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { 
  plannerAgent, 
  multimediaAgent, 
  assessmentAgent, 
  criticAgent,
  generateImage,
  DEFAULT_PROMPTS,
  PROMPT_PRESETS
} from './services/geminiService';
import { Project, Task, UserInput, SystemPrompts } from './types';

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import pptxgen from "pptxgenjs";

// Set worker source for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [step, setStep] = useState<'input' | 'planning' | 'working' | 'result'>('input');
  const [input, setInput] = useState<UserInput>({
    topic: '',
    gradeLevel: 'High School',
    modality: 'Document',
    objectives: '',
    documentContent: ''
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [viewMode, setViewMode] = useState<'document' | 'slides'>('slides');
  const [showArchitecture, setShowArchitecture] = useState(false);
  const [isDiagramExpanded, setIsDiagramExpanded] = useState(false);
  const [prompts, setPrompts] = useState<SystemPrompts>(DEFAULT_PROMPTS);

  const architectureDiagram = `
flowchart TB
    subgraph Input_Phase [Input & Orchestration]
        UI[User Input: Topic, Grade, Docs] --> Planner{Planner Agent}
        Prompts[(System Prompts)] -.-> Planner
    end

    subgraph Planning_Phase [Sequential Planning]
        Planner --> Objectives[Learning Objectives]
        Objectives --> TaskQueue[Task Queue: Slides 1-N]
    end

    subgraph Execution_Phase [Agent Execution Loop]
        direction LR
        TaskQueue --> Multimedia[Multimedia Agent]
        TaskQueue --> Assessment[Assessment Agent]
        
        Multimedia --> Critic{Critic Agent}
        Assessment --> Critic
        
        Critic -- "REVISE" --> Multimedia
        Critic -- "REVISE" --> Assessment
    end

    subgraph Output_Phase [Final Assembly]
        Critic -- "APPROVED" --> Final[Final Slide Deck]
    end

    classDef agent fill:#5A5A40,color:#fff,stroke:#141414,stroke-width:2px;
    classDef process fill:#F5F5F0,stroke:#141414,stroke-width:1px;
    classDef storage fill:#fff,stroke:#5A5A40,stroke-dasharray: 5 5;

    class Planner,Multimedia,Assessment,Critic agent;
    class Objectives,TaskQueue,Final process;
    class Prompts storage;
`;

  const handleFile = async (file: File) => {
    const isText = file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md');
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');

    if (!isText && !isPdf) {
      alert('Please upload a text, markdown, or PDF file (.txt, .md, .pdf)');
      return;
    }

    if (isPdf) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          let fullText = '';
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
          }
          
          setInput(prev => ({ ...prev, documentContent: fullText }));
          setFileName(file.name);
        } catch (error) {
          console.error("PDF parsing error:", error);
          alert("Failed to parse PDF file.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setInput(prev => ({ ...prev, documentContent: content }));
        setFileName(file.name);
      };
      reader.readAsText(file);
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleStartPlanning = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      // 1. Create project in DB
      const projRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: input.topic,
          grade_level: input.gradeLevel,
          modality: input.modality,
          objectives: input.objectives,
          document_content: input.documentContent
        }),
      });
      
      if (!projRes.ok) {
        const errorText = await projRes.text();
        throw new Error(`Failed to create project: ${projRes.status} ${errorText}`);
      }
      
      const { id: projectId } = await projRes.json();

      // 2. Run Planner Agent
      const { extracted_objectives, tasks } = await plannerAgent(input, prompts);
      
      // Update project with extracted objectives
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extracted_objectives }),
      });

      // 3. Save tasks to DB
      const taskRes = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, tasks }),
      });

      if (!taskRes.ok) {
        const errorText = await taskRes.text();
        throw new Error(`Failed to save tasks: ${taskRes.status} ${errorText}`);
      }

      // 4. Load full project
      const fullProjRes = await fetch(`/api/projects/${projectId}`);
      if (!fullProjRes.ok) {
        throw new Error(`Failed to load project: ${fullProjRes.status}`);
      }
      const fullProj = await fullProjRes.json();
      
      setProject(fullProj);
      setStep('planning');
    } catch (error: any) {
      console.error("Planning error:", error);
      alert(`Planning error: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportPPTX = async () => {
    if (!project) return;
    
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_16x9';
    
    // Title Slide
    const titleSlide = pres.addSlide();
    titleSlide.background = { color: '141414' };
    titleSlide.addText(project.topic, { 
      x: 1, y: 3, w: '80%', h: 1, 
      fontSize: 44, color: 'FFFFFF', 
      fontFace: 'Georgia', italic: true,
      align: 'center'
    });
    titleSlide.addText(`Grade Level: ${project.grade_level} | Modality: ${project.modality}`, { 
      x: 1, y: 4.2, w: '80%', h: 0.5, 
      fontSize: 14, color: 'FFFFFF', 
      align: 'center'
    });

    // Content Slides
    for (const task of project.tasks) {
      if (task.status !== 'completed') continue;
      
      const slide = pres.addSlide();
      slide.background = { color: 'FFFFFF' };
      
      // Slide Title
      slide.addText(task.title, { 
        x: 0.5, y: 0.3, w: '90%', h: 0.8, 
        fontSize: 32, color: '5A5A40', 
        fontFace: 'Georgia', italic: true,
        bold: true
      });

      // Split content into bullets and headers
      const contentParts: { text: string; options: any }[] = [];
      const lines = task.output.split('\n');
      
      let inMarkdownBlock = false;
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
          inMarkdownBlock = !inMarkdownBlock;
          return;
        }
        if (inMarkdownBlock) return;
        
        if (!trimmed || trimmed.startsWith('## ') || trimmed.startsWith('[Layout:')) return;
        
        const isHeader = trimmed.startsWith('### ');
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
        const cleanedText = trimmed
          .replace(/^### /, '')
          .replace(/^[-*] /, '')
          .replace(/\*\*/g, '')
          .replace(/\*/g, '')
          .replace(/\[Visual Strategy:.*?\]/g, '')
          .trim();
        
        if (!cleanedText) return;

        contentParts.push({
          text: cleanedText,
          options: {
            bullet: isBullet ? { indent: 20 } : undefined,
            fontSize: isHeader ? 20 : 14,
            color: isHeader ? '5A5A40' : '333333',
            bold: isHeader,
            paraSpaceBefore: isHeader ? 0.2 : 0.1,
            margin: isBullet ? [0, 0, 0, 10] : [0, 0, 0, 0]
          }
        });
      });

      // Dynamic text sizing to fix "overflow"
      const totalChars = contentParts.reduce((sum, part) => sum + part.text.length, 0);
      let fontSizeScale = 1;
      if (totalChars > 1200) fontSizeScale = 0.6;
      else if (totalChars > 800) fontSizeScale = 0.75;
      else if (totalChars > 500) fontSizeScale = 0.9;

      contentParts.forEach(part => {
        part.options.fontSize = Math.round(part.options.fontSize * fontSizeScale);
      });

      // Check for visuals (Image or Diagram)
      let visualUrl = task.image_url;
      let isDiagram = false;
      
      // Experimental: Capture rendered Mermaid diagram
      if (!visualUrl) {
        try {
          const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
          const svgElement = taskElement?.querySelector('.mermaid-container svg') as SVGElement;
          
          if (svgElement) {
            const serializer = new XMLSerializer();
            const source = '<?xml version="1.0" standalone="no"?>\r\n' + serializer.serializeToString(svgElement);
            const image = new Image();
            const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            
            // Note: SVG to Canvas is async, so we just use the blob URL if possible
            // But pptxgen needs base64 or a real URL. Blobs work in modern browsers.
            visualUrl = url;
            isDiagram = true;
          }
        } catch (e) {
          console.error("Failed to capture diagram for PPTX:", e);
        }
      }

      if (visualUrl) {
        // Layout with visual - fixed positions to prevent "all over the place"
        slide.addImage({ 
          path: visualUrl, 
          x: 0.5, y: 1.2, w: 4.8, h: 3.8,
          sizing: { type: 'contain', w: 4.8, h: 3.8 }
        });
        slide.addText(contentParts, { 
          x: 5.5, y: 1.2, w: 4.0, h: 4.0, 
          valign: 'top',
          align: 'left'
        });
      } else {
        // Full width text
        slide.addText(contentParts, { 
          x: 0.5, y: 1.2, w: 9, h: 4, 
          valign: 'top',
          align: 'left'
        });
      }
    }

    pres.writeFile({ fileName: `${project.topic.replace(/\s+/g, '_')}_Slides.pptx` });
  };

  const handleRefinePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !refinementPrompt.trim()) return;
    
    setIsRefining(true);
    try {
      const { extracted_objectives, tasks } = await plannerAgent(input, prompts, refinementPrompt, project.tasks);
      
      // Update project objectives in DB
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extracted_objectives }),
      });

      // Replace tasks in DB
      // First delete old tasks
      await fetch(`/api/projects/${project.id}/tasks`, { method: 'DELETE' });
      
      // Save new tasks
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, tasks }),
      });

      // Reload project
      const fullProjRes = await fetch(`/api/projects/${project.id}`);
      const fullProj = await fullProjRes.json();
      setProject(fullProj);
      setRefinementPrompt('');
    } catch (error: any) {
      alert(`Refinement error: ${error.message}`);
    } finally {
      setIsRefining(false);
    }
  };

  const handleRunAgents = async () => {
    if (!project) return;
    setStep('working');
    
    const taskPromises = project.tasks.map(async (task, i) => {
      let currentOutput = '';
      let currentFeedback = '';
      let iterations = 0;
      const MAX_ITERATIONS = 1;
      let approved = false;
      let currentImageUrl = '';
      let currentImagePrompt = '';

      while (!approved && iterations < MAX_ITERATIONS) {
        // Update UI to show we are working on a specific iteration
        setProject(prev => {
          if (!prev) return null;
          const newTasks = [...prev.tasks];
          newTasks[i] = { 
            ...task, 
            status: 'working', 
            output: currentOutput,
            image_url: currentImageUrl,
            image_prompt: currentImagePrompt,
            feedback: iterations > 0 ? `[Iteration ${iterations}] ${currentFeedback}` : ''
          };
          return { ...prev, tasks: newTasks };
        });

        try {
          console.log(`Running agent for task: ${task.title} - Iteration ${iterations + 1}`);
          
          if (task.agent_type === 'multimedia') {
            const multimediaResult = await multimediaAgent(task, project, prompts, currentFeedback);
            currentOutput = multimediaResult.markdown;
            currentImagePrompt = multimediaResult.image_prompt || '';
            
            // Start image generation
            const imagePromise = multimediaResult.image_prompt ? generateImage(multimediaResult.image_prompt) : Promise.resolve(null);
            
            // Only run critic if we have more than 1 iteration allowed
            const criticPromise = MAX_ITERATIONS > 1 
              ? criticAgent(currentOutput, task, project, prompts)
              : Promise.resolve('APPROVED');
            
            const [imageUrl, feedback] = await Promise.all([imagePromise, criticPromise]);
            
            if (imageUrl) currentImageUrl = imageUrl;
            currentFeedback = feedback;
          } else if (task.agent_type === 'assessment') {
            currentOutput = await assessmentAgent(task, project, prompts, currentFeedback);
            currentFeedback = MAX_ITERATIONS > 1
              ? await criticAgent(currentOutput, task, project, prompts)
              : 'APPROVED';
          }

          if (!currentOutput) throw new Error("Agent returned empty output");

          console.log(`Critic feedback for ${task.title} (Iter ${iterations + 1}): ${currentFeedback.substring(0, 100)}...`);

          if (currentFeedback.trim().toUpperCase() === 'APPROVED') {
            approved = true;
          }
          
          iterations++;
        } catch (error: any) {
          console.error(`Error in task ${task.title}:`, error);
          setProject(prev => {
            if (!prev) return null;
            const newTasks = [...prev.tasks];
            newTasks[i] = { ...task, status: 'failed', output: `Error: ${error.message}` };
            return { ...prev, tasks: newTasks };
          });
          return;
        }
      }

      if (approved || iterations > 0) {
        // Update DB with final result
        await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            status: 'completed', 
            output: currentOutput, 
            feedback: currentFeedback,
            image_url: currentImageUrl,
            image_prompt: currentImagePrompt
          }),
        });

        setProject(prev => {
          if (!prev) return null;
          const newTasks = [...prev.tasks];
          newTasks[i] = { 
            ...task, 
            status: 'completed', 
            output: currentOutput, 
            feedback: currentFeedback,
            image_url: currentImageUrl,
            image_prompt: currentImagePrompt
          };
          return { ...prev, tasks: newTasks };
        });
      }
    });

    await Promise.all(taskPromises);
    setStep('result');
  };

  const handleReviseTask = async (taskId: string) => {
    if (!project) return;
    
    const taskIndex = project.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = project.tasks[taskIndex];
    const currentTasks = [...project.tasks];
    
    let currentOutput = task.output;
    let currentFeedback = task.feedback || '';
    let iterations = 0;
    const MAX_ITERATIONS = 3; // Smaller limit for manual trigger
    let approved = false;

    let currentImageUrl = task.image_url || '';
    let currentImagePrompt = task.image_prompt || '';

    while (!approved && iterations < MAX_ITERATIONS) {
      setProject(prev => {
        if (!prev) return null;
        const newTasks = [...prev.tasks];
        newTasks[taskIndex] = { 
          ...task, 
          status: 'working', 
          output: currentOutput,
          image_url: currentImageUrl,
          image_prompt: currentImagePrompt,
          feedback: `[Manual Revision ${iterations + 1}] ${currentFeedback}`
        };
        return { ...prev, tasks: newTasks };
      });

      try {
        if (task.agent_type === 'multimedia') {
          const multimediaResult = await multimediaAgent(task, project, prompts, currentFeedback);
          currentOutput = multimediaResult.markdown;
          currentImagePrompt = multimediaResult.image_prompt || '';
          
          const imagePromise = multimediaResult.image_prompt ? generateImage(multimediaResult.image_prompt) : Promise.resolve(null);
          const criticPromise = criticAgent(currentOutput, task, project, prompts);
          
          const [imageUrl, feedback] = await Promise.all([imagePromise, criticPromise]);
          
          if (imageUrl) currentImageUrl = imageUrl;
          currentFeedback = feedback;
        } else if (task.agent_type === 'assessment') {
          currentOutput = await assessmentAgent(task, project, prompts, currentFeedback);
          currentFeedback = await criticAgent(currentOutput, task, project, prompts);
        }

        if (!currentOutput) throw new Error("Agent returned empty output");

        if (currentFeedback.trim().toUpperCase() === 'APPROVED') {
          approved = true;
        }
        
        iterations++;
      } catch (error: any) {
        console.error(`Error revising task ${task.title}:`, error);
        setProject(prev => {
          if (!prev) return null;
          const newTasks = [...prev.tasks];
          newTasks[taskIndex] = { ...task, status: 'failed', output: `Error: ${error.message}` };
          return { ...prev, tasks: newTasks };
        });
        break;
      }
    }

    if (approved || iterations > 0) {
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'completed', 
          output: currentOutput, 
          feedback: currentFeedback,
          image_url: currentImageUrl,
          image_prompt: currentImagePrompt
        }),
      });

      setProject(prev => {
        if (!prev) return null;
        const newTasks = [...prev.tasks];
        newTasks[taskIndex] = { 
          ...task, 
          status: 'completed', 
          output: currentOutput, 
          feedback: currentFeedback,
          image_url: currentImageUrl,
          image_prompt: currentImagePrompt
        };
        return { ...prev, tasks: newTasks };
      });
    }
  };

  if (step === 'input') {
    return (
      <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans">
        <header className="border-b border-[#141414]/10 py-6 px-8 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-full flex items-center justify-center text-white">
              <BrainCircuit size={24} />
            </div>
            <h1 className="text-xl font-serif italic tracking-tight">AI4STEM Multi-Agent Lab</h1>
          </div>
          <button 
            onClick={() => setShowArchitecture(true)}
            className="text-xs uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity flex items-center gap-2"
          >
            <Layout size={16} /> System Architecture
          </button>
        </header>

        <AnimatePresence>
          {showArchitecture && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-8"
              onClick={() => setShowArchitecture(false)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-[40px] p-12 max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <h2 className="text-3xl font-serif italic mb-2">Program Architect</h2>
                    <p className="text-sm opacity-50">Multi-Agent Orchestration for STEM Education</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-[#F5F5F0] px-4 py-2 rounded-full border border-[#141414]/5">
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">Preset</span>
                      <select 
                        onChange={(e) => setPrompts(PROMPT_PRESETS[e.target.value])}
                        className="bg-transparent text-[10px] uppercase tracking-widest font-bold focus:outline-none cursor-pointer"
                      >
                        <option value="standard">Standard (Default)</option>
                        <option value="creative">Creative / Story</option>
                        <option value="concise">Concise / Fact-only</option>
                      </select>
                    </div>
                    <button 
                      onClick={() => setIsDiagramExpanded(!isDiagramExpanded)}
                      className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors text-[#5A5A40]"
                      title={isDiagramExpanded ? "Minimize Diagram" : "Expand Diagram"}
                    >
                      <Layout size={24} />
                    </button>
                    <button onClick={() => setShowArchitecture(false)} className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors">
                      <X size={24} />
                    </button>
                  </div>
                </div>
                
                <motion.div 
                  layout
                  className={cn(
                    "bg-[#F5F5F0] rounded-3xl p-8 border border-[#141414]/5 relative overflow-hidden transition-all duration-500",
                    isDiagramExpanded ? "h-[70vh]" : "h-auto"
                  )}
                >
                  <div className={cn(
                    "w-full h-full flex items-center justify-center",
                    isDiagramExpanded ? "overflow-auto" : ""
                  )}>
                    <Mermaid chart={architectureDiagram} />
                  </div>
                  {!isDiagramExpanded && (
                    <button 
                      onClick={() => setIsDiagramExpanded(true)}
                      className="absolute bottom-4 right-4 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full text-[10px] uppercase tracking-widest font-bold border border-[#141414]/5 shadow-sm hover:bg-white transition-colors"
                    >
                      Click to Expand
                    </button>
                  )}
                </motion.div>

                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[#5A5A40]">
                      <Layout size={16} />
                      <h4 className="text-xs uppercase tracking-widest font-bold">Planner Agent</h4>
                    </div>
                    <textarea 
                      value={prompts.planner}
                      onChange={(e) => setPrompts({ ...prompts, planner: e.target.value })}
                      className="w-full h-48 bg-[#F5F5F0] p-4 rounded-2xl text-[10px] leading-relaxed font-mono opacity-70 border border-[#141414]/5 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] resize-none"
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[#5A5A40]">
                      <FileText size={16} />
                      <h4 className="text-xs uppercase tracking-widest font-bold">Multimedia Agent</h4>
                    </div>
                    <textarea 
                      value={prompts.multimedia}
                      onChange={(e) => setPrompts({ ...prompts, multimedia: e.target.value })}
                      className="w-full h-48 bg-[#F5F5F0] p-4 rounded-2xl text-[10px] leading-relaxed font-mono opacity-70 border border-[#141414]/5 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] resize-none"
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[#5A5A40]">
                      <ClipboardCheck size={16} />
                      <h4 className="text-xs uppercase tracking-widest font-bold">Assessment Agent</h4>
                    </div>
                    <textarea 
                      value={prompts.assessment}
                      onChange={(e) => setPrompts({ ...prompts, assessment: e.target.value })}
                      className="w-full h-48 bg-[#F5F5F0] p-4 rounded-2xl text-[10px] leading-relaxed font-mono opacity-70 border border-[#141414]/5 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] resize-none"
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[#5A5A40]">
                      <ShieldCheck size={16} />
                      <h4 className="text-xs uppercase tracking-widest font-bold">Critic Agent</h4>
                    </div>
                    <textarea 
                      value={prompts.critic}
                      onChange={(e) => setPrompts({ ...prompts, critic: e.target.value })}
                      className="w-full h-48 bg-[#F5F5F0] p-4 rounded-2xl text-[10px] leading-relaxed font-mono opacity-70 border border-[#141414]/5 focus:outline-none focus:ring-1 focus:ring-[#5A5A40] resize-none"
                    />
                  </div>
                </div>

                <div className="mt-8 flex justify-end">
                  <button 
                    onClick={() => setPrompts(DEFAULT_PROMPTS)}
                    className="text-[10px] uppercase tracking-widest font-bold opacity-40 hover:opacity-100 transition-opacity"
                  >
                    Reset to Defaults
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="max-w-3xl mx-auto px-8 py-20">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
            <h2 className="text-5xl md:text-6xl font-serif italic leading-tight mb-6">
              Design Your Learning Experience
            </h2>
            <p className="text-lg opacity-70">
              Our specialized agents work together to plan, write, and visualize your educational content.
            </p>
          </motion.div>

          <form onSubmit={handleStartPlanning} className="bg-white rounded-[32px] p-8 md:p-12 shadow-xl shadow-black/5 border border-[#141414]/5 space-y-8">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="text-xs uppercase tracking-widest font-bold opacity-40">Topic</label>
                <input 
                  type="text" 
                  value={input.topic}
                  onChange={e => setInput({...input, topic: e.target.value})}
                  placeholder="e.g. Quantum Mechanics"
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                  required
                />
              </div>
              <div className="space-y-4">
                <label className="text-xs uppercase tracking-widest font-bold opacity-40">Grade Level</label>
                <select 
                  value={input.gradeLevel}
                  onChange={e => setInput({...input, gradeLevel: e.target.value})}
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40] outline-none appearance-none"
                >
                  <option>Elementary</option>
                  <option>Middle School</option>
                  <option>High School</option>
                  <option>University</option>
                </select>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs uppercase tracking-widest font-bold opacity-40">Objectives</label>
              <textarea 
                value={input.objectives}
                onChange={e => setInput({...input, objectives: e.target.value})}
                placeholder="What should the students learn?"
                className="w-full bg-[#F5F5F0] border-none rounded-2xl px-6 py-4 h-32 focus:ring-2 focus:ring-[#5A5A40] outline-none resize-none"
                required
              />
            </div>

            <div className="space-y-4">
              <label className="text-xs uppercase tracking-widest font-bold opacity-40">Reference Document (Optional)</label>
              <div 
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={cn(
                  "border-2 border-dashed rounded-2xl p-8 transition-all flex flex-col items-center justify-center gap-4 cursor-pointer",
                  isDragging ? "border-[#5A5A40] bg-[#5A5A40]/5" : "border-[#141414]/10 hover:border-[#141414]/20",
                  fileName ? "bg-emerald-50/50 border-emerald-500/30" : ""
                )}
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                <input 
                  id="file-upload"
                  type="file" 
                  className="hidden" 
                  accept=".txt,.md,.pdf"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                {fileName ? (
                  <div className="flex items-center gap-3 text-emerald-700">
                    <FileUp size={32} />
                    <div className="text-left">
                      <div className="font-bold text-sm">{fileName}</div>
                      <div className="text-[10px] uppercase tracking-widest opacity-60">Document Loaded</div>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setFileName(null);
                        setInput(prev => ({ ...prev, documentContent: '' }));
                      }}
                      className="ml-4 p-1 hover:bg-emerald-100 rounded-full transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="opacity-20" />
                    <div className="text-center">
                      <div className="font-bold text-sm">Click or drag to upload</div>
                      <div className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Supports .txt, .md, .pdf</div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <button 
              type="submit"
              disabled={isProcessing}
              className="w-full bg-[#5A5A40] text-white rounded-full py-5 font-bold uppercase tracking-widest hover:bg-[#4A4A30] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isProcessing ? <Loader2 className="animate-spin" /> : <Plus size={20} />}
              {isProcessing ? 'Planning...' : 'Initialize Planner Agent'}
            </button>
          </form>
        </main>
      </div>
    );
  }

  if (step === 'planning' && project) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans p-8">
        <div className="max-w-4xl mx-auto">
          <button onClick={() => setStep('input')} className="flex items-center gap-2 text-sm font-bold opacity-40 hover:opacity-100 mb-8 transition-opacity">
            <ArrowLeft size={16} /> Back to Input
          </button>

          <div className="flex justify-between items-start mb-12">
            <div className="max-w-2xl">
              <h2 className="text-4xl font-serif italic mb-4">Proposed Plan</h2>
              <div className="bg-[#5A5A40]/5 border border-[#5A5A40]/10 p-6 rounded-3xl mb-6">
                <h4 className="text-[10px] uppercase tracking-widest font-bold opacity-40 mb-3">Identified Learning Objectives</h4>
                <p className="text-sm italic leading-relaxed opacity-80">{project.extracted_objectives || project.objectives}</p>
              </div>
              <p className="opacity-60 text-sm">Review the subtasks below. These represent the text and visual content that will be generated.</p>
            </div>
            <button 
              onClick={handleRunAgents}
              className="bg-[#5A5A40] text-white px-8 py-4 rounded-full font-bold uppercase tracking-widest hover:bg-[#4A4A30] transition-all flex items-center gap-3 shrink-0"
            >
              Approve & Execute <ChevronRight size={20} />
            </button>
          </div>

          <div className="grid gap-6 mb-12">
            {project.tasks.map((task, idx) => (
              <motion.div 
                key={task.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="bg-white p-8 rounded-[24px] border border-[#141414]/5 flex gap-6 items-start"
              >
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                  task.agent_type === 'multimedia' ? "bg-blue-50 text-blue-600" :
                  "bg-orange-50 text-orange-600"
                )}>
                  {task.agent_type === 'multimedia' ? <FileText size={24} /> :
                   <ClipboardCheck size={24} />}
                </div>
                <div>
                  <h3 className="text-xl font-serif italic mb-2">{task.title}</h3>
                  <p className="text-sm opacity-60 leading-relaxed">{task.user_summary}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-30">Agent:</span>
                      <span className="text-[10px] uppercase tracking-widest font-bold text-[#5A5A40]">{task.agent_type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest font-bold opacity-30">Instructions:</span>
                      <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-600 flex items-center gap-1">
                        <ShieldCheck size={12} /> Hidden
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Refinement Chat Box */}
          <div className="bg-white p-6 rounded-[32px] border border-[#141414]/10 shadow-lg">
            <h4 className="text-xs uppercase tracking-widest font-bold opacity-40 mb-4 px-2">Customize or Revise Plan</h4>
            <form onSubmit={handleRefinePlan} className="flex gap-4">
              <input 
                type="text"
                value={refinementPrompt}
                onChange={e => setRefinementPrompt(e.target.value)}
                placeholder="e.g. Add more focus on practical examples, or remove the visual task..."
                className="flex-1 bg-[#F5F5F0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                disabled={isRefining}
              />
              <button 
                type="submit"
                disabled={isRefining || !refinementPrompt.trim()}
                className="bg-[#141414] text-white px-8 py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isRefining ? <Loader2 className="animate-spin" size={18} /> : <BrainCircuit size={18} />}
                {isRefining ? 'Refining...' : 'Refine'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans flex">
      {/* Sidebar - Agent Status */}
      <div className="w-80 border-r border-white/10 p-8 flex flex-col">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 bg-[#5A5A40] rounded-full flex items-center justify-center text-white">
            <BrainCircuit size={18} />
          </div>
          <h1 className="text-lg font-serif italic">AI4STEM Lab</h1>
        </div>

        <div className="flex-1 space-y-8">
          <div>
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-30 mb-6">Active Agents</h3>
            <div className="space-y-4">
              {[
                { name: 'Multimedia Agent', icon: FileText, type: 'multimedia' },
                { name: 'Assessment Agent', icon: ClipboardCheck, type: 'assessment' },
                { name: 'Critic Agent', icon: ShieldCheck, type: 'critic' }
              ].map(agent => {
                const isWorking = project?.tasks.some(t => t.agent_type === agent.type && t.status === 'working');
                const isDone = project?.tasks.filter(t => t.agent_type === agent.type).every(t => t.status === 'completed');
                
                return (
                  <div key={agent.name} className={cn(
                    "flex items-center gap-4 p-4 rounded-2xl border transition-all",
                    isWorking ? "border-[#5A5A40] bg-[#5A5A40]/10" : "border-white/5 bg-white/5"
                  )}>
                    <agent.icon size={18} className={cn(isWorking ? "text-[#5A5A40]" : "opacity-40")} />
                    <div className="flex-1">
                      <div className="text-xs font-bold">{agent.name}</div>
                      <div className="text-[9px] uppercase tracking-widest opacity-40 mt-1">
                        {isWorking ? 'Processing...' : isDone ? 'Idle' : 'Waiting'}
                      </div>
                    </div>
                    {isWorking && <Loader2 size={14} className="animate-spin text-[#5A5A40]" />}
                    {isDone && <CheckCircle2 size={14} className="text-emerald-500" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-widest opacity-30 leading-relaxed">
            Multi-Agent System v1.0<br />
            Pedagogical Framework Active
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-12 bg-[#0A0A0A]">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-16">
            <div>
              <h2 className="text-5xl font-serif italic mb-4">{project?.topic}</h2>
              <div className="flex gap-4 text-[10px] uppercase tracking-widest font-bold opacity-40">
                <span>Grade: {project?.grade_level}</span>
                <span>Modality: {project?.modality}</span>
              </div>
            </div>
            
            {step === 'result' && (
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
                <button 
                  onClick={() => setViewMode('slides')}
                  className={cn(
                    "px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    viewMode === 'slides' ? "bg-[#5A5A40] text-white" : "text-white/40 hover:text-white"
                  )}
                >
                  Slide View
                </button>
                <button 
                  onClick={() => setViewMode('document')}
                  className={cn(
                    "px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                    viewMode === 'document' ? "bg-[#5A5A40] text-white" : "text-white/40 hover:text-white"
                  )}
                >
                  Document View
                </button>
              </div>
            )}
          </div>

          <div className={cn(
            "space-y-20",
            viewMode === 'slides' && step === 'result' ? "grid grid-cols-1 gap-24 space-y-0 pb-32" : ""
          )}>
            {project?.tasks.map((task) => (
              <div 
                key={task.id} 
                data-task-id={task.id}
                className={cn(
                  "relative slide-card",
                  viewMode === 'slides' && step === 'result' ? "bg-white/5 border border-white/10 rounded-[40px] p-16 shadow-2xl slide-container" : ""
                )}
              >
                {task.status === 'working' && (
                  <div className="absolute -left-6 top-0 bottom-0 w-1 bg-[#5A5A40] rounded-full animate-pulse" />
                )}
                
                <div className="flex items-center gap-3 mb-6 opacity-40 no-print">
                  <span className="text-[10px] uppercase tracking-widest font-bold">{task.agent_type} Agent</span>
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] uppercase tracking-widest font-bold">{task.status}</span>
                </div>

                {task.status === 'completed' ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    <div className={cn(
                      "prose prose-invert max-w-none prose-headings:font-serif prose-headings:italic prose-headings:text-[#5A5A40] prose-p:text-white/80 prose-li:text-white/80 prose-strong:text-white prose-code:text-emerald-400 prose-blockquote:border-[#5A5A40] prose-blockquote:bg-[#5A5A40]/5 prose-blockquote:py-1 prose-blockquote:px-6 prose-blockquote:rounded-r-xl",
                      viewMode === 'slides' ? "prose-xl" : ""
                    )}>
                      {task.image_url && (
                        <div className="mb-8 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                          <img 
                            src={task.image_url} 
                            alt={task.image_prompt || "Generated educational visual"} 
                            className="w-full h-auto object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                      <Markdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '');
                            const isMermaid = !inline && match && match[1] === 'mermaid';
                            
                            if (isMermaid) {
                              return <Mermaid chart={String(children).replace(/\n$/, '')} />;
                            }
                            
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {task.output}
                      </Markdown>
                    </div>
                    
                    {task.feedback && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white/5 border border-white/10 p-6 rounded-3xl flex gap-4 items-start no-print"
                      >
                        <ShieldCheck size={20} className="text-[#5A5A40] shrink-0" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-[10px] uppercase tracking-widest font-bold opacity-40">Critic Agent Feedback</div>
                            {task.feedback.startsWith('REVISE:') && (
                              <button 
                                onClick={() => handleReviseTask(task.id)}
                                className="flex items-center gap-2 px-4 py-1.5 bg-[#5A5A40] text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-[#4A4A30] transition-all"
                              >
                                <RefreshCw size={12} />
                                Trigger Circular Revision
                              </button>
                            )}
                          </div>
                          <p className="text-sm opacity-60 italic leading-relaxed">{task.feedback}</p>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                ) : task.status === 'working' ? (
                  <div className="flex items-center gap-4 py-12 opacity-40 italic">
                    <Loader2 className="animate-spin" size={20} />
                    Generating {task.title}...
                  </div>
                ) : (
                  <div className="py-12 border-2 border-dashed border-white/5 rounded-[32px] flex items-center justify-center opacity-20 italic">
                    Waiting for execution...
                  </div>
                )}
              </div>
            ))}
          </div>

          {step === 'result' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-20 pt-20 border-t border-white/10 text-center no-print"
            >
              <div className="inline-flex items-center gap-3 px-6 py-3 bg-emerald-500/10 text-emerald-500 rounded-full text-sm font-bold mb-8">
                <CheckCircle2 size={18} />
                Content Generation Complete
              </div>
              <h3 className="text-3xl font-serif italic mb-6">Ready for Review</h3>
              <p className="opacity-60 max-w-md mx-auto mb-12">
                All agents have completed their tasks. The Critic Agent has verified the content for pedagogical alignment.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <button 
                  onClick={() => window.print()}
                  className="bg-white/10 text-white border border-white/20 px-8 py-4 rounded-full font-bold uppercase tracking-widest hover:bg-white/20 transition-all flex items-center gap-2"
                >
                  <FileText size={18} />
                  Print / PDF
                </button>
                <button 
                  onClick={handleExportPPTX}
                  className="bg-white text-black px-12 py-5 rounded-full font-bold uppercase tracking-widest hover:bg-white/90 transition-all flex items-center gap-2"
                >
                  <Layout size={18} />
                  Export PowerPoint (.pptx)
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
