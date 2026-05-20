'use client';

import { useFormStatus } from 'react-dom';

interface Props {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  title?: string;
}

/**
 * Submit button que mostra estado pending automaticamente quando dentro de
 * <form action={serverAction}>. Usa useFormStatus do React 19.
 */
export function SubmitButton({ children, pendingText, className, title }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className ?? ''} disabled:cursor-wait disabled:opacity-70`}
      title={title}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner />
          {pendingText ?? 'Rodando...'}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
