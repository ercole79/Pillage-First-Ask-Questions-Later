import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { ConnectToRemoteServerForm } from 'app/(public)/(game-worlds)/(create)/components/connect-to-remote-server-form';
import { CreateNewGameWorldForm } from 'app/(public)/(game-worlds)/(create)/components/create-new-game-world-form';
import { PageMetadata } from 'app/(public)/components/page-metadata';
import { PageContents } from 'app/components/page-contents';
import { Text } from 'app/components/text';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from 'app/components/ui/breadcrumb';
import { Button } from 'app/components/ui/button';
import { Tab, TabList, TabPanel, Tabs } from 'app/components/ui/tabs';

type CreateWorldMode = 'local' | 'remote';

const CreateNewGameWorldPage = () => {
  const { t } = useTranslation('public');
  const { pathname } = useLocation();
  const [mode, setMode] = useState<CreateWorldMode>('local');

  const title = t('{{title}} | Pillage First!', {
    title: 'Create a new game world',
  });

  return (
    <PageContents>
      <PageMetadata
        title={title}
        description="Create a new local Pillage First! game world or connect to a remote game-server."
        pathname={pathname}
      />
      <div className="flex flex-col gap-4 max-w-3xl px-2 lg:px-0 mx-auto">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink to="/">{t('Home')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink to="/game-worlds">
                {t('Game worlds')}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>{t('Create')}</BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <main className="flex flex-col gap-4">
          <Text
            as="h1"
            className="text-3xl font-medium leading-tight lg:text-5xl"
          >
            {t('Create a new game world')}
          </Text>
          <Text>
            Choose a local offline world (stored in this browser) or connect to
            a remote game-server. Offline OPFS worlds stay fully separate from
            remote sessions.
          </Text>

          <Tabs
            value={mode}
            onValueChange={(value) => {
              if (value === 'local' || value === 'remote') {
                setMode(value);
              }
            }}
          >
            <TabList>
              <Tab value="local">Local world</Tab>
              <Tab value="remote">Remote server</Tab>
            </TabList>
            <TabPanel
              value="local"
              className="mt-4"
            >
              <Text className="mb-4">
                Game world states are stored in your browser's persistent
                memory. You can safely close the tab or browser at any time.
              </Text>
              <CreateNewGameWorldForm />
            </TabPanel>
            <TabPanel
              value="remote"
              className="mt-4"
            >
              <Text className="mb-4">
                Defaults target a local game-server (`http://127.0.0.1:3010`
                with Bearer `dev-token`). Connection settings are saved so a
                refresh keeps remote mode.
              </Text>
              <ConnectToRemoteServerForm />
            </TabPanel>
          </Tabs>

          <div className="flex flex-col gap-2">
            <Text>
              Want to continue playing on your existing game worlds, or want to
              import a game world?
            </Text>
            <div className="flex gap-2 flex-wrap">
              <Link to="/game-worlds">
                <Button>Your game worlds</Button>
              </Link>
              <Link to="/game-worlds/import">
                <Button variant="outline">Import game world</Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    </PageContents>
  );
};

export default CreateNewGameWorldPage;
