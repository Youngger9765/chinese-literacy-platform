import React, { useState, useRef, useEffect } from 'react';

interface HelpTooltipProps {
  /** Tooltip content text */
  content: string;
  /** Optional title shown in bold at the top */
  title?: string;
  /** Position preference (defaults to 'top') */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Additional class names for the trigger button */
  className?: string;
}

/**
 * HelpTooltip — an accessible (?) help icon that shows a tooltip on hover/focus.
 *
 * Usage:
 *   <HelpTooltip title="班級邀請碼" content="學生輸入此碼加入你的班級。" />
 */
const HelpTooltip: React.FC<HelpTooltipProps> = ({
  content,
  title,
  position = 'top',
  className = '',
}) => {
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisible(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-800 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-800 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-800 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-800 border-y-transparent border-l-transparent',
  };

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={title ? `說明：${title}` : '說明'}
        aria-expanded={visible}
        onClick={() => setVisible((v) => !v)}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-xs font-bold hover:bg-amber-200 hover:text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors cursor-help"
      >
        ?
      </button>

      {visible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`absolute z-50 w-64 ${positionClasses[position]}`}
        >
          <div className="bg-gray-800 text-white rounded-lg shadow-lg px-3 py-2 text-xs leading-relaxed">
            {title && (
              <p className="font-semibold mb-1 text-amber-300">{title}</p>
            )}
            <p className="text-gray-100">{content}</p>
          </div>
          {/* Arrow */}
          <div
            className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
            aria-hidden="true"
          />
        </div>
      )}
    </span>
  );
};

export default HelpTooltip;
