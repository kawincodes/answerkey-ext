import { cn } from 'cn';
import { KeyRound } from 'lucide-react';

/** AnswerKey's mark: a key on the same indigo-to-violet gradient as the toolbar icon. */
export function Logo({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-xs',
        className,
      )}
    >
      <KeyRound className={cn('size-4', iconClassName)} />
    </span>
  );
}
