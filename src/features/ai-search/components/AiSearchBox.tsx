import { FormEvent } from 'react';
import { Loader2, Search, Sparkles } from 'lucide-react';
import Button from '../../../components/ui/Button';

export default function AiSearchBox({
  value,
  placeholder,
  loading,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-[1.25rem] border border-app-border bg-app-elevated/90 p-2 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">AI Search query</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-app-subtle" />
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="h-13 w-full rounded-2xl border-0 bg-transparent py-3 pl-12 pr-4 text-sm font-medium text-app-text outline-none placeholder:text-app-subtle"
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={loading || value.trim().length < 2}
          icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          className="h-12 justify-center sm:min-w-[148px]"
        >
          {loading ? 'Mencari' : 'Cari'}
        </Button>
      </div>
    </form>
  );
}
