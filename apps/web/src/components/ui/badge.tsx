import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

// Written for this product (not copied from coss ui, whose source is AGPL). Uses the tokens in theme.css.
export const badgeVariants = cva('inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-xs font-medium', {
  variants: {
    variant: {
      neutral: 'bg-secondary text-secondary-foreground',
      info: 'bg-info/10 text-info-foreground',
      success: 'bg-success/10 text-success-foreground',
      warning: 'bg-warning/15 text-warning-foreground',
      danger: 'bg-destructive/10 text-destructive-foreground',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
