/**
 * DetailHeaderCard — entity header used at the top of detail panels.
 *
 * Displays a title, optional subtitle, a status badge, and action buttons.
 *
 * Usage:
 *   <DetailHeaderCard
 *     title={org.name}
 *     subtitle={org.display_name}
 *     badge={{ label: org.is_active ? '啟用' : '停用', variant: org.is_active ? 'green' : 'red' }}
 *     actions={<button onClick={handleEdit}>編輯</button>}
 *   />
 */
import React from 'react';

export type BadgeVariant = 'green' | 'red' | 'blue' | 'yellow' | 'gray';

const BADGE_STYLES: Record<BadgeVariant, string> = {
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  gray: 'bg-gray-100 text-gray-600',
};

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export interface DetailHeaderCardProps {
  /** Main entity name / title. */
  title: string;
  /** Optional secondary label (e.g. display name, email). */
  subtitle?: string;
  /** Status badge configuration. */
  badge?: BadgeProps;
  /** Action buttons rendered in the top-right corner. */
  actions?: React.ReactNode;
  /** Extra className on the card wrapper. */
  className?: string;
}

const DetailHeaderCard: React.FC<DetailHeaderCardProps> = ({
  title,
  subtitle,
  badge,
  actions,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between ${className}`}
    >
      {/* ── Left: title + badge ────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {badge && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                BADGE_STYLES[badge.variant ?? 'gray']
              }`}
            >
              {badge.label}
            </span>
          )}
        </div>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>

      {/* ── Right: actions ─────────────────────────────────────────────── */}
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
};

export default DetailHeaderCard;
