import type { ComponentProps } from 'react';
import { use } from 'react';
import { VscTerminal } from 'react-icons/vsc';
import { usePreferences } from 'app/(game)/(village-slug)/hooks/use-preferences';
import { ApiContext } from 'app/(game)/providers/api-context';

export const DeveloperToolsButton = ({
  className,
  ...props
}: ComponentProps<'span'>) => {
  const { preferences } = usePreferences();
  const { mode } = use(ApiContext);

  // Dev tools stay offline-only (game-server rejects /developer*).
  if (mode === 'remote' || !preferences.isDeveloperToolsConsoleEnabled) {
    return null;
  }

  return (
    <span
      className={className}
      {...props}
    >
      <VscTerminal className="text-inherit size-full" />
    </span>
  );
};
