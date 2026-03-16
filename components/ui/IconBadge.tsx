'use client';
import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';

export interface IconBadgeProps extends HTMLMotionProps<'div'> {
  icon: React.ReactNode;
  color?: 'accent' | 'green' | 'amber' | 'red' | 'default';
  size?: 'sm' | 'md' | 'lg';
}

export function IconBadge({
  icon,
  color = 'default',
  size = 'md',
  className,
  ...props
}: IconBadgeProps) {
  const colors = {
    accent: 'bg-accent-dim text-accent border-accent-dim',
    green: 'bg-green-dim text-green border-green-dim',
    amber: 'bg-[rgba(245,158,11,0.15)] text-amber border-[rgba(245,158,11,0.15)]',
    red: 'bg-red-dim text-red border-red-dim',
    default: 'bg-surface-2 text-text-2 border-border',
  };

  const sizes = {
    sm: 'w-8 h-8 text-base rounded-lg',
    md: 'w-12 h-12 text-2xl rounded-xl',
    lg: 'w-16 h-16 text-3xl rounded-2xl',
  };

  return (
    <motion.div
      className={clsx(
        'flex items-center justify-center border',
        colors[color],
        sizes[size],
        className
      )}
      {...props}
    >
      {icon}
    </motion.div>
  );
}
