import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and lets the last Tailwind utility win (so a `className` passed in can override a default). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
