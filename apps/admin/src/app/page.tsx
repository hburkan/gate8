import { CONTENT_STATUSES } from '@gate8/shared-types';

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-start justify-between py-32 px-16 bg-white dark:bg-black">
        <div className="flex flex-col items-start gap-6">
          <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Gümrük Kontrol Memuru — Admin
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Content management system. Content entities are defined in{' '}
            <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
              @gate8/shared-types
            </code>
            , validated with zod in{' '}
            <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
              @gate8/content-schema
            </code>{' '}
            and persisted to Supabase.
          </p>
          <ul className="flex flex-col gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            {CONTENT_STATUSES.map((status) => (
              <li key={status}>Content status: {status}</li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
