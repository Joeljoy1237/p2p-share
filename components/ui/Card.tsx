'use client';
import { motion, HTMLMotionProps } from 'framer-motion';
import clsx from 'clsx';
import { forwardRef } from 'react';

export interface CardProps extends HTMLMotionProps<'div'> {
  glass?: boolean;
  glow?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, glass = false, glow = false, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={clsx(
          glass ? 'glass rounded-[var(--radius-lg)]' : 'card',
          glow && 'shadow-[0_0_30px_var(--color-accent-glow)] border-[rgba(91,106,247,0.25)]',
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';
