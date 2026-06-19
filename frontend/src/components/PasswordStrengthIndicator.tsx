/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
import React from 'react';

interface PasswordStrengthIndicatorProps {
  password: string;
}

interface StrengthResult {
  level: 'weak' | 'medium' | 'strong';
  label: string;
  color: string;
  barColor: string;
  barWidth: string;
}

function evaluateStrength(password: string): StrengthResult {
  if (!password) {
    return { level: 'weak', label: '', color: 'text-gray-400', barColor: 'bg-gray-200', barWidth: 'w-0' };
  }

  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) score += 1;

  if (score <= 2) {
    return { level: 'weak', label: '弱', color: 'text-red-500', barColor: 'bg-red-400', barWidth: 'w-1/3' };
  } else if (score <= 4) {
    return { level: 'medium', label: '中', color: 'text-yellow-500', barColor: 'bg-yellow-400', barWidth: 'w-2/3' };
  } else {
    return { level: 'strong', label: '強', color: 'text-green-500', barColor: 'bg-green-500', barWidth: 'w-full' };
  }
}

const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({ password }) => {
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);

  const strength = evaluateStrength(password);

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${strength.barColor} ${strength.barWidth}`}
          />
        </div>
        <span className={`text-xs font-medium ${strength.color} w-4 text-right`}>
          {strength.label}
        </span>
      </div>

      {/* Requirements checklist */}
      <ul className="space-y-0.5">
        <RequirementItem met={hasMinLength} label="8 字元以上" />
        <RequirementItem met={hasLetter} label="包含英文字母" />
        <RequirementItem met={hasNumber} label="包含數字" />
      </ul>
    </div>
  );
};

const RequirementItem: React.FC<{ met: boolean; label: string }> = ({ met, label }) => (
  <li className={`flex items-center gap-1.5 text-xs transition-colors ${met ? 'text-green-600' : 'text-gray-400'}`}>
    <span className="shrink-0">
      {met ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414L8.414 15 3.293 9.879a1 1 0 111.414-1.414L8.414 12.172l6.879-6.879a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      )}
    </span>
    {label}
  </li>
);

export default PasswordStrengthIndicator;
