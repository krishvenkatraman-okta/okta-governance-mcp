'use client';

import { cn } from '@/lib/utils';
import { Shield, AlertTriangle } from 'lucide-react';

interface RiskBadgeProps {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
}

const config: Record<string, { bg: string; text: string; border: string; icon: typeof Shield }> = {
  LOW: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/30',
    icon: Shield,
  },
  MEDIUM: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/30',
    icon: AlertTriangle,
  },
  HIGH: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/30',
    icon: AlertTriangle,
  },
};

export default function RiskBadge({ level }: RiskBadgeProps) {
  const c = config[level] ?? config.LOW;
  const Icon = c.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        c.bg,
        c.text,
        c.border,
      )}
    >
      <Icon className="h-3 w-3" />
      {level}
    </span>
  );
}
