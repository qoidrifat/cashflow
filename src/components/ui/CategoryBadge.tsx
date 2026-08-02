import { cn } from '../../lib/utils';
import { getCategoryMeta } from '../../config/categoryIcons';
import CategoryIcon from './CategoryIcon';

export { getCategoryMeta };

interface CategoryBadgeProps {
  name: string;
  type?: 'expense' | 'income';
  size?: 'sm' | 'md';
  className?: string;
}

export default function CategoryBadge({ name, type, size = 'sm', className }: CategoryBadgeProps) {
  const meta = getCategoryMeta(name, type);

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-full font-medium',
      size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-xs',
      meta.bgLight,
      meta.bgDark,
      meta.textLight,
      meta.textDark,
      className
    )}>
      <CategoryIcon name={name} type={type} size="sm" noBackground animated animationVariant="soft" />
      <span>{name}</span>
    </div>
  );
}
