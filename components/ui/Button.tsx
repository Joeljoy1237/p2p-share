'use client';
import { motion, HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { forwardRef } from 'react';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    
    const baseClasses = 'inline-flex items-center justify-center gap-2 font-sans font-semibold transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variants = {
      primary: 'bg-accent text-white border border-transparent rounded-xl shadow-[0_4px_16px_var(--color-accent-glow)] hover:bg-[#6b7aff] hover:shadow-[0_8px_32px_var(--color-accent-glow)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_2px_8px_var(--color-accent-glow)]',
      ghost: 'bg-transparent text-text-2 border border-border rounded-xl hover:border-border-2 hover:bg-surface-2 hover:text-text',
      danger: 'bg-red-dim text-red border border border-[rgba(244,63,94,0.2)] rounded-xl hover:bg-[rgba(244,63,94,0.25)] hover:border-[rgba(244,63,94,0.35)]',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-xs',
      md: 'px-5 py-2.5 text-sm',
      lg: 'px-8 py-4 text-base',
    };

    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: disabled || isLoading ? 1 : 1.015 }}
        whileTap={{ scale: disabled || isLoading ? 1 : 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={clsx(baseClasses, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <Loader2 className="w-4 h-4 animate-spin" />
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
