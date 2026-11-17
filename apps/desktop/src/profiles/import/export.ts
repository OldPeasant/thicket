import type { Profile, ProfileDraft } from '@thicket/contract';

import { THICKET_EXPORT_TYPE } from './compass';
import { uriWithoutSecrets } from './uri';

/** Layout of a Thicket profiles export (read back by `parseImportFile`). */
export interface ExportFile {
  type: typeof THICKET_EXPORT_TYPE;
  version: 1;
  profiles: Omit<ProfileDraft, 'id'>[];
}

/**
 * The JSON of a profiles export, to share with a team: the profiles without their ids (an import
 * creates new ones) and without any secret (`secretMode: 'saved'` becomes `ask`). Profiles never hold passwords, but the connection
 * string is cleaned once more (password, `proxyPassword`, `tlsCertificateKeyFilePassword`,
 * `AWS_SESSION_TOKEN`), so nothing a user typed into an option can leak into the file.
 */
export function exportFile(profiles: readonly Profile[]): string {
  const file: ExportFile = {
    type: THICKET_EXPORT_TYPE,
    version: 1,
    profiles: profiles.map((p) => {
      const copy: Partial<Profile> = structuredClone(p);
      delete copy.id;
      // The recipient has none of the saved secrets: they are asked for instead.
      if (copy.auth?.secretMode === 'saved') copy.auth.secretMode = 'ask';
      return {
        ...(copy as Omit<Profile, 'id'>),
        connectionString: uriWithoutSecrets(p.connectionString),
      };
    }),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}
