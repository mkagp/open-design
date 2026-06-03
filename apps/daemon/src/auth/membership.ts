import { createClerkClient } from '@clerk/backend';

import type { ClerkAuthConfig } from './config.js';

export async function isClerkOrgMember(
  config: Extract<ClerkAuthConfig, { enabled: true }>,
  userId: string,
): Promise<boolean> {
  const clerk = createClerkClient({ secretKey: config.secretKey });
  const result = await clerk.organizations.getOrganizationMembershipList({
    organizationId: config.orgId,
    userId: [userId],
    limit: 1,
  });
  return (result.totalCount ?? result.data.length) > 0;
}
