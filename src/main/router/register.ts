/** 域路由装配：App 组合根只调用这一个入口。 */
import {
  routesLists as lists,
  routesPiConf as piconf,
  routesPlugins as plugins,
  routesResources as resources,
  routesSessions as sessions,
  routesSettings as settings,
  routesSites as sites,
  routesWorkspaces as workspaces,
} from './routes';
import type { Router } from './router';
import type { ListsService } from '../service/lists';
import type { PiConfService } from '../service/piconf';
import type { PluginsService } from '../service/plugins';
import type { ResourcesService } from '../service/resources';
import type { SessionsService } from '../service/sessions';
import type { SettingsService } from '../service/settings';
import type { SitesService } from '../service/sites';
import type { WorkspacesService } from '../service/workspaces';

export interface RouteServices {
  workspaces: WorkspacesService;
  resources: ResourcesService;
  lists: ListsService;
  sessions: SessionsService;
  plugins: PluginsService;
  piconf: PiConfService;
  settings: SettingsService;
  sites: SitesService;
}

export function registerRoutes(router: Router, services: RouteServices): void {
  workspaces(router.service('workspaces', '/workspaces'), services.workspaces);
  piconf(router.service('piconf', '/piconf'), services.piconf);
  plugins(router.service('plugins', '/plugins'), services.plugins);
  settings(router.service('settings', '/settings'), services.settings);
  resources(
    router.service('resources', '/workspaces/:wsId/resources'),
    services.resources,
  );
  lists(router.service('lists', '/workspaces/:wsId/lists'), services.lists);
  sessions(
    router.service('sessions', '/workspaces/:wsId/sessions'),
    services.sessions,
  );
  sites(router.service('sites', '/workspaces/:wsId/sites'), services.sites);
}
