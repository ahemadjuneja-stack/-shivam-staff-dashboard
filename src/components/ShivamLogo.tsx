import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  subtitle?: string;
}

// SHIVAM brand logo (silver shine — staff app jaisa hi official look)
export default function ShivamLogo({ size = 'md', subtitle }: LogoProps) {
  const sizeClasses = {
    sm: 'text-base tracking-[0.25em]',
    md: 'text-xl tracking-[0.3em]',
    lg: 'text-2xl tracking-[0.35em]',
    xl: 'text-4xl tracking-[0.4em]'
  };

  return (
    <div className="flex flex-col items-center select-none">
      <div className={`relative inline-block ${sizeClasses[size]}`}>
        <span className="shivam-silver shivam-silver-shine drop-shadow-[0_0_14px_rgba(148,163,184,0.35)]">
          S H I V A M
        </span>
      </div>
      {subtitle && (
        <span className="text-[10px] uppercase tracking-[0.25em] text-indigo-300/80 mt-1.5 font-sans">
          {subtitle}
        </span>
      )}
    </div>
  );
}
