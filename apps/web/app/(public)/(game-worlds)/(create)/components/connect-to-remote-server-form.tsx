import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import {
  getRemoteConnectionFormDefaults,
  setRemoteConnectionFormDefaults,
} from 'app/(game)/utils/connection-settings';
import { useGameWorldActions } from 'app/(public)/(game-worlds)/hooks/use-game-world-actions';
import { probeRemoteGameServer } from 'app/(public)/(game-worlds)/utils/probe-remote-game-server';
import { availableServerCacheKey } from 'app/(public)/constants/query-keys';
import { Text } from 'app/components/text';
import { Alert } from 'app/components/ui/alert';
import { Button } from 'app/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'app/components/ui/form';
import { Input } from 'app/components/ui/input';
import { reportError } from 'app/instrumentation/report-error';
import { invalidateQueries } from 'app/utils/react-query';

const connectRemoteFormSchema = z.strictObject({
  baseUrl: z.url({ error: 'Enter a valid server URL' }),
  authToken: z.string().min(1, { error: 'Auth token is required' }),
});

type ConnectRemoteFormValues = z.infer<typeof connectRemoteFormSchema>;

export const ConnectToRemoteServerForm = () => {
  const navigate = useNavigate();
  const { connectRemoteGameWorld } = useGameWorldActions();
  const defaults = getRemoteConnectionFormDefaults();

  const form = useForm<ConnectRemoteFormValues>({
    resolver: zodResolver(connectRemoteFormSchema),
    defaultValues: {
      baseUrl: defaults.baseUrl,
      authToken: defaults.authToken,
    },
  });

  const {
    mutate: connect,
    isPending,
    isError,
    error,
  } = useMutation({
    mutationFn: async (values: ConnectRemoteFormValues) => {
      setRemoteConnectionFormDefaults(values);

      const { server, firstVillageId } = await probeRemoteGameServer(
        values.baseUrl,
        values.authToken,
      );

      await connectRemoteGameWorld({
        server,
        baseUrl: values.baseUrl,
        authToken: values.authToken,
      });

      return { server, firstVillageId };
    },
    onSuccess: async ({ server, firstVillageId }, _vars, _ctx, context) => {
      await invalidateQueries(context, [[availableServerCacheKey]]);
      await navigate(`/game/${server.slug}/v-${firstVillageId}/resources`);
    },
    onError: (mutationError) => {
      reportError(mutationError, 'Failed to connect to remote game server', {
        source: 'ConnectToRemoteServerForm',
      });
    },
  });

  return (
    <div className="flex flex-col gap-2 p-2 shadow-xl rounded-md border border-border">
      <Text as="h2">Remote game server</Text>
      <Alert variant="info">
        Connect to a running game-server process. Local OPFS worlds are
        unchanged — this path talks to HTTP `/api/*` and WebSocket `/ws` only.
      </Alert>
      <Form {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => {
            connect(values);
          })}
        >
          <FormField
            control={form.control}
            name="baseUrl"
            disabled={isPending}
            render={({ field }) => (
              <FormItem className="flex flex-col gap-2">
                <FormLabel>Server URL</FormLabel>
                <FormControl>
                  <Input
                    placeholder="http://127.0.0.1:3010"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="authToken"
            disabled={isPending}
            render={({ field }) => (
              <FormItem className="flex flex-col gap-2">
                <FormLabel>Auth token</FormLabel>
                <FormControl>
                  <Input
                    placeholder="dev-token"
                    autoComplete="off"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {isError && (
            <Alert variant="error">
              {error instanceof Error
                ? error.message
                : 'Unable to connect to remote server'}
            </Alert>
          )}
          <div className="flex justify-end">
            <Button
              size="fit"
              disabled={isPending}
              type="submit"
            >
              {isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};
