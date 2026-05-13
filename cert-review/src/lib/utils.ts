import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a risk reason message by replacing template placeholders.
 */
export function formatRiskReason(message: string, args: Array<{ value: string; type: string }>): string {
  return message.replace(/\{(\d+)\}/g, (_, i) => {
    const arg = args[parseInt(i)];
    if (!arg) return `{${i}}`;
    if (arg.type === 'RELATIVE_DATE_TO_NOW') {
      const d = new Date(arg.value);
      const now = new Date();
      const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
      if (days < 1) return 'today';
      if (days === 1) return 'yesterday';
      if (days < 30) return `${days} days ago`;
      return `${Math.floor(days / 30)} months ago`;
    }
    return arg.value;
  });
}

/**
 * Get the highest risk level from a list of risk items.
 */
export function getOverallRisk(riskItems: Array<{ riskLevel: string }>): 'LOW' | 'MEDIUM' | 'HIGH' {
  const levels = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  let max = 0;
  for (const item of riskItems) {
    const level = levels[item.riskLevel as keyof typeof levels] || 0;
    if (level > max) max = level;
  }
  return max >= 3 ? 'HIGH' : max >= 2 ? 'MEDIUM' : 'LOW';
}

/**
 * Get a nested field value from an object using dot notation.
 */
export function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

/**
 * Apply filters from view config to review items.
 */
export function applyFilters(items: any[], filters: Record<string, string | string[]>): any[] {
  return items.filter(item => {
    for (const [field, value] of Object.entries(filters)) {
      let itemValue: any;

      // Map friendly field names to actual data paths
      switch (field) {
        case 'resource.name':
        case 'resource':
          itemValue = item.reviewItemContextualInfo?.appInfo?.label
            || item.reviewItemContextualInfo?.groupInfo?.name;
          break;
        case 'riskLevel':
          itemValue = getOverallRisk(item.riskItems || []);
          break;
        case 'recommendation':
          itemValue = item.govAnalyzerRecommendationContext?.recommendedReviewDecision;
          break;
        case 'principal.email':
          itemValue = item.principalProfile?.email;
          break;
        case 'principal.firstName':
          itemValue = item.principalProfile?.firstName;
          break;
        case 'decision':
          itemValue = item.decision;
          break;
        case 'assignmentType':
          itemValue = item.assignmentType;
          break;
        default:
          itemValue = getNestedValue(item, field);
      }

      const values = Array.isArray(value) ? value : [value];
      const itemStr = String(itemValue || '').toLowerCase();
      const matches = values.some(v => itemStr.includes(String(v).toLowerCase()));
      if (!matches) return false;
    }
    return true;
  });
}
