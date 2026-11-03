/** 站点快照：工作区内容里的 sites/ 目录。 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileRef } from '../../shared/ura';

export interface SiteEntryView {
  ref: string;
  title: string;
  domain?: string;
}

export class SitesRepo {
  list(workspacePath: string): SiteEntryView[] {
    const root = join(workspacePath, 'sites');
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((domain) =>
          readdirSync(join(root, domain.name), { withFileTypes: true })
            .filter((file) => file.isFile() && file.name.endsWith('.md'))
            .map((file) => ({
              ref: `${fileRef(workspacePath)}/sites/${domain.name}/${file.name}`,
              title: file.name.replace(/\.md$/, ''),
              domain: domain.name,
            })),
        );
    } catch {
      return [];
    }
  }
}
