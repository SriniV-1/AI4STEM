import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: true,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'Inter, sans-serif',
  themeVariables: {
    primaryColor: '#5A5A40',
    primaryTextColor: '#fff',
    primaryBorderColor: '#5A5A40',
    lineColor: '#5A5A40',
    secondaryColor: '#141414',
    tertiaryColor: '#141414',
  }
});

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    
    if (ref.current && chart) {
      // Force re-render
      const renderDiagram = async () => {
        try {
          const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, chart);
          if (ref.current && isMounted) {
            ref.current.innerHTML = svg;
          }
        } catch (error) {
          console.error('Mermaid render error:', error);
          if (ref.current && isMounted) {
            ref.current.innerHTML = `<div class="p-4 bg-red-500/10 text-red-500 text-xs rounded-xl border border-red-500/20">
              <p class="font-bold mb-1">Diagram Error</p>
              <p class="opacity-70">Could not render diagram. Please check syntax.</p>
            </div>`;
          }
        }
      };
      
      renderDiagram();
    }

    return () => {
      isMounted = false;
    };
  }, [chart]);

  return (
    <div className="mermaid-container my-8 flex justify-center overflow-x-auto">
      <div ref={ref} className="mermaid" />
    </div>
  );
};

export default Mermaid;
